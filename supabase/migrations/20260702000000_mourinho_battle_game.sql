-- Reto Mourinho: combate activable desde admin, intento unico por usuario y
-- premios privados por cada Pokemon de Mourinho derrotado.

create table if not exists public.mourinho_battles (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'RETO MOURINHO',
  rewards jsonb not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.mourinho_battle_settings (
  id boolean primary key default true check (id),
  active boolean not null default false,
  active_mourinho_battle_id uuid references public.mourinho_battles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.mourinho_battle_attempts (
  mourinho_battle_id uuid not null references public.mourinho_battles(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  defeated_count integer not null check (defeated_count between 0 and 5),
  defeated_pokemon_ids text[] not null default '{}'::text[],
  packs_awarded integer not null check (packs_awarded between 0 and 5),
  awarded_drop_ids text[] not null default '{}'::text[],
  completed_at timestamptz not null default now(),
  primary key (mourinho_battle_id, user_id)
);

create index if not exists mourinho_battle_attempts_completed_idx
  on public.mourinho_battle_attempts (completed_at desc);

alter table public.mourinho_battles enable row level security;
alter table public.mourinho_battle_settings enable row level security;
alter table public.mourinho_battle_attempts enable row level security;

drop policy if exists "public mourinho battle settings read" on public.mourinho_battle_settings;
create policy "public mourinho battle settings read" on public.mourinho_battle_settings
  for select using (true);

drop policy if exists "admin mourinho battles read" on public.mourinho_battles;
create policy "admin mourinho battles read" on public.mourinho_battles
  for select using (public.is_admin());

drop policy if exists "owner mourinho battle attempt read" on public.mourinho_battle_attempts;
create policy "owner mourinho battle attempt read" on public.mourinho_battle_attempts
  for select using (auth.uid() = user_id or public.is_admin());

grant select on public.mourinho_battle_settings to anon, authenticated;
grant select on public.mourinho_battles to authenticated;
grant select on public.mourinho_battle_attempts to authenticated;
revoke insert, update, delete on public.mourinho_battles from anon, authenticated;
revoke insert, update, delete on public.mourinho_battle_settings from anon, authenticated;
revoke insert, update, delete on public.mourinho_battle_attempts from anon, authenticated;

insert into public.mourinho_battles (
  id,
  title,
  rewards
)
values (
  '00000000-0000-0000-0000-0000000000b7'::uuid,
  'RETO MOURINHO',
  '[
    { "pool": "defensas" },
    { "pool": "medios" },
    { "pool": "madrid" },
    { "pool": "sub21" },
    { "pool": "stars" }
  ]'::jsonb
)
on conflict (id) do update set
  title = excluded.title,
  rewards = excluded.rewards,
  updated_at = now();

insert into public.mourinho_battle_settings (
  id,
  active,
  active_mourinho_battle_id
)
values (true, false, '00000000-0000-0000-0000-0000000000b7'::uuid)
on conflict (id) do update set
  active_mourinho_battle_id = coalesce(
    mourinho_battle_settings.active_mourinho_battle_id,
    excluded.active_mourinho_battle_id
  );

create or replace function public.mourinho_battle_validate_rewards(p_rewards jsonb)
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
  if jsonb_array_length(p_rewards) < 1 or jsonb_array_length(p_rewards) > 5 then
    raise exception 'Premios invalidos';
  end if;

  for v_reward in
    select reward_row.value from jsonb_array_elements(p_rewards) as reward_row(value)
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

create or replace function public.mourinho_battle_public_rewards(p_rewards jsonb)
returns jsonb
language sql
stable
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'pool', reward_row.item->>'pool',
        'title', public.sobera_pack_label(reward_row.item->>'pool')
      )
      order by reward_row.ordinality
    ),
    '[]'::jsonb
  )
  from jsonb_array_elements(p_rewards) with ordinality as reward_row(item, ordinality);
$$;

