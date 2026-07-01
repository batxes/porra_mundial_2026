-- Rasca sobres: activacion admin, intento unico por usuario y premios
-- privados por cada tarjeta con 3 sobres iguales.

create table if not exists public.scratch_cards (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'RASCA SOBRES',
  card_count integer not null default 5 check (card_count between 1 and 10),
  win_chance numeric(5,4) not null default 0.33 check (win_chance >= 0 and win_chance <= 1),
  rewards jsonb not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.scratch_card_settings (
  id boolean primary key default true check (id),
  active boolean not null default false,
  active_scratch_card_id uuid references public.scratch_cards(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.scratch_card_attempts (
  scratch_card_id uuid not null references public.scratch_cards(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  wins integer not null check (wins >= 0),
  packs_awarded integer not null check (packs_awarded >= 0),
  cards jsonb not null default '[]'::jsonb,
  awarded_drop_ids text[] not null default '{}'::text[],
  completed_at timestamptz not null default now(),
  primary key (scratch_card_id, user_id)
);

create index if not exists scratch_card_attempts_completed_idx
  on public.scratch_card_attempts (completed_at desc);

alter table public.scratch_cards enable row level security;
alter table public.scratch_card_settings enable row level security;
alter table public.scratch_card_attempts enable row level security;

drop policy if exists "public scratch card settings read" on public.scratch_card_settings;
create policy "public scratch card settings read" on public.scratch_card_settings
  for select using (true);

drop policy if exists "admin scratch cards read" on public.scratch_cards;
create policy "admin scratch cards read" on public.scratch_cards
  for select using (public.is_admin());

drop policy if exists "owner scratch card attempt read" on public.scratch_card_attempts;
create policy "owner scratch card attempt read" on public.scratch_card_attempts
  for select using (auth.uid() = user_id or public.is_admin());

grant select on public.scratch_card_settings to anon, authenticated;
grant select on public.scratch_cards to authenticated;
grant select on public.scratch_card_attempts to authenticated;
revoke insert, update, delete on public.scratch_cards from anon, authenticated;
revoke insert, update, delete on public.scratch_card_settings from anon, authenticated;
revoke insert, update, delete on public.scratch_card_attempts from anon, authenticated;

insert into public.scratch_cards (
  id,
  title,
  card_count,
  win_chance,
  rewards
)
values (
  '00000000-0000-0000-0000-0000000000e1'::uuid,
  'RASCA SOBRES',
  5,
  0.33,
  '[
    { "pool": "defensas" },
    { "pool": "medios" },
    { "pool": "delanteros" },
    { "pool": "porteros" },
    { "pool": "stars" }
  ]'::jsonb
)
on conflict (id) do nothing;

insert into public.scratch_card_settings (
  id,
  active,
  active_scratch_card_id
)
values (true, false, '00000000-0000-0000-0000-0000000000e1'::uuid)
on conflict (id) do nothing;

create or replace function public.scratch_cards_validate_rewards(p_rewards jsonb)
returns void
language plpgsql
stable
as $$
declare
  v_reward jsonb;
  v_pool text;
begin
  if jsonb_typeof(p_rewards) is distinct from 'array' then
    raise exception 'Premios invalidos';
  end if;
  if jsonb_array_length(p_rewards) < 2 or jsonb_array_length(p_rewards) > 8 then
    raise exception 'Premios invalidos';
  end if;

  for v_reward in
    select r.value from jsonb_array_elements(p_rewards) as r(value)
  loop
    if jsonb_typeof(v_reward) is distinct from 'object'
      or jsonb_typeof(v_reward->'pool') is distinct from 'string'
    then
      raise exception 'Premio invalido';
    end if;

    v_pool := v_reward->>'pool';

    if v_pool not in (
      'defensas', 'medios', 'delanteros', 'porteros',
      'stars', 'madrid', 'barcelona', 'sub21', 'francia', 'premier'
    ) then
      raise exception 'Sobre de premio no valido';
    end if;
  end loop;
end;
$$;

create or replace function public.scratch_cards_public_rewards(p_rewards jsonb)
returns jsonb
language sql
stable
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'pool', r.item->>'pool',
        'title', public.sobera_pack_label(r.item->>'pool')
      )
      order by r.ordinality
    ),
    '[]'::jsonb
  )
  from jsonb_array_elements(p_rewards) with ordinality as r(item, ordinality);
$$;

