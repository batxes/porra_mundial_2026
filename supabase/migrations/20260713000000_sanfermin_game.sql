-- San Fermín Rush: activación desde Admin, un intento por usuario y premios
-- privados. Los alias se declaran explícitamente para evitar referencias
-- ambiguas entre parámetros, variables y columnas de las funciones RPC.

create table if not exists public.sanfermin_events (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'SAN FERMIN RUSH',
  goal_meters integer not null default 160 check (goal_meters between 40 and 1000),
  hurdles_per_reward integer not null default 3 check (hurdles_per_reward between 1 and 8),
  extra_hurdles_per_run integer not null default 3 check (extra_hurdles_per_run between 0 and 8),
  rewards jsonb not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sanfermin_settings (
  id boolean primary key default true check (id),
  active boolean not null default false,
  active_sanfermin_id uuid references public.sanfermin_events(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.sanfermin_attempts (
  sanfermin_id uuid not null references public.sanfermin_events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  meters_reached integer not null check (meters_reached >= 0),
  reached_goal boolean not null default false,
  awarded_drop_ids text[] not null default '{}'::text[],
  completed_at timestamptz not null default now(),
  primary key (sanfermin_id, user_id)
);

create index if not exists sanfermin_attempts_completed_idx
  on public.sanfermin_attempts (completed_at desc);

alter table public.sanfermin_events enable row level security;
alter table public.sanfermin_settings enable row level security;
alter table public.sanfermin_attempts enable row level security;

drop policy if exists "public sanfermin settings read" on public.sanfermin_settings;
create policy "public sanfermin settings read" on public.sanfermin_settings
  for select using (true);
drop policy if exists "admin sanfermin events read" on public.sanfermin_events;
create policy "admin sanfermin events read" on public.sanfermin_events
  for select using (public.is_admin());
drop policy if exists "owner sanfermin attempts read" on public.sanfermin_attempts;
create policy "owner sanfermin attempts read" on public.sanfermin_attempts
  for select using (auth.uid() = user_id or public.is_admin());

grant select on public.sanfermin_settings to anon, authenticated;
grant select on public.sanfermin_events, public.sanfermin_attempts to authenticated;
revoke insert, update, delete on public.sanfermin_events, public.sanfermin_settings, public.sanfermin_attempts from anon, authenticated;

insert into public.sanfermin_events (
  id, title, goal_meters, hurdles_per_reward, extra_hurdles_per_run, rewards
) values (
  '00000000-0000-0000-0000-0000000000f1'::uuid,
  'SAN FERMIN RUSH',
  160,
  3,
  3,
  '[
    { "meters": 40,  "pool": "defensas" },
    { "meters": 80,  "pool": "medios" },
    { "meters": 120, "pool": "delanteros" },
    { "meters": 160, "pool": "stars" }
  ]'::jsonb
) on conflict (id) do nothing;

insert into public.sanfermin_settings (id, active, active_sanfermin_id)
values (true, false, '00000000-0000-0000-0000-0000000000f1'::uuid)
on conflict (id) do nothing;

create or replace function public.sanfermin_validate_rewards(p_rewards jsonb)
returns void language plpgsql stable as $$
declare
  v_reward jsonb;
  v_meters integer;
  v_pool text;
begin
  if jsonb_typeof(p_rewards) is distinct from 'array'
    or jsonb_array_length(p_rewards) < 1
    or jsonb_array_length(p_rewards) > 6 then
    raise exception 'Premios de San Fermín inválidos';
  end if;
  for v_reward in select reward_row.value from jsonb_array_elements(p_rewards) as reward_row(value) loop
    if jsonb_typeof(v_reward) is distinct from 'object'
      or jsonb_typeof(v_reward->'meters') is distinct from 'number'
      or jsonb_typeof(v_reward->'pool') is distinct from 'string' then
      raise exception 'Premio de San Fermín inválido';
    end if;
    v_meters := (v_reward->>'meters')::integer;
    v_pool := v_reward->>'pool';
    if v_meters < 1 or v_meters > 1000 or v_pool not in ('defensas', 'medios', 'delanteros', 'stars', 'madrid', 'sub21', 'francia', 'premier') then
      raise exception 'Premio de San Fermín fuera de rango';
    end if;
  end loop;
end;
$$;

create or replace function public.sanfermin_public_rewards(p_rewards jsonb)
returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'meters', (reward_row.item->>'meters')::integer,
    'pool', reward_row.item->>'pool',
    'title', public.sobera_pack_label(reward_row.item->>'pool')
  ) order by (reward_row.item->>'meters')::integer), '[]'::jsonb)
  from jsonb_array_elements(p_rewards) as reward_row(item);
$$;