create or replace function public.mourinho_battle_status()
returns table (
  active boolean,
  completed boolean,
  mourinho_battle_id uuid,
  title text,
  rewards jsonb,
  defeated_count integer,
  defeated_pokemon_ids text[],
  packs_awarded integer,
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
    battle_settings.active,
    case
      when public.is_admin() then true
      else battle_attempt.user_id is not null
    end as completed,
    battle.id as mourinho_battle_id,
    battle.title,
    public.mourinho_battle_public_rewards(battle.rewards) as rewards,
    coalesce(battle_attempt.defeated_count, 0) as defeated_count,
    coalesce(battle_attempt.defeated_pokemon_ids, '{}'::text[]) as defeated_pokemon_ids,
    coalesce(battle_attempt.packs_awarded, 0) as packs_awarded,
    coalesce(battle_attempt.awarded_drop_ids, '{}'::text[]) as awarded_drop_ids,
    battle_attempt.completed_at
  from public.mourinho_battle_settings as battle_settings
  join public.mourinho_battles as battle
    on battle.id = battle_settings.active_mourinho_battle_id
  left join public.mourinho_battle_attempts as battle_attempt
    on battle_attempt.mourinho_battle_id = battle.id
    and battle_attempt.user_id = v_uid
  where battle_settings.id = true;
end;
$$;

create or replace function public.admin_mourinho_battle_status()
returns table (
  active boolean,
  active_mourinho_battle_id uuid,
  active_mourinho_battle_title text,
  total_attempts bigint,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede ver el estado de Mourinho';
  end if;

  return query
  select
    battle_settings.active,
    battle_settings.active_mourinho_battle_id,
    battle.title as active_mourinho_battle_title,
    (
      select count(*)
      from public.mourinho_battle_attempts as battle_attempt
      where battle_attempt.mourinho_battle_id = battle_settings.active_mourinho_battle_id
    ) as total_attempts,
    battle_settings.updated_at
  from public.mourinho_battle_settings as battle_settings
  left join public.mourinho_battles as battle
    on battle.id = battle_settings.active_mourinho_battle_id
  where battle_settings.id = true;
end;
$$;

create or replace function public.admin_set_mourinho_battle_active(
  p_active boolean,
  p_mourinho_battle_id uuid default null
)
returns table (
  active boolean,
  active_mourinho_battle_id uuid,
  active_mourinho_battle_title text,
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
  v_mourinho_battle_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede activar Mourinho';
  end if;

  select coalesce(
    p_mourinho_battle_id,
    (
      select battle_settings.active_mourinho_battle_id
      from public.mourinho_battle_settings as battle_settings
      where battle_settings.id = true
    ),
    (
      select battle.id
      from public.mourinho_battles as battle
      order by battle.created_at asc
      limit 1
    )
  )
  into v_mourinho_battle_id;

  if coalesce(p_active, false) and v_mourinho_battle_id is null then
    raise exception 'No hay reto de Mourinho para activar';
  end if;

  if v_mourinho_battle_id is not null and not exists (
    select 1
    from public.mourinho_battles as battle
    where battle.id = v_mourinho_battle_id
  ) then
    raise exception 'Reto de Mourinho no encontrado';
  end if;

  update public.mourinho_battle_settings as battle_settings
  set
    active = coalesce(p_active, false),
    active_mourinho_battle_id = coalesce(
      v_mourinho_battle_id,
      battle_settings.active_mourinho_battle_id
    ),
    updated_by = v_uid,
    updated_at = now()
  where battle_settings.id = true;

  return query
  select
    admin_status.active,
    admin_status.active_mourinho_battle_id,
    admin_status.active_mourinho_battle_title,
    admin_status.total_attempts,
    admin_status.updated_at
  from public.admin_mourinho_battle_status() as admin_status;
end;
$$;

create or replace function public.admin_mourinho_battle_attempts(
  p_mourinho_battle_id uuid default null
)
returns table (
  mourinho_battle_id uuid,
  mourinho_battle_title text,
  user_id uuid,
  display_name text,
  defeated_count integer,
  defeated_pokemon_ids text[],
  packs_awarded integer,
  awarded_drop_ids text[],
  completed_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede ver los intentos de Mourinho';
  end if;

  return query
  select
    battle_attempt.mourinho_battle_id,
    battle.title as mourinho_battle_title,
    battle_attempt.user_id,
    coalesce(profile.display_name, 'Usuario') as display_name,
    battle_attempt.defeated_count,
    battle_attempt.defeated_pokemon_ids,
    battle_attempt.packs_awarded,
    battle_attempt.awarded_drop_ids,
    battle_attempt.completed_at
  from public.mourinho_battle_attempts as battle_attempt
  join public.mourinho_battles as battle
    on battle.id = battle_attempt.mourinho_battle_id
  left join public.profiles as profile
    on profile.id = battle_attempt.user_id
  where p_mourinho_battle_id is null
    or battle_attempt.mourinho_battle_id = p_mourinho_battle_id
  order by battle_attempt.completed_at desc
  limit 200;
end;
$$;

create or replace function public.complete_mourinho_battle(
  p_mourinho_battle_id uuid,
  p_defeated_pokemon_ids text[] default '{}'::text[]
)
returns table (
  mourinho_battle_id uuid,
  defeated_count integer,
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
  v_mourinho_battle public.mourinho_battles%rowtype;
  v_allowed_ids text[] := array[
    'dragonite',
    'infernape',
    'alakazam',
    'toxicroak',
    'garchomp'
  ];
  v_defeated_ids text[] := '{}'::text[];
  v_pokemon_id text;
  v_reward jsonb;
  v_reward_index integer;
  v_reward_count integer := 0;
  v_defeated_count integer := 0;
  v_pool text;
  v_label text;
  v_drop_id text;
  v_player_ids text[];
  v_seen text[];
  v_awards text[] := '{}'::text[];
  v_inserted boolean := false;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  if public.is_admin() then
    raise exception 'Los administradores no pueden reclamar premios de Mourinho';
  end if;

  select battle.* into v_mourinho_battle
  from public.mourinho_battle_settings as battle_settings
  join public.mourinho_battles as battle
    on battle.id = battle_settings.active_mourinho_battle_id
  where battle_settings.id = true
    and battle_settings.active is true
    and battle.id = p_mourinho_battle_id;

  if not found then
    raise exception 'El reto de Mourinho no esta activo';
  end if;

  perform public.mourinho_battle_validate_rewards(v_mourinho_battle.rewards);
  v_reward_count := jsonb_array_length(v_mourinho_battle.rewards);

  foreach v_pokemon_id in array v_allowed_ids
  loop
    if v_pokemon_id = any(coalesce(p_defeated_pokemon_ids, '{}'::text[])) then
      v_defeated_ids := array_append(v_defeated_ids, v_pokemon_id);
    end if;
  end loop;

  v_defeated_count := least(
    coalesce(array_length(v_defeated_ids, 1), 0),
    v_reward_count,
    5
  );

  insert into public.mourinho_battle_attempts (
    mourinho_battle_id,
    user_id,
    defeated_count,
    defeated_pokemon_ids,
    packs_awarded
  )
  values (
    v_mourinho_battle.id,
    v_uid,
    v_defeated_count,
    v_defeated_ids,
    0
  )
  on conflict (mourinho_battle_id, user_id) do nothing
  returning true into v_inserted;

  if not coalesce(v_inserted, false) then
    return query
    select
      battle_attempt.mourinho_battle_id,
      battle_attempt.defeated_count,
      battle_attempt.packs_awarded,
      battle_attempt.awarded_drop_ids
    from public.mourinho_battle_attempts as battle_attempt
    where battle_attempt.mourinho_battle_id = v_mourinho_battle.id
      and battle_attempt.user_id = v_uid;
    return;
  end if;

  v_seen := public.card_user_seen_player_ids(v_uid);

  for v_reward, v_reward_index in
    select reward_row.value, reward_row.ordinality::integer
    from jsonb_array_elements(v_mourinho_battle.rewards) with ordinality as reward_row(value, ordinality)
  loop
    if v_reward_index > v_defeated_count then
      continue;
    end if;

    v_pool := v_reward->>'pool';
    v_label := public.sobera_pack_label(v_pool);
    v_drop_id := 'special-mourinho-' || v_pool || '-' || gen_random_uuid()::text;
    v_player_ids := public.sobera_pick_reward_player_ids(
      v_pool,
      'mourinho:' || v_mourinho_battle.id::text || ':' || v_pool || ':' || v_uid::text || ':' || v_reward_index::text,
      v_seen
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

    v_seen := v_seen || v_player_ids;
    v_awards := array_append(v_awards, v_drop_id);
  end loop;

  update public.mourinho_battle_attempts as battle_attempt
  set
    packs_awarded = coalesce(array_length(v_awards, 1), 0),
    awarded_drop_ids = v_awards
  where battle_attempt.mourinho_battle_id = v_mourinho_battle.id
    and battle_attempt.user_id = v_uid;

  return query
  select
    v_mourinho_battle.id,
    v_defeated_count,
    coalesce(array_length(v_awards, 1), 0),
    v_awards;
end;
$$;

create or replace function public.complete_mourinho_battle(
  p_defeated_pokemon_ids text[] default '{}'::text[]
)
returns table (
  mourinho_battle_id uuid,
  defeated_count integer,
  packs_awarded integer,
  awarded_drop_ids text[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mourinho_battle_id uuid;
begin
  select battle_settings.active_mourinho_battle_id
  into v_mourinho_battle_id
  from public.mourinho_battle_settings as battle_settings
  where battle_settings.id = true;

  return query
  select
    completed.mourinho_battle_id,
    completed.defeated_count,
    completed.packs_awarded,
    completed.awarded_drop_ids
  from public.complete_mourinho_battle(
    v_mourinho_battle_id,
    p_defeated_pokemon_ids
  ) as completed;
end;
$$;

-- Re-afirma privacidad: los premios special-mourinho-* solo los ve su usuario.
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
        and id not like 'special-mourinho-%'
        and id not like 'special-rasca-%'
        and id not like 'special-admin-%'
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

  select drop_row.*
  into v_drop
  from public.card_drops as drop_row
  where drop_row.id = p_drop_id
    and drop_row.available_at <= now();

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
    or v_drop.id like 'special-mourinho-%'
    or v_drop.id like 'special-rasca-%'
    or v_drop.id like 'special-admin-%'
    or (v_drop.created_by is not null and v_drop.id not like 'special-%')
  ) and v_drop.created_by is distinct from v_uid then
    raise exception 'Sobre no disponible';
  end if;

  v_player_ids := v_drop.player_ids;

  if not exists (
    select 1
    from public.user_cards as user_card
    where user_card.user_id = v_uid
      and user_card.drop_id = v_drop.id
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
  select
    v_uid,
    v_drop.id,
    picked_cards.ordinality::integer,
    picked_cards.player_id
  from unnest(v_player_ids) with ordinality as picked_cards(player_id, ordinality)
  where picked_cards.player_id is not null
  on conflict (user_id, drop_id, card_index) do nothing;

  return query
  select
    user_card.id,
    user_card.drop_id,
    user_card.card_index,
    user_card.player_id,
    user_card.used_at,
    user_card.created_at
  from public.user_cards as user_card
  where user_card.user_id = v_uid
    and user_card.drop_id = v_drop.id
  order by user_card.card_index;
end;
$$;

revoke all on function public.mourinho_battle_validate_rewards(jsonb) from public;
revoke all on function public.mourinho_battle_public_rewards(jsonb) from public;
revoke all on function public.mourinho_battle_status() from public;
revoke all on function public.admin_mourinho_battle_status() from public;
revoke all on function public.admin_set_mourinho_battle_active(boolean, uuid) from public;
revoke all on function public.admin_mourinho_battle_attempts(uuid) from public;
revoke all on function public.complete_mourinho_battle(uuid, text[]) from public;
revoke all on function public.complete_mourinho_battle(text[]) from public;
revoke all on function public.open_card_drop(text) from public;

grant execute on function public.mourinho_battle_status() to authenticated;
grant execute on function public.admin_mourinho_battle_status() to authenticated;
grant execute on function public.admin_set_mourinho_battle_active(boolean, uuid) to authenticated;
grant execute on function public.admin_mourinho_battle_attempts(uuid) to authenticated;
grant execute on function public.complete_mourinho_battle(uuid, text[]) to authenticated;
grant execute on function public.complete_mourinho_battle(text[]) to authenticated;
grant execute on function public.open_card_drop(text) to authenticated;