create or replace function public.scratch_cards_status()
returns table (
  active boolean,
  completed boolean,
  scratch_card_id uuid,
  title text,
  card_count integer,
  win_chance numeric,
  rewards jsonb,
  wins integer,
  packs_awarded integer,
  cards jsonb,
  awarded_drop_ids text[],
  completed_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  return query
  select
    s.active,
    a.user_id is not null as completed,
    c.id as scratch_card_id,
    c.title,
    c.card_count,
    c.win_chance,
    public.scratch_cards_public_rewards(c.rewards) as rewards,
    coalesce(a.wins, 0) as wins,
    coalesce(a.packs_awarded, 0) as packs_awarded,
    coalesce(a.cards, '[]'::jsonb) as cards,
    coalesce(a.awarded_drop_ids, '{}'::text[]) as awarded_drop_ids,
    a.completed_at
  from public.scratch_card_settings s
  join public.scratch_cards c on c.id = s.active_scratch_card_id
  left join public.scratch_card_attempts a
    on a.scratch_card_id = c.id and a.user_id = v_uid
  where s.id = true;
end;
$$;

create or replace function public.admin_scratch_cards_status()
returns table (
  active boolean,
  active_scratch_card_id uuid,
  active_scratch_card_title text,
  card_count integer,
  win_chance numeric,
  total_attempts bigint,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede ver el estado de Rasca';
  end if;

  return query
  select
    s.active,
    s.active_scratch_card_id,
    c.title as active_scratch_card_title,
    c.card_count,
    c.win_chance,
    (
      select count(*)
      from public.scratch_card_attempts a
      where a.scratch_card_id = s.active_scratch_card_id
    ) as total_attempts,
    s.updated_at
  from public.scratch_card_settings s
  left join public.scratch_cards c on c.id = s.active_scratch_card_id
  where s.id = true;
end;
$$;

create or replace function public.admin_set_scratch_cards_active(
  p_active boolean,
  p_scratch_card_id uuid default null
)
returns table (
  active boolean,
  active_scratch_card_id uuid,
  active_scratch_card_title text,
  card_count integer,
  win_chance numeric,
  total_attempts bigint,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_scratch_card_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede activar Rasca';
  end if;

  select coalesce(
    p_scratch_card_id,
    (select active_scratch_card_id from public.scratch_card_settings where id = true),
    (select id from public.scratch_cards order by created_at asc limit 1)
  )
  into v_scratch_card_id;

  if coalesce(p_active, false) and v_scratch_card_id is null then
    raise exception 'No hay juego de Rasca para activar';
  end if;

  if v_scratch_card_id is not null and not exists (
    select 1 from public.scratch_cards c where c.id = v_scratch_card_id
  ) then
    raise exception 'Juego de Rasca no encontrado';
  end if;

  update public.scratch_card_settings
  set
    active = coalesce(p_active, false),
    active_scratch_card_id = coalesce(
      v_scratch_card_id,
      scratch_card_settings.active_scratch_card_id
    ),
    updated_by = v_uid,
    updated_at = now()
  where scratch_card_settings.id = true;

  return query
  select
    r.active,
    r.active_scratch_card_id,
    r.active_scratch_card_title,
    r.card_count,
    r.win_chance,
    r.total_attempts,
    r.updated_at
  from public.admin_scratch_cards_status() r;
end;
$$;

create or replace function public.admin_scratch_cards_attempts(
  p_scratch_card_id uuid default null
)
returns table (
  scratch_card_id uuid,
  scratch_card_title text,
  user_id uuid,
  display_name text,
  wins integer,
  packs_awarded integer,
  cards jsonb,
  awarded_drop_ids text[],
  completed_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede ver los intentos de Rasca';
  end if;

  return query
  select
    a.scratch_card_id,
    c.title as scratch_card_title,
    a.user_id,
    coalesce(p.display_name, 'Usuario') as display_name,
    a.wins,
    a.packs_awarded,
    a.cards,
    a.awarded_drop_ids,
    a.completed_at
  from public.scratch_card_attempts a
  join public.scratch_cards c on c.id = a.scratch_card_id
  left join public.profiles p on p.id = a.user_id
  where p_scratch_card_id is null or a.scratch_card_id = p_scratch_card_id
  order by a.completed_at desc
  limit 200;
end;
$$;

create or replace function public.complete_scratch_cards(
  p_scratch_card_id uuid,
  p_cards jsonb default '[]'::jsonb
)
returns table (
  scratch_card_id uuid,
  wins integer,
  packs_awarded integer,
  awarded_drop_ids text[]
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_scratch_card public.scratch_cards%rowtype;
  v_allowed_pools text[] := '{}'::text[];
  v_cards jsonb := coalesce(p_cards, '[]'::jsonb);
  v_card jsonb;
  v_card_index integer;
  v_seen_cards integer := 0;
  v_slot jsonb;
  v_slot_pools text[];
  v_pool text;
  v_won boolean;
  v_win_pools text[] := '{}'::text[];
  v_sanitized_cards jsonb := '[]'::jsonb;
  v_wins integer := 0;
  v_label text;
  v_drop_id text;
  v_player_ids text[];
  v_awards text[] := '{}'::text[];
  v_inserted boolean := false;
  v_reward_index integer := 0;
  v_packs integer := 0;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  select c.* into v_scratch_card
  from public.scratch_card_settings s
  join public.scratch_cards c on c.id = s.active_scratch_card_id
  where s.id = true
    and s.active is true
    and c.id = p_scratch_card_id;

  if not found then
    raise exception 'El juego de Rasca no esta activo';
  end if;

  perform public.scratch_cards_validate_rewards(v_scratch_card.rewards);

  select coalesce(array_agg(r.item->>'pool'), '{}'::text[])
  into v_allowed_pools
  from jsonb_array_elements(v_scratch_card.rewards) as r(item);

  if jsonb_typeof(v_cards) is distinct from 'array' then
    raise exception 'Rascas invalidos';
  end if;
  if jsonb_array_length(v_cards) <> v_scratch_card.card_count then
    raise exception 'Numero de rascas invalido';
  end if;

  for v_card, v_card_index in
    select r.value, r.ordinality::integer
    from jsonb_array_elements(v_cards) with ordinality as r(value, ordinality)
  loop
    v_seen_cards := v_seen_cards + 1;
    if jsonb_typeof(v_card) is distinct from 'object'
      or jsonb_typeof(v_card->'slots') is distinct from 'array'
      or jsonb_array_length(v_card->'slots') <> 3
    then
      raise exception 'Rasca invalido';
    end if;

    v_slot_pools := '{}'::text[];

    for v_slot in
      select s.value from jsonb_array_elements(v_card->'slots') as s(value)
    loop
      if jsonb_typeof(v_slot) is distinct from 'string' then
        raise exception 'Hueco invalido';
      end if;

      v_pool := trim(both '"' from v_slot::text);
      if not (v_pool = any(v_allowed_pools)) then
        raise exception 'Sobre de rasca no valido';
      end if;

      v_slot_pools := array_append(v_slot_pools, v_pool);
    end loop;

    v_won := v_slot_pools[1] = v_slot_pools[2]
      and v_slot_pools[2] = v_slot_pools[3];

    if v_won then
      v_wins := v_wins + 1;
      v_win_pools := array_append(v_win_pools, v_slot_pools[1]);
    end if;

    v_sanitized_cards := v_sanitized_cards || jsonb_build_array(
      jsonb_build_object(
        'index', v_card_index,
        'slots', to_jsonb(v_slot_pools),
        'won', v_won
      )
    );
  end loop;

  if v_seen_cards <> v_scratch_card.card_count then
    raise exception 'Numero de rascas invalido';
  end if;

  insert into public.scratch_card_attempts (
    scratch_card_id,
    user_id,
    wins,
    packs_awarded,
    cards
  )
  values (
    v_scratch_card.id,
    v_uid,
    v_wins,
    0,
    v_sanitized_cards
  )
  on conflict (scratch_card_id, user_id) do nothing
  returning true into v_inserted;

  if not coalesce(v_inserted, false) then
    return query
    select
      a.scratch_card_id,
      a.wins,
      a.packs_awarded,
      a.awarded_drop_ids
    from public.scratch_card_attempts a
    where a.scratch_card_id = v_scratch_card.id
      and a.user_id = v_uid;
    return;
  end if;

  foreach v_pool in array v_win_pools
  loop
    v_reward_index := v_reward_index + 1;
    v_label := public.sobera_pack_label(v_pool);
    v_drop_id := 'special-rasca-' || v_pool || '-' || gen_random_uuid()::text;
    v_player_ids := public.sobera_pick_reward_player_ids(
      v_pool,
      'rasca:' || v_scratch_card.id::text || ':' || v_pool || ':' || v_uid::text || ':' || v_reward_index::text,
      '{}'::text[]
    );

    if coalesce(array_length(v_player_ids, 1), 0) <> 1 then
      raise exception 'No hay jugadores suficientes para el premio %', v_label;
    end if;

    insert into public.card_drops (
      id,
      kind,
      label,
      player_ids,
      available_at,
      created_by
    )
    values (
      v_drop_id,
      'special',
      v_label,
      v_player_ids,
      now(),
      v_uid
    )
    on conflict (id) do nothing;

    v_awards := array_append(v_awards, v_drop_id);
  end loop;

  v_packs := coalesce(array_length(v_awards, 1), 0);

  update public.scratch_card_attempts
  set
    packs_awarded = v_packs,
    awarded_drop_ids = v_awards
  where scratch_card_attempts.scratch_card_id = v_scratch_card.id
    and scratch_card_attempts.user_id = v_uid;

  return query
  select v_scratch_card.id, v_wins, v_packs, v_awards;
end;
$$;

create or replace function public.complete_scratch_cards(
  p_cards jsonb default '[]'::jsonb
)
returns table (
  scratch_card_id uuid,
  wins integer,
  packs_awarded integer,
  awarded_drop_ids text[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scratch_card_id uuid;
begin
  select active_scratch_card_id into v_scratch_card_id
  from public.scratch_card_settings
  where id = true;

  return query
  select * from public.complete_scratch_cards(v_scratch_card_id, p_cards);
end;
$$;

drop policy if exists "available card drops read" on public.card_drops;
create policy "available card drops read" on public.card_drops
  for select using (
    (available_at <= now() or public.is_admin())
    and (kind <> 'forge' or created_by = auth.uid())
    and (
      created_by is null
      or created_by = auth.uid()
      or (
        id like 'special-%'
        and id not like 'special-sobera-%'
        and id not like 'special-ruleta-%'
        and id not like 'special-oak-%'
        and id not like 'special-hoguera-%'
        and id not like 'special-portero-%'
        and id not like 'special-suarez-%'
        and id not like 'special-ronaldao-%'
        and id not like 'special-rasca-%'
      )
    )
  );

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
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_drop public.card_drops%rowtype;
  v_pool text;
  v_seen text[];
  v_player_ids text[];
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  select * into v_drop
  from public.card_drops
  where id = p_drop_id and available_at <= now();

  if not found or v_drop.kind = 'forge' then
    raise exception 'Sobre no disponible';
  end if;

  if (
    v_drop.id like 'special-sobera-%'
    or v_drop.id like 'special-ruleta-%'
    or v_drop.id like 'special-oak-%'
    or v_drop.id like 'special-hoguera-%'
    or v_drop.id like 'special-portero-%'
    or v_drop.id like 'special-suarez-%'
    or v_drop.id like 'special-ronaldao-%'
    or v_drop.id like 'special-rasca-%'
    or (v_drop.created_by is not null and v_drop.id not like 'special-%')
  ) and v_drop.created_by is distinct from v_uid then
    raise exception 'Sobre no disponible';
  end if;

  v_player_ids := v_drop.player_ids;

  if not exists (
    select 1 from public.user_cards c
    where c.user_id = v_uid and c.drop_id = v_drop.id
  ) then
    v_pool := coalesce(
      public.card_pool_from_pack_label(v_drop.label),
      case when v_drop.id like 'special-%' then 'diario' else null end
    );

    if v_pool is not null
      and (
        (v_drop.id like 'special-%' and v_drop.created_by is distinct from v_uid)
        or public.card_player_ids_need_playoff_reroll(v_drop.player_ids)
      )
    then
      v_seen := public.card_user_seen_player_ids(v_uid);
      if v_pool = 'diario' then
        v_player_ids := public.daily_pack_player_ids_avoiding(
          'drop:' || v_drop.id || ':' || v_uid::text,
          v_seen
        );
      else
        v_player_ids := public.sobera_pick_reward_player_ids(
          v_pool,
          'drop:' || v_drop.id || ':' || v_uid::text,
          v_seen
        );
      end if;

      if coalesce(array_length(v_player_ids, 1), 0) = 0 then
        v_player_ids := v_drop.player_ids;
      end if;
    end if;
  end if;

  insert into public.user_cards (user_id, drop_id, card_index, player_id)
  select v_uid, v_drop.id, cards.ordinality::integer, cards.player_id
  from unnest(v_player_ids) with ordinality as cards(player_id, ordinality)
  where cards.player_id is not null
  on conflict (user_id, drop_id, card_index) do nothing;

  return query
  select c.id, c.drop_id, c.card_index, c.player_id, c.used_at, c.created_at
  from public.user_cards c
  where c.user_id = v_uid and c.drop_id = v_drop.id
  order by c.card_index;
end;
$$;

revoke all on function public.scratch_cards_validate_rewards(jsonb) from public;
revoke all on function public.scratch_cards_public_rewards(jsonb) from public;
revoke all on function public.scratch_cards_status() from public;
revoke all on function public.admin_scratch_cards_status() from public;
revoke all on function public.admin_set_scratch_cards_active(boolean, uuid) from public;
revoke all on function public.admin_scratch_cards_attempts(uuid) from public;
revoke all on function public.complete_scratch_cards(uuid, jsonb) from public;
revoke all on function public.complete_scratch_cards(jsonb) from public;
revoke all on function public.open_card_drop(text) from public;

grant execute on function public.scratch_cards_status() to authenticated;
grant execute on function public.admin_scratch_cards_status() to authenticated;
grant execute on function public.admin_set_scratch_cards_active(boolean, uuid) to authenticated;
grant execute on function public.admin_scratch_cards_attempts(uuid) to authenticated;
grant execute on function public.complete_scratch_cards(uuid, jsonb) to authenticated;
grant execute on function public.complete_scratch_cards(jsonb) to authenticated;
grant execute on function public.open_card_drop(text) to authenticated;
