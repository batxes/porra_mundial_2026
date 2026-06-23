-- Salta la hoguera (runner de San Juan): activacion admin, intento unico por
-- usuario y premios privados segun la distancia alcanzada.
--
-- Premio por hito (metros alcanzados en la mejor carrera):
--   25 m  -> Sobre Defensas
--   50 m  -> Sobre Mediocentros
--   75 m  -> Sobre Premier
--   100 m -> Sobre Promesas
--
-- Nota anti-trampa: el premio lo concede el servidor a partir de los metros
-- reportados por el cliente, limitados a [0, goal_meters]. Como cualquier juego
-- de habilidad de cliente, no se puede verificar la pericia (a diferencia de Oak,
-- que recalifica respuestas secretas); el servidor solo acota el rango.

create table if not exists public.hogueras (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'SALTA LA HOGUERA',
  goal_meters integer not null default 100 check (goal_meters between 10 and 1000),
  flame_every_meters integer not null default 5 check (
    flame_every_meters between 1 and 50
  ),
  rewards jsonb not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hoguera_settings (
  id boolean primary key default true check (id),
  active boolean not null default false,
  active_hoguera_id uuid references public.hogueras(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.hoguera_attempts (
  hoguera_id uuid not null references public.hogueras(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  meters_reached integer not null check (meters_reached >= 0),
  reached_goal boolean not null default false,
  awarded_drop_ids text[] not null default '{}'::text[],
  completed_at timestamptz not null default now(),
  primary key (hoguera_id, user_id)
);

create index if not exists hoguera_attempts_completed_idx
  on public.hoguera_attempts (completed_at desc);

alter table public.hogueras enable row level security;
alter table public.hoguera_settings enable row level security;
alter table public.hoguera_attempts enable row level security;

drop policy if exists "public hoguera settings read" on public.hoguera_settings;
create policy "public hoguera settings read" on public.hoguera_settings
  for select using (true);

drop policy if exists "admin hogueras read" on public.hogueras;
create policy "admin hogueras read" on public.hogueras
  for select using (public.is_admin());

drop policy if exists "owner hoguera attempt read" on public.hoguera_attempts;
create policy "owner hoguera attempt read" on public.hoguera_attempts
  for select using (auth.uid() = user_id or public.is_admin());

grant select on public.hoguera_settings to anon, authenticated;
grant select on public.hogueras to authenticated;
grant select on public.hoguera_attempts to authenticated;
revoke insert, update, delete on public.hogueras from anon, authenticated;
revoke insert, update, delete on public.hoguera_settings from anon, authenticated;
revoke insert, update, delete on public.hoguera_attempts from anon, authenticated;

insert into public.hogueras (
  id,
  title,
  goal_meters,
  flame_every_meters,
  rewards
)
values (
  '00000000-0000-0000-0000-0000000000a3'::uuid,
  'SALTA LA HOGUERA',
  100,
  5,
  '[
    { "meters": 25,  "pool": "defensas" },
    { "meters": 50,  "pool": "medios" },
    { "meters": 75,  "pool": "premier" },
    { "meters": 100, "pool": "sub21" }
  ]'::jsonb
)
on conflict (id) do nothing;

insert into public.hoguera_settings (id, active, active_hoguera_id)
values (true, false, '00000000-0000-0000-0000-0000000000a3'::uuid)
on conflict (id) do nothing;

create or replace function public.hoguera_validate_rewards(p_rewards jsonb)
returns void
language plpgsql
stable
as $$
declare
  v_reward jsonb;
  v_meters integer;
  v_pool text;
begin
  if jsonb_typeof(p_rewards) is distinct from 'array' then
    raise exception 'Premios invalidos';
  end if;
  if jsonb_array_length(p_rewards) < 1 or jsonb_array_length(p_rewards) > 6 then
    raise exception 'Premios invalidos';
  end if;

  for v_reward in
    select value from jsonb_array_elements(p_rewards)
  loop
    if jsonb_typeof(v_reward) is distinct from 'object'
      or jsonb_typeof(v_reward->'meters') is distinct from 'number'
      or jsonb_typeof(v_reward->'pool') is distinct from 'string'
    then
      raise exception 'Premio invalido';
    end if;

    v_meters := (v_reward->>'meters')::integer;
    v_pool := v_reward->>'pool';

    if v_meters < 1 or v_meters > 1000 then
      raise exception 'Metros de premio fuera de rango';
    end if;
    if v_pool not in (
      'defensas', 'medios', 'delanteros',
      'stars', 'madrid', 'sub21', 'francia', 'premier'
    ) then
      raise exception 'Sobre de premio no valido';
    end if;
  end loop;
end;
$$;

create or replace function public.hoguera_public_rewards(p_rewards jsonb)
returns jsonb
language sql
stable
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'meters', (item->>'meters')::integer,
        'pool', item->>'pool',
        'title', public.sobera_pack_label(item->>'pool')
      )
      order by (item->>'meters')::integer
    ),
    '[]'::jsonb
  )
  from jsonb_array_elements(p_rewards) as r(item);
