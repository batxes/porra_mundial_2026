-- Dentista Suarez: activacion admin, intento unico por usuario y premios
-- privados segun la mejor de 2 vidas.
--
-- Premio por diente seguro de la mejor partida:
--   1 -> Sobre Defensas
--   2 -> Sobre Mediocentros
--   3 -> Sobre Premier

create table if not exists public.suarez_dentists (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'DENTISTA SUAREZ',
  rewards jsonb not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.suarez_dentist_settings (
  id boolean primary key default true check (id),
  active boolean not null default false,
  active_suarez_dentist_id uuid references public.suarez_dentists(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.suarez_dentist_attempts (
  suarez_dentist_id uuid not null references public.suarez_dentists(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  best_attempt integer not null check (best_attempt >= 0),
  packs_awarded integer not null check (packs_awarded >= 0),
  attempts integer[] not null default '{}'::integer[],
  awarded_drop_ids text[] not null default '{}'::text[],
  completed_at timestamptz not null default now(),
  primary key (suarez_dentist_id, user_id)
);

create index if not exists suarez_dentist_attempts_completed_idx
  on public.suarez_dentist_attempts (completed_at desc);

alter table public.suarez_dentists enable row level security;
alter table public.suarez_dentist_settings enable row level security;
alter table public.suarez_dentist_attempts enable row level security;

drop policy if exists "public suarez dentist settings read" on public.suarez_dentist_settings;
create policy "public suarez dentist settings read" on public.suarez_dentist_settings
  for select using (true);

drop policy if exists "admin suarez dentists read" on public.suarez_dentists;
create policy "admin suarez dentists read" on public.suarez_dentists
  for select using (public.is_admin());

drop policy if exists "owner suarez dentist attempt read" on public.suarez_dentist_attempts;
create policy "owner suarez dentist attempt read" on public.suarez_dentist_attempts
  for select using (auth.uid() = user_id or public.is_admin());

grant select on public.suarez_dentist_settings to anon, authenticated;
grant select on public.suarez_dentists to authenticated;
grant select on public.suarez_dentist_attempts to authenticated;
revoke insert, update, delete on public.suarez_dentists from anon, authenticated;
revoke insert, update, delete on public.suarez_dentist_settings from anon, authenticated;
revoke insert, update, delete on public.suarez_dentist_attempts from anon, authenticated;

insert into public.suarez_dentists (
  id,
  title,
  rewards
)
values (
  '00000000-0000-0000-0000-0000000000b1'::uuid,
  'DENTISTA SUAREZ',
  '[
    { "pool": "defensas" },
    { "pool": "medios" },
    { "pool": "premier" }
  ]'::jsonb
)
on conflict (id) do nothing;

insert into public.suarez_dentist_settings (
  id,
  active,
  active_suarez_dentist_id
)
values (true, false, '00000000-0000-0000-0000-0000000000b1'::uuid)
on conflict (id) do nothing;

create or replace function public.suarez_dentist_validate_rewards(p_rewards jsonb)
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
  if jsonb_array_length(p_rewards) < 1 or jsonb_array_length(p_rewards) > 4 then
    raise exception 'Premios invalidos';
  end if;

  for v_reward in
    select value from jsonb_array_elements(p_rewards)
  loop
    if jsonb_typeof(v_reward) is distinct from 'object'
      or jsonb_typeof(v_reward->'pool') is distinct from 'string'
    then
      raise exception 'Premio invalido';
    end if;

    v_pool := v_reward->>'pool';

    if v_pool not in (
      'defensas', 'medios', 'delanteros',
      'stars', 'madrid', 'sub21', 'francia', 'premier'
    ) then
      raise exception 'Sobre de premio no valido';
    end if;
  end loop;
end;
$$;

create or replace function public.suarez_dentist_public_rewards(p_rewards jsonb)
returns jsonb
language sql
stable
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'pool', item->>'pool',
        'title', public.sobera_pack_label(item->>'pool')
      )
      order by ordinality
    ),
    '[]'::jsonb
  )
  from jsonb_array_elements(p_rewards) with ordinality as r(item, ordinality);
$$;

