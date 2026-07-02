-- Corrige el reto de Mourinho para que siga el mismo contrato que la hoguera:
-- los admins pueden ver/probar el modal y completar su intento, pero los sobres
-- special-mourinho-* siguen siendo privados por usuario mediante la policy.

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
    battle_attempt.user_id is not null as completed,
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
