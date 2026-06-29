-- Marrero bajo palos: activacion admin, intento unico por usuario y premios
-- privados de Sobre Porteros segun paradas en una tanda de penaltis.

create table if not exists public.portero_penalties (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'MARRERO BAJO PALOS',
  total_shots integer not null default 5 check (total_shots between 1 and 7),
  rewards jsonb not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.portero_penalty_settings (
  id boolean primary key default true check (id),
  active boolean not null default false,
  active_portero_penalty_id uuid references public.portero_penalties(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.portero_penalty_attempts (
  portero_penalty_id uuid not null references public.portero_penalties(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  saves integer not null check (saves >= 0),
  goals integer not null check (goals >= 0),
  total_shots integer not null check (total_shots between 1 and 7),
  packs_awarded integer not null check (packs_awarded >= 0),
  shots jsonb not null default '[]'::jsonb,
  awarded_drop_ids text[] not null default '{}'::text[],
  completed_at timestamptz not null default now(),
  primary key (portero_penalty_id, user_id)
);

create index if not exists portero_penalty_attempts_completed_idx
  on public.portero_penalty_attempts (completed_at desc);

alter table public.portero_penalties enable row level security;
alter table public.portero_penalty_settings enable row level security;
alter table public.portero_penalty_attempts enable row level security;

drop policy if exists "public portero penalty settings read" on public.portero_penalty_settings;
create policy "public portero penalty settings read" on public.portero_penalty_settings
  for select using (true);

drop policy if exists "admin portero penalties read" on public.portero_penalties;
create policy "admin portero penalties read" on public.portero_penalties
  for select using (public.is_admin());

drop policy if exists "owner portero penalty attempt read" on public.portero_penalty_attempts;
create policy "owner portero penalty attempt read" on public.portero_penalty_attempts
  for select using (auth.uid() = user_id or public.is_admin());

grant select on public.portero_penalty_settings to anon, authenticated;
grant select on public.portero_penalties to authenticated;
grant select on public.portero_penalty_attempts to authenticated;
revoke insert, update, delete on public.portero_penalties from anon, authenticated;
revoke insert, update, delete on public.portero_penalty_settings from anon, authenticated;
revoke insert, update, delete on public.portero_penalty_attempts from anon, authenticated;

insert into public.portero_penalties (
  id,
  title,
  total_shots,
  rewards
)
values (
  '00000000-0000-0000-0000-0000000000c1'::uuid,
  'MARRERO BAJO PALOS',
  5,
  '[
    { "minSaves": 1, "pool": "porteros" },
    { "minSaves": 2, "pool": "porteros" },
    { "minSaves": 4, "pool": "porteros" }
  ]'::jsonb
)
on conflict (id) do nothing;

insert into public.portero_penalty_settings (
  id,
  active,
  active_portero_penalty_id
)
values (true, false, '00000000-0000-0000-0000-0000000000c1'::uuid)
on conflict (id) do nothing;

create or replace function public.portero_penalty_validate_rewards(p_rewards jsonb)
returns void
language plpgsql
stable
as $$
declare
  v_reward jsonb;
  v_min_saves integer;
  v_pool text;
begin
  if jsonb_typeof(p_rewards) is distinct from 'array' then
    raise exception 'Premios invalidos';
  end if;
  if jsonb_array_length(p_rewards) < 1 or jsonb_array_length(p_rewards) > 5 then
    raise exception 'Premios invalidos';
  end if;

  for v_reward in
    select value from jsonb_array_elements(p_rewards)
  loop
    if jsonb_typeof(v_reward) is distinct from 'object'
      or jsonb_typeof(v_reward->'minSaves') is distinct from 'number'
      or jsonb_typeof(v_reward->'pool') is distinct from 'string'
    then
      raise exception 'Premio invalido';
    end if;

    v_min_saves := (v_reward->>'minSaves')::integer;
    v_pool := v_reward->>'pool';

    if v_min_saves < 1 or v_min_saves > 7 then
      raise exception 'Paradas de premio fuera de rango';
    end if;
    if v_pool not in (
      'defensas', 'medios', 'delanteros', 'porteros',
      'stars', 'madrid', 'barcelona', 'sub21', 'francia', 'premier'
    ) then
      raise exception 'Sobre de premio no valido';
    end if;
  end loop;
end;
$$;

create or replace function public.portero_penalty_public_rewards(p_rewards jsonb)
returns jsonb
language sql
stable
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'minSaves', (item->>'minSaves')::integer,
        'pool', item->>'pool',
        'title', public.sobera_pack_label(item->>'pool')
      )
      order by (item->>'minSaves')::integer
    ),
    '[]'::jsonb
  )
  from jsonb_array_elements(p_rewards) as r(item);
$$;

