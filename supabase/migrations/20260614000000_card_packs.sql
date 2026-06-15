-- Card packs and one-use lineup swaps.
-- Daily packs are deterministic: the same day produces the same 3 players for everyone.

create table if not exists public.card_drops (
  id text primary key,
  kind text not null check (kind in ('daily', 'special')),
  label text not null,
  player_ids text[] not null check (coalesce(array_length(player_ids, 1), 0) = 3),
  available_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.user_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  drop_id text not null references public.card_drops(id) on delete cascade,
  card_index integer not null check (card_index between 1 and 3),
  player_id text not null references public.players(id),
  used_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, drop_id, card_index)
);

create table if not exists public.card_swaps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  card_id uuid references public.user_cards(id) on delete set null,
  in_player_id text not null references public.players(id),
  out_player_id text not null references public.players(id),
  points_in integer not null,
  points_out integer not null,
  delta integer not null,
  created_at timestamptz not null default now()
);

alter table public.card_drops enable row level security;
alter table public.user_cards enable row level security;
alter table public.card_swaps enable row level security;

drop policy if exists "available card drops read" on public.card_drops;
create policy "available card drops read" on public.card_drops
  for select using (available_at <= now() or public.is_admin());

drop policy if exists "admin card drops write" on public.card_drops;
create policy "admin card drops write" on public.card_drops
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "owner user cards read" on public.user_cards;
create policy "owner user cards read" on public.user_cards
  for select using (auth.uid() = user_id);

drop policy if exists "public card swaps read" on public.card_swaps;
create policy "public card swaps read" on public.card_swaps
  for select using (true);

grant select on public.card_drops to anon, authenticated;
grant select on public.card_swaps to anon, authenticated;
grant select on public.user_cards to authenticated;
revoke insert, update, delete on public.card_drops from anon, authenticated;
revoke insert, update, delete on public.user_cards from anon, authenticated;
revoke insert, update, delete on public.card_swaps from anon, authenticated;

create or replace function public.prevent_definitive_prediction_changes()
returns trigger
language plpgsql
as $$
begin
  if old.is_definitive and coalesce(current_setting('app.allow_card_swap', true), '') <> 'on' then
    raise exception 'La porra definitiva ya no admite cambios';
  end if;
  return new;
end;
$$;

create or replace function public.card_drop_player_ids(p_seed text)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_player_ids text[];
begin
  select coalesce(array_agg(id order by sort_key), '{}'::text[])
  into v_player_ids
  from (
    select id, md5(coalesce(p_seed, '') || ':' || id) as sort_key
    from public.players
    where squad_status <> 'withdrawn'
    order by sort_key
    limit 3
  ) picked;

  return v_player_ids;
end;
$$;

create or replace function public.card_player_points(p_player_id text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(
    case e.event_type
      when 'goal' then
        case pl.position
          when 'DEL' then 2
          when 'MED' then 6
          when 'DEF' then 11
          when 'POR' then 35
          else 2
        end
      when 'penalty_goal' then 1
      when 'mvp' then 3
      when 'penalty_save' then 2
      when 'penalty_miss' then -1
      when 'red_card' then -2
      else 0
    end
  ), 0)::integer
  from public.match_events e
  join public.matches m on m.id = e.match_id and m.status in ('finished', 'validated')
  left join public.players pl on pl.id = e.player_id
  where e.player_id = p_player_id
    and e.event_type in ('goal', 'penalty_goal', 'mvp', 'penalty_save', 'penalty_miss', 'red_card');
$$;

