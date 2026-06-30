-- Ronaldao al limbo: activacion admin, intento unico por usuario y premios
-- privados segun el mejor intento de 3 vidas.

create table if not exists public.ronaldao_limbos (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'PATATA CALIENTE',
  rewards jsonb not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ronaldao_limbo_settings (
  id boolean primary key default true check (id),
  active boolean not null default false,
  active_ronaldao_limbo_id uuid references public.ronaldao_limbos(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.ronaldao_limbo_attempts (
  ronaldao_limbo_id uuid not null references public.ronaldao_limbos(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  packs_awarded integer not null check (packs_awarded between 0 and 6),
  best_round integer not null check (best_round between 1 and 3),
  round_scores jsonb not null default '[]'::jsonb,
  awarded_drop_ids text[] not null default '{}'::text[],
  completed_at timestamptz not null default now(),
  primary key (ronaldao_limbo_id, user_id)
);

create index if not exists ronaldao_limbo_attempts_completed_idx
  on public.ronaldao_limbo_attempts (completed_at desc);

alter table public.ronaldao_limbos enable row level security;
alter table public.ronaldao_limbo_settings enable row level security;
alter table public.ronaldao_limbo_attempts enable row level security;

drop policy if exists "public ronaldao limbo settings read" on public.ronaldao_limbo_settings;
create policy "public ronaldao limbo settings read" on public.ronaldao_limbo_settings
  for select using (true);

drop policy if exists "admin ronaldao limbos read" on public.ronaldao_limbos;
create policy "admin ronaldao limbos read" on public.ronaldao_limbos
  for select using (public.is_admin());

drop policy if exists "owner ronaldao limbo attempt read" on public.ronaldao_limbo_attempts;
create policy "owner ronaldao limbo attempt read" on public.ronaldao_limbo_attempts
  for select using (auth.uid() = user_id or public.is_admin());

grant select on public.ronaldao_limbo_settings to anon, authenticated;
grant select on public.ronaldao_limbos to authenticated;
grant select on public.ronaldao_limbo_attempts to authenticated;
revoke insert, update, delete on public.ronaldao_limbos from anon, authenticated;
revoke insert, update, delete on public.ronaldao_limbo_settings from anon, authenticated;
revoke insert, update, delete on public.ronaldao_limbo_attempts from anon, authenticated;

insert into public.ronaldao_limbos (
  id,
  title,
  rewards
)
values (
  '00000000-0000-0000-0000-0000000000d1'::uuid,
  'PATATA CALIENTE',
  '[
    { "pool": "defensas" },
    { "pool": "porteros" },
    { "pool": "delanteros" },
    { "pool": "medios" },
    { "pool": "sub21" },
    { "pool": "stars" }
  ]'::jsonb
)
on conflict (id) do nothing;

insert into public.ronaldao_limbo_settings (
  id,
  active,
  active_ronaldao_limbo_id
)
values (true, false, '00000000-0000-0000-0000-0000000000d1'::uuid)
on conflict (id) do nothing;

create or replace function public.ronaldao_limbo_validate_rewards(p_rewards jsonb)
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
  if jsonb_array_length(p_rewards) < 1 or jsonb_array_length(p_rewards) > 6 then
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

create or replace function public.ronaldao_limbo_public_rewards(p_rewards jsonb)
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

create or replace function public.ronaldao_limbo_status()
returns table (
  active boolean,
  completed boolean,
  ronaldao_limbo_id uuid,
  title text,
  rewards jsonb,
  packs_awarded integer,
  best_round integer,
  round_scores jsonb,
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
    l.id as ronaldao_limbo_id,
    l.title,
    public.ronaldao_limbo_public_rewards(l.rewards) as rewards,
    coalesce(a.packs_awarded, 0) as packs_awarded,
    coalesce(a.best_round, 1) as best_round,
    coalesce(a.round_scores, '[]'::jsonb) as round_scores,
    coalesce(a.awarded_drop_ids, '{}'::text[]) as awarded_drop_ids,
    a.completed_at
  from public.ronaldao_limbo_settings s
  join public.ronaldao_limbos l on l.id = s.active_ronaldao_limbo_id
  left join public.ronaldao_limbo_attempts a
    on a.ronaldao_limbo_id = l.id and a.user_id = v_uid
  where s.id = true;
end;
$$;

create or replace function public.admin_ronaldao_limbo_status()
returns table (
  active boolean,
  active_ronaldao_limbo_id uuid,
  active_ronaldao_limbo_title text,
  total_attempts bigint,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede ver el estado de Ronaldao';
  end if;

  return query
  select
    s.active,
    s.active_ronaldao_limbo_id,
    l.title as active_ronaldao_limbo_title,
    (
      select count(*)
      from public.ronaldao_limbo_attempts a
      where a.ronaldao_limbo_id = s.active_ronaldao_limbo_id
    ) as total_attempts,
    s.updated_at
  from public.ronaldao_limbo_settings s
  left join public.ronaldao_limbos l on l.id = s.active_ronaldao_limbo_id
  where s.id = true;
end;
$$;

create or replace function public.admin_set_ronaldao_limbo_active(
  p_active boolean,
  p_ronaldao_limbo_id uuid default null
)
returns table (
  active boolean,
  active_ronaldao_limbo_id uuid,
  active_ronaldao_limbo_title text,
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
  v_ronaldao_limbo_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede activar Ronaldao';
  end if;

  select coalesce(
    p_ronaldao_limbo_id,
    (select rs.active_ronaldao_limbo_id from public.ronaldao_limbo_settings rs where rs.id = true),
    (select l.id from public.ronaldao_limbos l order by l.created_at asc limit 1)
  )
  into v_ronaldao_limbo_id;

  if coalesce(p_active, false) and v_ronaldao_limbo_id is null then
    raise exception 'No hay juego de Ronaldao para activar';
  end if;

  if v_ronaldao_limbo_id is not null and not exists (
    select 1 from public.ronaldao_limbos l where l.id = v_ronaldao_limbo_id
  ) then
    raise exception 'Juego de Ronaldao no encontrado';
  end if;

  update public.ronaldao_limbo_settings
  set
    active = coalesce(p_active, false),
    active_ronaldao_limbo_id = coalesce(
      v_ronaldao_limbo_id,
      ronaldao_limbo_settings.active_ronaldao_limbo_id
    ),
    updated_by = v_uid,
    updated_at = now()
  where ronaldao_limbo_settings.id = true;

  return query
  select
    r.active,
    r.active_ronaldao_limbo_id,
    r.active_ronaldao_limbo_title,
    r.total_attempts,
    r.updated_at
  from public.admin_ronaldao_limbo_status() r;
end;
$$;

create or replace function public.admin_ronaldao_limbo_attempts(
  p_ronaldao_limbo_id uuid default null
)
returns table (
  ronaldao_limbo_id uuid,
  ronaldao_limbo_title text,
  user_id uuid,
  display_name text,
  packs_awarded integer,
  best_round integer,
  round_scores jsonb,
  awarded_drop_ids text[],
  completed_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede ver los intentos de Ronaldao';
  end if;

  return query
  select
    a.ronaldao_limbo_id,
    l.title as ronaldao_limbo_title,
    a.user_id,
    coalesce(p.display_name, 'Usuario') as display_name,
    a.packs_awarded,
    a.best_round,
    a.round_scores,
    a.awarded_drop_ids,
    a.completed_at
  from public.ronaldao_limbo_attempts a
  join public.ronaldao_limbos l on l.id = a.ronaldao_limbo_id
  left join public.profiles p on p.id = a.user_id
  where p_ronaldao_limbo_id is null or a.ronaldao_limbo_id = p_ronaldao_limbo_id
  order by a.completed_at desc
  limit 200;
end;
$$;

create or replace function public.complete_ronaldao_limbo(
  p_ronaldao_limbo_id uuid,
  p_packs integer,
  p_best_round integer default 1,
  p_round_scores jsonb default '[]'::jsonb
)
returns table (
  ronaldao_limbo_id uuid,
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
  v_ronaldao_limbo public.ronaldao_limbos%rowtype;
  v_reward jsonb;
  v_reward_index integer;
  v_pool text;
  v_label text;
  v_drop_id text;
  v_player_ids text[];
  v_awards text[] := '{}'::text[];
  v_inserted boolean := false;
  v_reward_count integer := 0;
  v_packs integer := 0;
  v_round_scores jsonb := coalesce(p_round_scores, '[]'::jsonb);
  v_score jsonb;
  v_score_count integer := 0;
  v_score_int integer := 0;
  v_best_score integer := 0;
  v_best_round integer := greatest(1, least(coalesce(p_best_round, 1), 3));
  v_sanitized_scores jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  select l.* into v_ronaldao_limbo
  from public.ronaldao_limbo_settings s
  join public.ronaldao_limbos l on l.id = s.active_ronaldao_limbo_id
  where s.id = true
    and s.active is true
    and l.id = p_ronaldao_limbo_id;

  if not found then
    raise exception 'El juego de Ronaldao no esta activo';
  end if;

  perform public.ronaldao_limbo_validate_rewards(v_ronaldao_limbo.rewards);
  v_reward_count := jsonb_array_length(v_ronaldao_limbo.rewards);

  if jsonb_typeof(v_round_scores) is distinct from 'array' then
    raise exception 'Intentos invalidos';
  end if;
  if jsonb_array_length(v_round_scores) > 3 then
    raise exception 'Intentos invalidos';
  end if;

  for v_score in
    select s.value from jsonb_array_elements(v_round_scores) as s(value)
  loop
    if jsonb_typeof(v_score) is distinct from 'number' then
      raise exception 'Intento invalido';
    end if;

    v_score_count := v_score_count + 1;
    v_score_int := greatest(
      0,
      least((v_score::text::numeric)::integer, v_reward_count, 6)
    );
    v_sanitized_scores := v_sanitized_scores || jsonb_build_array(v_score_int);

    if v_score_int > v_best_score then
      v_best_score := v_score_int;
      v_best_round := v_score_count;
    end if;
  end loop;

  if v_score_count > 0 then
    v_packs := v_best_score;
  else
    v_packs := greatest(0, least(coalesce(p_packs, 0), v_reward_count, 6));
    v_sanitized_scores := jsonb_build_array(v_packs);
  end if;

  insert into public.ronaldao_limbo_attempts (
    ronaldao_limbo_id,
    user_id,
    packs_awarded,
    best_round,
    round_scores
  )
  values (
    v_ronaldao_limbo.id,
    v_uid,
    0,
    v_best_round,
    v_sanitized_scores
  )
  on conflict (ronaldao_limbo_id, user_id) do nothing
  returning true into v_inserted;

  if not coalesce(v_inserted, false) then
    return query
    select
      a.ronaldao_limbo_id,
      a.packs_awarded,
      a.awarded_drop_ids
    from public.ronaldao_limbo_attempts a
    where a.ronaldao_limbo_id = v_ronaldao_limbo.id
      and a.user_id = v_uid;
    return;
  end if;

  for v_reward, v_reward_index in
    select r.value, r.ordinality::integer
    from jsonb_array_elements(v_ronaldao_limbo.rewards) with ordinality as r(value, ordinality)
  loop
    if v_reward_index > v_packs then
      continue;
    end if;

    v_pool := v_reward->>'pool';
    v_label := public.sobera_pack_label(v_pool);
    v_drop_id := 'special-ronaldao-' || v_pool || '-' || gen_random_uuid()::text;
    v_player_ids := public.sobera_pick_reward_player_ids(
      v_pool,
      'ronaldao:' || v_ronaldao_limbo.id::text || ':' || v_pool || ':' || v_uid::text || ':' || v_reward_index::text,
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

  update public.ronaldao_limbo_attempts
  set
    packs_awarded = v_packs,
    awarded_drop_ids = v_awards
  where ronaldao_limbo_attempts.ronaldao_limbo_id = v_ronaldao_limbo.id
    and ronaldao_limbo_attempts.user_id = v_uid;

  return query
  select v_ronaldao_limbo.id, v_packs, v_awards;
end;
$$;

create or replace function public.complete_ronaldao_limbo(
  p_packs integer,
  p_best_round integer default 1,
  p_round_scores jsonb default '[]'::jsonb
)
returns table (
  ronaldao_limbo_id uuid,
  packs_awarded integer,
  awarded_drop_ids text[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ronaldao_limbo_id uuid;
begin
  select s.active_ronaldao_limbo_id into v_ronaldao_limbo_id
  from public.ronaldao_limbo_settings s
  where s.id = true;

  return query
  select
    c.ronaldao_limbo_id,
    c.packs_awarded,
    c.awarded_drop_ids
  from public.complete_ronaldao_limbo(
    v_ronaldao_limbo_id,
    p_packs,
    p_best_round,
    p_round_scores
  ) c;
end;
$$;

-- Re-afirma la privacidad de premios por usuario con el prefijo de Ronaldao.
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

revoke all on function public.ronaldao_limbo_validate_rewards(jsonb) from public;
revoke all on function public.ronaldao_limbo_public_rewards(jsonb) from public;
revoke all on function public.ronaldao_limbo_status() from public;
revoke all on function public.admin_ronaldao_limbo_status() from public;
revoke all on function public.admin_set_ronaldao_limbo_active(boolean, uuid) from public;
revoke all on function public.admin_ronaldao_limbo_attempts(uuid) from public;
revoke all on function public.complete_ronaldao_limbo(uuid, integer, integer, jsonb) from public;
revoke all on function public.complete_ronaldao_limbo(integer, integer, jsonb) from public;
revoke all on function public.open_card_drop(text) from public;

grant execute on function public.ronaldao_limbo_status() to authenticated;
grant execute on function public.admin_ronaldao_limbo_status() to authenticated;
grant execute on function public.admin_set_ronaldao_limbo_active(boolean, uuid) to authenticated;
grant execute on function public.admin_ronaldao_limbo_attempts(uuid) to authenticated;
grant execute on function public.complete_ronaldao_limbo(uuid, integer, integer, jsonb) to authenticated;
grant execute on function public.complete_ronaldao_limbo(integer, integer, jsonb) to authenticated;
grant execute on function public.open_card_drop(text) to authenticated;