create or replace function public.portero_penalty_status()
returns table (
  active boolean,
  completed boolean,
  portero_penalty_id uuid,
  title text,
  total_shots integer,
  rewards jsonb,
  saves integer,
  goals integer,
  packs_awarded integer,
  shots jsonb,
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
    p.id as portero_penalty_id,
    p.title,
    p.total_shots,
    public.portero_penalty_public_rewards(p.rewards) as rewards,
    coalesce(a.saves, 0) as saves,
    coalesce(a.goals, 0) as goals,
    coalesce(a.packs_awarded, 0) as packs_awarded,
    coalesce(a.shots, '[]'::jsonb) as shots,
    coalesce(a.awarded_drop_ids, '{}'::text[]) as awarded_drop_ids,
    a.completed_at
  from public.portero_penalty_settings s
  join public.portero_penalties p on p.id = s.active_portero_penalty_id
  left join public.portero_penalty_attempts a
    on a.portero_penalty_id = p.id and a.user_id = v_uid
  where s.id = true;
end;
$$;

create or replace function public.admin_portero_penalty_status()
returns table (
  active boolean,
  active_portero_penalty_id uuid,
  active_portero_penalty_title text,
  total_attempts bigint,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede ver el estado de Portero';
  end if;

  return query
  select
    s.active,
    s.active_portero_penalty_id,
    p.title as active_portero_penalty_title,
    (
      select count(*)
      from public.portero_penalty_attempts a
      where a.portero_penalty_id = s.active_portero_penalty_id
    ) as total_attempts,
    s.updated_at
  from public.portero_penalty_settings s
  left join public.portero_penalties p on p.id = s.active_portero_penalty_id
  where s.id = true;
end;
$$;

create or replace function public.admin_set_portero_penalty_active(
  p_active boolean,
  p_portero_penalty_id uuid default null
)
returns table (
  active boolean,
  active_portero_penalty_id uuid,
  active_portero_penalty_title text,
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
  v_portero_penalty_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede activar Portero';
  end if;

  select coalesce(
    p_portero_penalty_id,
    (select active_portero_penalty_id from public.portero_penalty_settings where id = true),
    (select id from public.portero_penalties order by created_at asc limit 1)
  )
  into v_portero_penalty_id;

  if coalesce(p_active, false) and v_portero_penalty_id is null then
    raise exception 'No hay juego de Portero para activar';
  end if;

  if v_portero_penalty_id is not null and not exists (
    select 1 from public.portero_penalties p where p.id = v_portero_penalty_id
  ) then
    raise exception 'Juego de Portero no encontrado';
  end if;

  update public.portero_penalty_settings
  set
    active = coalesce(p_active, false),
    active_portero_penalty_id = coalesce(
      v_portero_penalty_id,
      portero_penalty_settings.active_portero_penalty_id
    ),
    updated_by = v_uid,
    updated_at = now()
  where id = true;

  return query
  select * from public.admin_portero_penalty_status();
end;
$$;

create or replace function public.admin_portero_penalty_attempts(
  p_portero_penalty_id uuid default null
)
returns table (
  portero_penalty_id uuid,
  portero_penalty_title text,
  user_id uuid,
  display_name text,
  saves integer,
  goals integer,
  total_shots integer,
  packs_awarded integer,
  shots jsonb,
  awarded_drop_ids text[],
  completed_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede ver los intentos de Portero';
  end if;

  return query
  select
    a.portero_penalty_id,
    p.title as portero_penalty_title,
    a.user_id,
    coalesce(pr.display_name, 'Usuario') as display_name,
    a.saves,
    a.goals,
    a.total_shots,
    a.packs_awarded,
    a.shots,
    a.awarded_drop_ids,
    a.completed_at
  from public.portero_penalty_attempts a
  join public.portero_penalties p on p.id = a.portero_penalty_id
  left join public.profiles pr on pr.id = a.user_id
  where p_portero_penalty_id is null or a.portero_penalty_id = p_portero_penalty_id
  order by a.completed_at desc
  limit 200;
end;
$$;

create or replace function public.complete_portero_penalty(
  p_portero_penalty_id uuid,
  p_saves integer,
  p_total_shots integer,
  p_shots jsonb default '[]'::jsonb
)
returns table (
  portero_penalty_id uuid,
  saves integer,
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
  v_portero_penalty public.portero_penalties%rowtype;
  v_reward jsonb;
  v_reward_index integer;
  v_min_saves integer;
  v_pool text;
  v_label text;
  v_drop_id text;
  v_player_ids text[];
  v_awards text[] := '{}'::text[];
  v_inserted boolean := false;
  v_shots jsonb := coalesce(p_shots, '[]'::jsonb);
  v_shot jsonb;
  v_sanitized_shots jsonb := '[]'::jsonb;
  v_computed_saves integer := 0;
  v_saves integer := 0;
  v_total_shots integer := 0;
  v_goals integer := 0;
  v_packs integer := 0;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  select p.* into v_portero_penalty
  from public.portero_penalty_settings s
  join public.portero_penalties p on p.id = s.active_portero_penalty_id
  where s.id = true
    and s.active is true
    and p.id = p_portero_penalty_id;

  if not found then
    raise exception 'El juego de Portero no esta activo';
  end if;

  perform public.portero_penalty_validate_rewards(v_portero_penalty.rewards);

  v_total_shots := v_portero_penalty.total_shots;

  if jsonb_typeof(v_shots) is distinct from 'array' then
    raise exception 'Tanda invalida';
  end if;

  if jsonb_array_length(v_shots) not in (0, v_total_shots) then
    raise exception 'Tanda invalida';
  end if;

  for v_shot in
    select value from jsonb_array_elements(v_shots)
  loop
    if jsonb_typeof(v_shot) is distinct from 'object'
      or jsonb_typeof(v_shot->'choice') is distinct from 'string'
      or jsonb_typeof(v_shot->'shot') is distinct from 'string'
      or jsonb_typeof(v_shot->'saved') is distinct from 'boolean'
      or (v_shot->>'choice') not in ('left', 'center', 'right')
      or (v_shot->>'shot') not in ('left', 'center', 'right')
    then
      raise exception 'Tanda invalida';
    end if;

    if (v_shot->>'saved')::boolean is true then
      v_computed_saves := v_computed_saves + 1;
    end if;

    v_sanitized_shots := v_sanitized_shots || jsonb_build_array(
      jsonb_build_object(
        'choice', v_shot->>'choice',
        'shot', v_shot->>'shot',
        'saved', (v_shot->>'saved')::boolean
      )
    );
  end loop;

  v_saves := case
    when jsonb_array_length(v_sanitized_shots) > 0 then v_computed_saves
    else greatest(0, least(coalesce(p_saves, 0), v_total_shots))
  end;
  v_goals := greatest(0, v_total_shots - v_saves);

  insert into public.portero_penalty_attempts (
    portero_penalty_id,
    user_id,
    saves,
    goals,
    total_shots,
    packs_awarded,
    shots
  )
  values (
    v_portero_penalty.id,
    v_uid,
    v_saves,
    v_goals,
    v_total_shots,
    0,
    v_sanitized_shots
  )
  on conflict (portero_penalty_id, user_id) do nothing
  returning true into v_inserted;

  if not coalesce(v_inserted, false) then
    return query
    select
      a.portero_penalty_id,
      a.saves,
      a.packs_awarded,
      a.awarded_drop_ids
    from public.portero_penalty_attempts a
    where a.portero_penalty_id = v_portero_penalty.id
      and a.user_id = v_uid;
    return;
  end if;

  for v_reward, v_reward_index in
    select value, ordinality::integer
    from jsonb_array_elements(v_portero_penalty.rewards) with ordinality
  loop
    v_min_saves := (v_reward->>'minSaves')::integer;
    v_pool := v_reward->>'pool';

    if v_saves < v_min_saves then
      continue;
    end if;

    v_label := public.sobera_pack_label(v_pool);
    v_drop_id := 'special-portero-' || v_pool || '-' || gen_random_uuid()::text;
    v_player_ids := public.sobera_pick_reward_player_ids(
      v_pool,
      'portero:' || v_portero_penalty.id::text || ':' || v_pool || ':' || v_uid::text || ':' || v_reward_index::text,
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

  update public.portero_penalty_attempts
  set
    packs_awarded = v_packs,
    awarded_drop_ids = v_awards
  where portero_penalty_attempts.portero_penalty_id = v_portero_penalty.id
    and portero_penalty_attempts.user_id = v_uid;

  return query
  select v_portero_penalty.id, v_saves, v_packs, v_awards;
end;
$$;

create or replace function public.complete_portero_penalty(
  p_saves integer,
  p_total_shots integer,
  p_shots jsonb default '[]'::jsonb
)
returns table (
  portero_penalty_id uuid,
  saves integer,
  packs_awarded integer,
  awarded_drop_ids text[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_portero_penalty_id uuid;
begin
  select active_portero_penalty_id into v_portero_penalty_id
  from public.portero_penalty_settings
  where id = true;

  return query
  select * from public.complete_portero_penalty(
    v_portero_penalty_id,
    p_saves,
    p_total_shots,
    p_shots
  );
end;
$$;

-- Re-afirma la privacidad de premios por usuario con el prefijo de Portero.
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
      )
    )
  );

revoke all on function public.portero_penalty_validate_rewards(jsonb) from public;
revoke all on function public.portero_penalty_public_rewards(jsonb) from public;
revoke all on function public.portero_penalty_status() from public;
revoke all on function public.admin_portero_penalty_status() from public;
revoke all on function public.admin_set_portero_penalty_active(boolean, uuid) from public;
revoke all on function public.admin_portero_penalty_attempts(uuid) from public;
revoke all on function public.complete_portero_penalty(uuid, integer, integer, jsonb) from public;
revoke all on function public.complete_portero_penalty(integer, integer, jsonb) from public;

grant execute on function public.portero_penalty_status() to authenticated;
grant execute on function public.admin_portero_penalty_status() to authenticated;
grant execute on function public.admin_set_portero_penalty_active(boolean, uuid) to authenticated;
grant execute on function public.admin_portero_penalty_attempts(uuid) to authenticated;
grant execute on function public.complete_portero_penalty(uuid, integer, integer, jsonb) to authenticated;
grant execute on function public.complete_portero_penalty(integer, integer, jsonb) to authenticated;