create or replace function public.suarez_dentist_status()
returns table (
  active boolean,
  completed boolean,
  suarez_dentist_id uuid,
  title text,
  rewards jsonb,
  best_attempt integer,
  packs_awarded integer,
  attempts integer[],
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
    d.id as suarez_dentist_id,
    d.title,
    public.suarez_dentist_public_rewards(d.rewards) as rewards,
    coalesce(a.best_attempt, 0) as best_attempt,
    coalesce(a.packs_awarded, 0) as packs_awarded,
    coalesce(a.attempts, '{}'::integer[]) as attempts,
    coalesce(a.awarded_drop_ids, '{}'::text[]) as awarded_drop_ids,
    a.completed_at
  from public.suarez_dentist_settings s
  join public.suarez_dentists d on d.id = s.active_suarez_dentist_id
  left join public.suarez_dentist_attempts a
    on a.suarez_dentist_id = d.id and a.user_id = v_uid
  where s.id = true;
end;
$$;

create or replace function public.admin_suarez_dentist_status()
returns table (
  active boolean,
  active_suarez_dentist_id uuid,
  active_suarez_dentist_title text,
  total_attempts bigint,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede ver el estado de Suarez';
  end if;

  return query
  select
    s.active,
    s.active_suarez_dentist_id,
    d.title as active_suarez_dentist_title,
    (
      select count(*)
      from public.suarez_dentist_attempts a
      where a.suarez_dentist_id = s.active_suarez_dentist_id
    ) as total_attempts,
    s.updated_at
  from public.suarez_dentist_settings s
  left join public.suarez_dentists d on d.id = s.active_suarez_dentist_id
  where s.id = true;
end;
$$;

create or replace function public.admin_set_suarez_dentist_active(
  p_active boolean,
  p_suarez_dentist_id uuid default null
)
returns table (
  active boolean,
  active_suarez_dentist_id uuid,
  active_suarez_dentist_title text,
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
  v_suarez_dentist_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede activar Suarez';
  end if;

  select coalesce(
    p_suarez_dentist_id,
    (select active_suarez_dentist_id from public.suarez_dentist_settings where id = true),
    (select id from public.suarez_dentists order by created_at asc limit 1)
  )
  into v_suarez_dentist_id;

  if coalesce(p_active, false) and v_suarez_dentist_id is null then
    raise exception 'No hay juego de Suarez para activar';
  end if;

  if v_suarez_dentist_id is not null and not exists (
    select 1 from public.suarez_dentists d where d.id = v_suarez_dentist_id
  ) then
    raise exception 'Juego de Suarez no encontrado';
  end if;

  update public.suarez_dentist_settings
  set
    active = coalesce(p_active, false),
    active_suarez_dentist_id = coalesce(v_suarez_dentist_id, suarez_dentist_settings.active_suarez_dentist_id),
    updated_by = v_uid,
    updated_at = now()
  where id = true;

  return query
  select * from public.admin_suarez_dentist_status();
end;
$$;

create or replace function public.admin_suarez_dentist_attempts(
  p_suarez_dentist_id uuid default null
)
returns table (
  suarez_dentist_id uuid,
  suarez_dentist_title text,
  user_id uuid,
  display_name text,
  best_attempt integer,
  packs_awarded integer,
  attempts integer[],
  awarded_drop_ids text[],
  completed_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede ver los intentos de Suarez';
  end if;

  return query
  select
    a.suarez_dentist_id,
    d.title as suarez_dentist_title,
    a.user_id,
    coalesce(p.display_name, 'Usuario') as display_name,
    a.best_attempt,
    a.packs_awarded,
    a.attempts,
    a.awarded_drop_ids,
    a.completed_at
  from public.suarez_dentist_attempts a
  join public.suarez_dentists d on d.id = a.suarez_dentist_id
  left join public.profiles p on p.id = a.user_id
  where p_suarez_dentist_id is null or a.suarez_dentist_id = p_suarez_dentist_id
  order by a.completed_at desc
  limit 200;
end;
$$;

create or replace function public.complete_suarez_dentist(
  p_suarez_dentist_id uuid,
  p_attempts jsonb
)
returns table (
  suarez_dentist_id uuid,
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
  v_suarez_dentist public.suarez_dentists%rowtype;
  v_attempt jsonb;
  v_attempts jsonb := coalesce(p_attempts, '[]'::jsonb);
  v_attempt_scores integer[] := '{}'::integer[];
  v_reward_count integer;
  v_score integer;
  v_best integer := 0;
  v_reward jsonb;
  v_reward_index integer;
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

  select d.* into v_suarez_dentist
  from public.suarez_dentist_settings s
  join public.suarez_dentists d on d.id = s.active_suarez_dentist_id
  where s.id = true
    and s.active is true
    and d.id = p_suarez_dentist_id;

  if not found then
    raise exception 'El juego de Suarez no esta activo';
  end if;

  perform public.suarez_dentist_validate_rewards(v_suarez_dentist.rewards);
  v_reward_count := jsonb_array_length(v_suarez_dentist.rewards);

  if jsonb_typeof(v_attempts) is distinct from 'array' then
    raise exception 'Intentos invalidos';
  end if;
  if jsonb_array_length(v_attempts) > 5 then
    raise exception 'Intentos invalidos';
  end if;

  for v_attempt in
    select value from jsonb_array_elements(v_attempts)
  loop
    if jsonb_typeof(v_attempt) is distinct from 'number' then
      raise exception 'Intento invalido';
    end if;
    v_score := greatest(
      0,
      least((v_attempt::text::numeric)::integer, v_reward_count)
    );
    v_attempt_scores := array_append(v_attempt_scores, v_score);
    v_best := greatest(v_best, v_score);
  end loop;

  insert into public.suarez_dentist_attempts (
    suarez_dentist_id,
    user_id,
    best_attempt,
    packs_awarded,
    attempts
  )
  values (
    v_suarez_dentist.id,
    v_uid,
    v_best,
    v_best,
    v_attempt_scores
  )
  on conflict (suarez_dentist_id, user_id) do nothing
  returning true into v_inserted;

  if not coalesce(v_inserted, false) then
    return query
    select a.suarez_dentist_id, a.packs_awarded, a.awarded_drop_ids
    from public.suarez_dentist_attempts a
    where a.suarez_dentist_id = v_suarez_dentist.id and a.user_id = v_uid;
    return;
  end if;

  for v_reward, v_reward_index in
    select value, ordinality::integer
    from jsonb_array_elements(v_suarez_dentist.rewards) with ordinality
  loop
    if v_reward_index > v_best then
      continue;
    end if;

    v_pool := v_reward->>'pool';
    v_label := public.sobera_pack_label(v_pool);
    v_drop_id := 'special-suarez-' || v_pool || '-' || gen_random_uuid()::text;
    v_player_ids := public.sobera_pick_reward_player_ids(
      v_pool,
      'suarez:' || v_suarez_dentist.id::text || ':' || v_pool || ':' || v_uid::text || ':' || v_reward_index::text
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

  update public.suarez_dentist_attempts
  set awarded_drop_ids = v_awards
  where suarez_dentist_attempts.suarez_dentist_id = v_suarez_dentist.id
    and suarez_dentist_attempts.user_id = v_uid;

  return query
  select v_suarez_dentist.id, v_best, v_awards;
end;
$$;

create or replace function public.complete_suarez_dentist(p_attempts jsonb)
returns table (
  suarez_dentist_id uuid,
  packs_awarded integer,
  awarded_drop_ids text[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_suarez_dentist_id uuid;
begin
  select active_suarez_dentist_id into v_suarez_dentist_id
  from public.suarez_dentist_settings
  where id = true;

  return query
  select * from public.complete_suarez_dentist(v_suarez_dentist_id, p_attempts);
end;
$$;

-- Extiende la privacidad de premios por usuario con el prefijo de Suarez.
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
        and id not like 'special-suarez-%'
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
    or v_drop.id like 'special-suarez-%'
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

revoke all on function public.suarez_dentist_validate_rewards(jsonb) from public;
revoke all on function public.suarez_dentist_public_rewards(jsonb) from public;
revoke all on function public.suarez_dentist_status() from public;
revoke all on function public.admin_suarez_dentist_status() from public;
revoke all on function public.admin_set_suarez_dentist_active(boolean, uuid) from public;
revoke all on function public.admin_suarez_dentist_attempts(uuid) from public;
revoke all on function public.complete_suarez_dentist(uuid, jsonb) from public;
revoke all on function public.complete_suarez_dentist(jsonb) from public;
revoke all on function public.open_card_drop(text) from public;

grant execute on function public.suarez_dentist_status() to authenticated;
grant execute on function public.admin_suarez_dentist_status() to authenticated;
grant execute on function public.admin_set_suarez_dentist_active(boolean, uuid) to authenticated;
grant execute on function public.admin_suarez_dentist_attempts(uuid) to authenticated;
grant execute on function public.complete_suarez_dentist(uuid, jsonb) to authenticated;
grant execute on function public.complete_suarez_dentist(jsonb) to authenticated;
grant execute on function public.open_card_drop(text) to authenticated;