create or replace function public.sanfermin_status()
returns table (
  active boolean, completed boolean, sanfermin_id uuid, title text,
  goal_meters integer, hurdles_per_reward integer, extra_hurdles_per_run integer,
  rewards jsonb, meters_reached integer, reached_goal boolean,
  awarded_drop_ids text[], completed_at timestamptz
) language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare v_uid uuid := auth.uid();
begin
  return query
  select settings.active, attempt.user_id is not null, event.id, event.title,
    event.goal_meters, event.hurdles_per_reward, event.extra_hurdles_per_run,
    public.sanfermin_public_rewards(event.rewards), attempt.meters_reached,
    coalesce(attempt.reached_goal, false), coalesce(attempt.awarded_drop_ids, '{}'::text[]), attempt.completed_at
  from public.sanfermin_settings as settings
  join public.sanfermin_events as event on event.id = settings.active_sanfermin_id
  left join public.sanfermin_attempts as attempt
    on attempt.sanfermin_id = event.id and attempt.user_id = v_uid
  where settings.id = true;
end;
$$;

create or replace function public.admin_sanfermin_status()
returns table (active boolean, active_sanfermin_id uuid, active_sanfermin_title text, total_attempts bigint, updated_at timestamptz)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.is_admin() then raise exception 'Solo el administrador puede ver San Fermín'; end if;
  return query
  select settings.active, settings.active_sanfermin_id, event.title,
    (select count(*) from public.sanfermin_attempts as attempt where attempt.sanfermin_id = settings.active_sanfermin_id),
    settings.updated_at
  from public.sanfermin_settings as settings
  left join public.sanfermin_events as event on event.id = settings.active_sanfermin_id
  where settings.id = true;
end;
$$;

create or replace function public.admin_set_sanfermin_active(p_active boolean, p_sanfermin_id uuid default null)
returns table (active boolean, active_sanfermin_id uuid, active_sanfermin_title text, total_attempts bigint, updated_at timestamptz)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare v_sanfermin_id uuid;
begin
  if not public.is_admin() then raise exception 'Solo el administrador puede activar San Fermín'; end if;
  select coalesce(
    p_sanfermin_id,
    (select settings.active_sanfermin_id from public.sanfermin_settings as settings where settings.id = true),
    (select event.id from public.sanfermin_events as event order by event.created_at asc limit 1)
  ) into v_sanfermin_id;
  if coalesce(p_active, false) and v_sanfermin_id is null then raise exception 'No hay evento de San Fermín para activar'; end if;
  if v_sanfermin_id is not null and not exists (select 1 from public.sanfermin_events as event where event.id = v_sanfermin_id) then raise exception 'Evento de San Fermín no encontrado'; end if;
  update public.sanfermin_settings as settings
  set active = coalesce(p_active, false), active_sanfermin_id = coalesce(v_sanfermin_id, settings.active_sanfermin_id), updated_by = auth.uid(), updated_at = now()
  where settings.id = true;
  return query select * from public.admin_sanfermin_status();
end;
$$;

create or replace function public.complete_sanfermin(p_sanfermin_id uuid, p_meters integer)
returns table (sanfermin_id uuid, meters_reached integer, awarded_drop_ids text[])
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid(); v_event public.sanfermin_events%rowtype;
  v_meters integer; v_reward jsonb; v_reward_index integer; v_threshold integer;
  v_pool text; v_drop_id text; v_player_ids text[]; v_seen text[];
  v_awards text[] := '{}'::text[]; v_inserted boolean := false;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  select event.* into v_event
  from public.sanfermin_settings as settings
  join public.sanfermin_events as event on event.id = settings.active_sanfermin_id
  where settings.id = true and settings.active is true and event.id = p_sanfermin_id;
  if not found then raise exception 'San Fermín no está activo'; end if;
  perform public.sanfermin_validate_rewards(v_event.rewards);
  v_meters := greatest(0, least(coalesce(p_meters, 0), v_event.goal_meters));
  insert into public.sanfermin_attempts as attempt (sanfermin_id, user_id, meters_reached, reached_goal)
  values (v_event.id, v_uid, v_meters, v_meters >= v_event.goal_meters)
  on conflict (sanfermin_id, user_id) do nothing returning true into v_inserted;
  if not coalesce(v_inserted, false) then
    return query select attempt.sanfermin_id, attempt.meters_reached, attempt.awarded_drop_ids
    from public.sanfermin_attempts as attempt where attempt.sanfermin_id = v_event.id and attempt.user_id = v_uid;
    return;
  end if;
  v_seen := public.card_user_seen_player_ids(v_uid);
  for v_reward, v_reward_index in
    select reward_row.value, reward_row.ordinality::integer
    from jsonb_array_elements(v_event.rewards) with ordinality as reward_row(value, ordinality)
  loop
    v_threshold := (v_reward->>'meters')::integer;
    if v_meters < v_threshold then continue; end if;
    v_pool := v_reward->>'pool';
    v_drop_id := 'special-sanfermin-' || v_pool || '-' || gen_random_uuid()::text;
    v_player_ids := public.sobera_pick_reward_player_ids(v_pool, 'sanfermin:' || v_event.id::text || ':' || v_uid::text || ':' || v_reward_index::text, v_seen);
    if coalesce(array_length(v_player_ids, 1), 0) <> 1 then raise exception 'No hay jugadores suficientes para el premio'; end if;
    insert into public.card_drops as drop_row (id, kind, label, player_ids, available_at, created_by)
    values (v_drop_id, 'special', public.sobera_pack_label(v_pool), v_player_ids, now(), v_uid)
    on conflict (id) do nothing;
    v_seen := v_seen || v_player_ids;
    v_awards := array_append(v_awards, v_drop_id);
  end loop;
  update public.sanfermin_attempts as attempt set awarded_drop_ids = v_awards
  where attempt.sanfermin_id = v_event.id and attempt.user_id = v_uid;
  return query select v_event.id, v_meters, v_awards;