$$;

create or replace function public.hoguera_status()
returns table (
  active boolean,
  completed boolean,
  hoguera_id uuid,
  title text,
  goal_meters integer,
  flame_every_meters integer,
  rewards jsonb,
  meters_reached integer,
  reached_goal boolean,
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
    h.id as hoguera_id,
    h.title,
    h.goal_meters,
    h.flame_every_meters,
    public.hoguera_public_rewards(h.rewards) as rewards,
    a.meters_reached,
    coalesce(a.reached_goal, false) as reached_goal,
    coalesce(a.awarded_drop_ids, '{}'::text[]) as awarded_drop_ids,
    a.completed_at
  from public.hoguera_settings s
  join public.hogueras h on h.id = s.active_hoguera_id
  left join public.hoguera_attempts a
    on a.hoguera_id = h.id and a.user_id = v_uid
  where s.id = true;
end;
$$;

create or replace function public.admin_hoguera_status()
returns table (
  active boolean,
  active_hoguera_id uuid,
  active_hoguera_title text,
  total_attempts bigint,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede ver el estado de la hoguera';
  end if;

  return query
  select
    s.active,
    s.active_hoguera_id,
    h.title as active_hoguera_title,
    (
      select count(*)
      from public.hoguera_attempts a
      where a.hoguera_id = s.active_hoguera_id
    ) as total_attempts,
    s.updated_at
  from public.hoguera_settings s
  left join public.hogueras h on h.id = s.active_hoguera_id
  where s.id = true;
end;
$$;

create or replace function public.admin_set_hoguera_active(
  p_active boolean,
  p_hoguera_id uuid default null
)
returns table (
  active boolean,
  active_hoguera_id uuid,
  active_hoguera_title text,
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
  v_hoguera_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede activar la hoguera';
  end if;

  select coalesce(
    p_hoguera_id,
    (select active_hoguera_id from public.hoguera_settings where id = true),
    (select id from public.hogueras order by created_at asc limit 1)
  )
  into v_hoguera_id;

  if coalesce(p_active, false) and v_hoguera_id is null then
    raise exception 'No hay hoguera para activar';
  end if;

  if v_hoguera_id is not null and not exists (
    select 1 from public.hogueras h where h.id = v_hoguera_id
  ) then
    raise exception 'Hoguera no encontrada';
  end if;

  update public.hoguera_settings
  set
    active = coalesce(p_active, false),
    active_hoguera_id = coalesce(v_hoguera_id, hoguera_settings.active_hoguera_id),
    updated_by = v_uid,
    updated_at = now()
  where id = true;

  return query
  select * from public.admin_hoguera_status();
end;
$$;

create or replace function public.admin_hoguera_attempts(
  p_hoguera_id uuid default null
)
returns table (
  hoguera_id uuid,
  hoguera_title text,
  user_id uuid,
  display_name text,
  meters_reached integer,
  reached_goal boolean,
  awarded_drop_ids text[],
  completed_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede ver los intentos de la hoguera';
  end if;

  return query
  select
    a.hoguera_id,
    h.title as hoguera_title,
    a.user_id,
    coalesce(p.display_name, 'Usuario') as display_name,
    a.meters_reached,
    a.reached_goal,
    a.awarded_drop_ids,
    a.completed_at
  from public.hoguera_attempts a
  join public.hogueras h on h.id = a.hoguera_id
  left join public.profiles p on p.id = a.user_id
  where p_hoguera_id is null or a.hoguera_id = p_hoguera_id
  order by a.completed_at desc
  limit 200;
end;
$$;

create or replace function public.complete_hoguera(
  p_hoguera_id uuid,
  p_meters integer
)
returns table (
  hoguera_id uuid,
  meters_reached integer,
  awarded_drop_ids text[]
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_hoguera public.hogueras%rowtype;
  v_meters integer;
  v_reached_goal boolean;
  v_reward jsonb;
  v_reward_index integer;
  v_threshold integer;
  v_pool text;
  v_label text;
  v_drop_id text;
  v_player_ids text[];
  v_awards text[] := '{}'::text[];
  v_inserted boolean := false;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  select h.* into v_hoguera
  from public.hoguera_settings s
  join public.hogueras h on h.id = s.active_hoguera_id
  where s.id = true
    and s.active is true
    and h.id = p_hoguera_id;

  if not found then
    raise exception 'La hoguera no esta activa';
  end if;

  perform public.hoguera_validate_rewards(v_hoguera.rewards);

  -- El servidor acota la distancia reportada al rango valido del juego.
  v_meters := greatest(0, least(coalesce(p_meters, 0), v_hoguera.goal_meters));
  v_reached_goal := v_meters >= v_hoguera.goal_meters;

  insert into public.hoguera_attempts (
    hoguera_id,
    user_id,
    meters_reached,
    reached_goal
  )
  values (
    v_hoguera.id,
    v_uid,
    v_meters,
    v_reached_goal
  )
  on conflict (hoguera_id, user_id) do nothing
  returning true into v_inserted;

  if not coalesce(v_inserted, false) then
    return query
    select a.hoguera_id, a.meters_reached, a.awarded_drop_ids
    from public.hoguera_attempts a
    where a.hoguera_id = v_hoguera.id and a.user_id = v_uid;
    return;
  end if;

  for v_reward, v_reward_index in
    select value, ordinality::integer
    from jsonb_array_elements(v_hoguera.rewards) with ordinality
  loop
    v_threshold := (v_reward->>'meters')::integer;
    v_pool := v_reward->>'pool';

    if v_meters < v_threshold then
      continue;
    end if;

    v_label := public.sobera_pack_label(v_pool);
    v_drop_id := 'special-hoguera-' || v_pool || '-' || gen_random_uuid()::text;
    v_player_ids := public.sobera_pick_reward_player_ids(
      v_pool,
      'hoguera:' || v_hoguera.id::text || ':' || v_pool || ':' || v_uid::text || ':' || v_reward_index::text
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

  update public.hoguera_attempts
  set awarded_drop_ids = v_awards
  where hoguera_attempts.hoguera_id = v_hoguera.id
    and hoguera_attempts.user_id = v_uid;

  return query
  select v_hoguera.id, v_meters, v_awards;
end;
$$;

create or replace function public.complete_hoguera(p_meters integer)
returns table (
  hoguera_id uuid,
  meters_reached integer,
  awarded_drop_ids text[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hoguera_id uuid;
begin
  select active_hoguera_id into v_hoguera_id
  from public.hoguera_settings
  where id = true;

  return query
  select * from public.complete_hoguera(v_hoguera_id, p_meters);
end;
$$;

-- Extiende la lectura/apertura de sobres privados para el prefijo de la hoguera.
drop policy if exists "available card drops read" on public.card_drops;
create policy "available card drops read" on public.card_drops
  for select using (
    (available_at <= now() or public.is_admin())
    and (kind <> 'forge' or created_by = auth.uid())
    and (
      (
        id not like 'special-sobera-%'
        and id not like 'special-ruleta-%'
        and id not like 'special-oak-%'
        and id not like 'special-hoguera-%'
      )
      or created_by = auth.uid()
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
    or (v_drop.created_by is not null and v_drop.id not like 'special-%')
  ) and v_drop.created_by is distinct from v_uid then
    raise exception 'Sobre no disponible';
  end if;

  insert into public.user_cards (user_id, drop_id, card_index, player_id)
  select v_uid, v_drop.id, cards.ordinality::integer, cards.player_id
  from unnest(v_drop.player_ids) with ordinality as cards(player_id, ordinality)
  on conflict (user_id, drop_id, card_index) do nothing;

  return query
  select c.id, c.drop_id, c.card_index, c.player_id, c.used_at, c.created_at
  from public.user_cards c
  where c.user_id = v_uid and c.drop_id = v_drop.id
  order by c.card_index;
end;
$$;

revoke all on function public.hoguera_validate_rewards(jsonb) from public;
revoke all on function public.hoguera_public_rewards(jsonb) from public;
revoke all on function public.hoguera_status() from public;
revoke all on function public.admin_hoguera_status() from public;
revoke all on function public.admin_set_hoguera_active(boolean, uuid) from public;
revoke all on function public.admin_hoguera_attempts(uuid) from public;
revoke all on function public.complete_hoguera(uuid, integer) from public;
revoke all on function public.complete_hoguera(integer) from public;
revoke all on function public.open_card_drop(text) from public;

grant execute on function public.hoguera_status() to authenticated;
grant execute on function public.admin_hoguera_status() to authenticated;
grant execute on function public.admin_set_hoguera_active(boolean, uuid) to authenticated;
grant execute on function public.admin_hoguera_attempts(uuid) to authenticated;
grant execute on function public.complete_hoguera(uuid, integer) to authenticated;
grant execute on function public.complete_hoguera(integer) to authenticated;
grant execute on function public.open_card_drop(text) to authenticated;