create or replace function public.open_card_drop(p_drop_id text)
returns table (
  card_id uuid,
  drop_id text,
  card_index integer,
  player_id text,
  used_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_drop public.card_drops%rowtype;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  select * into v_drop
  from public.card_drops
  where id = p_drop_id and available_at <= now();

  if not found then
    raise exception 'Sobre no disponible';
  end if;

  insert into public.user_cards (user_id, drop_id, card_index, player_id)
  select v_uid, v_drop.id, ordinality::integer, player_id
  from unnest(v_drop.player_ids) with ordinality as cards(player_id, ordinality)
  on conflict (user_id, drop_id, card_index) do nothing;

  return query
  select c.id, c.drop_id, c.card_index, c.player_id, c.used_at, c.created_at
  from public.user_cards c
  where c.user_id = v_uid and c.drop_id = v_drop.id
  order by c.card_index;
end;
$$;

create or replace function public.open_daily_card_pack(p_day date default current_date)
returns table (
  card_id uuid,
  drop_id text,
  card_index integer,
  player_id text,
  used_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_drop_id text := 'daily-' || to_char(coalesce(p_day, current_date), 'YYYY-MM-DD');
  v_label text := 'Sobre diario ' || to_char(coalesce(p_day, current_date), 'DD/MM/YYYY');
begin
  insert into public.card_drops (id, kind, label, player_ids, available_at)
  values (
    v_drop_id,
    'daily',
    v_label,
    public.card_drop_player_ids('daily:' || v_drop_id),
    (coalesce(p_day, current_date))::timestamptz
  )
  on conflict (id) do nothing;

  return query
  select * from public.open_card_drop(v_drop_id);
end;
$$;

create or replace function public.admin_create_card_drop(p_label text default null)
returns table (
  id text,
  kind text,
  label text,
  player_ids text[],
  available_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_drop_id text := 'special-' || gen_random_uuid()::text;
  v_label text := coalesce(nullif(trim(p_label), ''), 'Drop especial');
begin
  if not public.is_admin() then
    raise exception 'Solo el admin puede soltar drops especiales';
  end if;

  insert into public.card_drops (id, kind, label, player_ids, created_by)
  values (
    v_drop_id,
    'special',
    v_label,
    public.card_drop_player_ids('special:' || v_drop_id),
    v_uid
  );

  return query
  select d.id, d.kind, d.label, d.player_ids, d.available_at, d.created_at
  from public.card_drops d
  where d.id = v_drop_id;
end;
$$;

create or replace function public.apply_card_swap(
  p_card_id uuid,
  p_out_player_id text
)
returns table (
  in_player_id text,
  out_player_id text,
  points_in integer,
  points_out integer,
  delta integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_card public.user_cards%rowtype;
  v_in_position text;
  v_out_position text;
  v_selections jsonb;
  v_xi jsonb;
  v_next_xi jsonb;
  v_points_in integer;
  v_points_out integer;
  v_delta integer;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  select * into v_card
  from public.user_cards
  where id = p_card_id and user_id = v_uid and used_at is null;

  if not found then
    raise exception 'Carta no disponible';
  end if;

  select position into v_in_position from public.players where id = v_card.player_id;
  select position into v_out_position from public.players where id = p_out_player_id;
  if v_in_position is null or v_out_position is null or v_in_position <> v_out_position then
    raise exception 'La carta no coincide con el puesto';
  end if;

  select selections into v_selections
  from public.predictions
  where user_id = v_uid;

  if not found then
    raise exception 'Necesitas tener una porra guardada';
  end if;

  v_xi := coalesce(v_selections -> 'xi', '[]'::jsonb);

  if exists (
    select 1 from jsonb_array_elements_text(v_xi) xi(player_id)
    where xi.player_id = v_card.player_id
  ) then
    raise exception 'Ese jugador ya esta en tu once';
  end if;

  if not exists (
    select 1 from jsonb_array_elements_text(v_xi) xi(player_id)
    where xi.player_id = p_out_player_id
  ) then
    raise exception 'Ese jugador ya no esta en tu once';
  end if;

  v_points_in := public.card_player_points(v_card.player_id);
  v_points_out := public.card_player_points(p_out_player_id);
  if not (v_points_in < v_points_out or (v_points_in = 0 and v_points_out >= 0)) then
    raise exception 'El jugador de la carta debe tener menos puntos que el que sale';
  end if;

  select jsonb_agg(
    case
      when xi.player_id = p_out_player_id then to_jsonb(v_card.player_id)
      else to_jsonb(xi.player_id)
    end
    order by xi.ordinality
  )
  into v_next_xi
  from jsonb_array_elements_text(v_xi) with ordinality as xi(player_id, ordinality);

  v_delta := v_points_in - v_points_out;

  update public.user_cards
  set used_at = now()
  where id = v_card.id;

  insert into public.card_swaps (
    user_id,
    card_id,
    in_player_id,
    out_player_id,
    points_in,
    points_out,
    delta
  )
  values (
    v_uid,
    v_card.id,
    v_card.player_id,
    p_out_player_id,
    v_points_in,
    v_points_out,
    v_delta
  );

  perform set_config('app.allow_card_swap', 'on', true);
  update public.predictions
  set selections = jsonb_set(v_selections, array['xi'], coalesce(v_next_xi, '[]'::jsonb), true),
      updated_at = now()
  where user_id = v_uid;

  return query
  select v_card.player_id, p_out_player_id, v_points_in, v_points_out, v_delta;
end;
$$;

revoke all on function public.card_drop_player_ids(text) from public;
revoke all on function public.card_player_points(text) from public;
revoke all on function public.open_card_drop(text) from public;
revoke all on function public.open_daily_card_pack(date) from public;
revoke all on function public.admin_create_card_drop(text) from public;
revoke all on function public.apply_card_swap(uuid, text) from public;

grant execute on function public.open_card_drop(text) to authenticated;
grant execute on function public.open_daily_card_pack(date) to authenticated;
grant execute on function public.admin_create_card_drop(text) to authenticated;
grant execute on function public.apply_card_swap(uuid, text) to authenticated;