end;
$$;

-- Los sobres de San Fermín son privados como los del resto de minijuegos.
drop policy if exists "available card drops read" on public.card_drops;
create policy "available card drops read" on public.card_drops for select using (
  (available_at <= now() or public.is_admin())
  and (kind <> 'forge' or created_by = auth.uid())
  and (created_by is null or created_by = auth.uid() or (
    id like 'special-%'
    and id not like 'special-sobera-%' and id not like 'special-ruleta-%'
    and id not like 'special-oak-%' and id not like 'special-hoguera-%'
    and id not like 'special-portero-%' and id not like 'special-suarez-%'
    and id not like 'special-ronaldao-%' and id not like 'special-mourinho-%'
    and id not like 'special-rasca-%' and id not like 'special-admin-%'
    and id not like 'special-sanfermin-%'
  ))
);

create or replace function public.open_card_drop(p_drop_id text)
returns table (card_id uuid, drop_id text, card_index integer, player_id text, used_at timestamptz, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare v_uid uuid := auth.uid(); v_drop public.card_drops%rowtype; v_pool text; v_seen text[]; v_player_ids text[];
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  select drop_row.* into v_drop from public.card_drops as drop_row where drop_row.id = p_drop_id and drop_row.available_at <= now();
  if not found or v_drop.kind = 'forge' then raise exception 'Sobre no disponible'; end if;
  if (v_drop.id like 'special-sobera-%' or v_drop.id like 'special-ruleta-%' or v_drop.id like 'special-oak-%' or v_drop.id like 'special-hoguera-%' or v_drop.id like 'special-portero-%' or v_drop.id like 'special-suarez-%' or v_drop.id like 'special-ronaldao-%' or v_drop.id like 'special-mourinho-%' or v_drop.id like 'special-rasca-%' or v_drop.id like 'special-admin-%' or v_drop.id like 'special-sanfermin-%' or (v_drop.created_by is not null and v_drop.id not like 'special-%')) and v_drop.created_by is distinct from v_uid then raise exception 'Sobre no disponible'; end if;
  v_player_ids := v_drop.player_ids;
  if not exists (select 1 from public.user_cards as user_card where user_card.user_id = v_uid and user_card.drop_id = v_drop.id) then
    v_pool := coalesce(public.card_pool_from_pack_label(v_drop.label), case when v_drop.id like 'special-%' then 'diario' else null end);
    if v_pool is not null and ((v_drop.id like 'special-%' and v_drop.created_by is distinct from v_uid) or public.card_player_ids_need_playoff_reroll(v_drop.player_ids)) then
      v_seen := public.card_user_seen_player_ids(v_uid);
      if v_pool = 'diario' then v_player_ids := public.daily_pack_player_ids_avoiding('drop:' || v_drop.id || ':' || v_uid::text, v_seen);
      else v_player_ids := public.sobera_pick_reward_player_ids(v_pool, 'drop:' || v_drop.id || ':' || v_uid::text, v_seen); end if;
      if coalesce(array_length(v_player_ids, 1), 0) = 0 then v_player_ids := v_drop.player_ids; end if;
    end if;
  end if;
  insert into public.user_cards (user_id, drop_id, card_index, player_id)
  select v_uid, v_drop.id, picked_cards.ordinality::integer, picked_cards.player_id
  from unnest(v_player_ids) with ordinality as picked_cards(player_id, ordinality)
  where picked_cards.player_id is not null on conflict (user_id, drop_id, card_index) do nothing;
  return query select user_card.id, user_card.drop_id, user_card.card_index, user_card.player_id, user_card.used_at, user_card.created_at
  from public.user_cards as user_card where user_card.user_id = v_uid and user_card.drop_id = v_drop.id order by user_card.card_index;
end;
$$;

revoke all on function public.sanfermin_validate_rewards(jsonb) from public;
revoke all on function public.sanfermin_public_rewards(jsonb) from public;
revoke all on function public.sanfermin_status() from public;
revoke all on function public.admin_sanfermin_status() from public;
revoke all on function public.admin_set_sanfermin_active(boolean, uuid) from public;
revoke all on function public.complete_sanfermin(uuid, integer) from public;
revoke all on function public.open_card_drop(text) from public;
grant execute on function public.sanfermin_status(), public.admin_sanfermin_status(), public.admin_set_sanfermin_active(boolean, uuid), public.complete_sanfermin(uuid, integer), public.open_card_drop(text) to authenticated;
