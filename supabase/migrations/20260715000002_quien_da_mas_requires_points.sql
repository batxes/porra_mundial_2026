-- Solo participan en Quién da más los usuarios que ya tienen puntuación real
-- en la porra. La comprobación se hace tanto al consultar el juego como al
-- completar la partida, para que no se pueda esquivar desde el navegador.

create or replace function public.quien_da_mas_status()
returns table (
  active boolean, completed boolean, game_id uuid, title text, duel_time_ms integer,
  duels jsonb, rewards jsonb, score integer, awarded_drop_ids text[], completed_at timestamptz
) language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare v_uid uuid := auth.uid();
begin
  return query
  select
    settings.active and coalesce(profile.total_points, 0) > 0,
    attempt.user_id is not null,
    game.id,
    game.title,
    game.duel_time_ms,
    game.duels,
    public.quien_da_mas_public_rewards(game.rewards),
    attempt.score,
    coalesce(attempt.awarded_drop_ids, '{}'::text[]),
    attempt.completed_at
  from public.quien_da_mas_settings as settings
  join public.quien_da_mas_games as game on game.id = settings.active_game_id
  left join public.profiles as profile on profile.id = v_uid
  left join public.quien_da_mas_attempts as attempt
    on attempt.game_id = game.id and attempt.user_id = v_uid
  where settings.id = true;
end;
$$;

create or replace function public.complete_quien_da_mas(p_game_id uuid, p_picks jsonb)
returns table (game_id uuid, score integer, awarded_drop_ids text[])
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_game public.quien_da_mas_games%rowtype;
  v_duel jsonb;
  v_index integer;
  v_entry jsonb;
  v_pick text;
  v_correct integer := 0;
  v_reward jsonb;
  v_reward_index integer;
  v_threshold integer;
  v_pool text;
  v_drop_id text;
  v_player_ids text[];
  v_seen text[];
  v_awards text[] := '{}'::text[];
  v_inserted boolean := false;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not exists (
    select 1
    from public.profiles as profile
    where profile.id = v_uid and profile.total_points > 0
  ) then
    raise exception 'Necesitas al menos 1 punto en la porra para jugar';
  end if;

  select game.* into v_game
  from public.quien_da_mas_settings as settings
  join public.quien_da_mas_games as game on game.id = settings.active_game_id
  where settings.id = true and settings.active is true and game.id = p_game_id;
  if not found then raise exception 'Quién da más no está activo'; end if;
  perform public.quien_da_mas_validate_duels(v_game.duels);
  perform public.quien_da_mas_validate_rewards(v_game.rewards);
  if jsonb_typeof(p_picks) is distinct from 'array'
    or jsonb_array_length(p_picks) <> jsonb_array_length(v_game.duels) then
    raise exception 'Las respuestas no son válidas';
  end if;

  for v_duel, v_index in
    select duel_row.value, duel_row.ordinality::integer
    from jsonb_array_elements(v_game.duels) with ordinality as duel_row(value, ordinality)
  loop
    v_entry := p_picks -> (v_index - 1);
    if jsonb_typeof(v_entry) = 'null' then
      continue;
    end if;
    v_pick := p_picks ->> (v_index - 1);
    if jsonb_typeof(v_entry) is distinct from 'string' or v_pick not in ('a', 'b') then
      raise exception 'Las respuestas no son válidas';
    end if;
    if (v_pick = 'a' and (v_duel->'a'->>'value')::numeric > (v_duel->'b'->>'value')::numeric)
      or (v_pick = 'b' and (v_duel->'b'->>'value')::numeric > (v_duel->'a'->>'value')::numeric) then
      v_correct := v_correct + 1;
    end if;
  end loop;

  insert into public.quien_da_mas_attempts as attempt (game_id, user_id, picks, score)
  values (v_game.id, v_uid, p_picks, v_correct)
  on conflict (game_id, user_id) do nothing
  returning true into v_inserted;
  if not coalesce(v_inserted, false) then
    return query
    select attempt.game_id, attempt.score, attempt.awarded_drop_ids
    from public.quien_da_mas_attempts as attempt
    where attempt.game_id = v_game.id and attempt.user_id = v_uid;
    return;
  end if;

  v_seen := public.card_user_seen_player_ids(v_uid);
  for v_reward, v_reward_index in
    select reward_row.value, reward_row.ordinality::integer
    from jsonb_array_elements(v_game.rewards) with ordinality as reward_row(value, ordinality)
  loop
    v_threshold := (v_reward->>'minScore')::integer;
    if v_correct < v_threshold then continue; end if;
    v_pool := v_reward->>'pool';
    v_drop_id := 'special-quiendamas-' || v_pool || '-' || gen_random_uuid()::text;
    v_player_ids := public.sobera_pick_reward_player_ids(
      v_pool,
      'quiendamas:' || v_game.id::text || ':' || v_uid::text || ':' || v_reward_index::text,
      v_seen
    );
    if coalesce(array_length(v_player_ids, 1), 0) <> 1 then
      raise exception 'No hay jugadores suficientes para el premio';
    end if;
    insert into public.card_drops as drop_row (id, kind, label, player_ids, available_at, created_by)
    values (v_drop_id, 'special', public.sobera_pack_label(v_pool), v_player_ids, now(), v_uid)
    on conflict (id) do nothing;
    v_seen := v_seen || v_player_ids;
    v_awards := array_append(v_awards, v_drop_id);
  end loop;
  update public.quien_da_mas_attempts as attempt
  set awarded_drop_ids = v_awards
  where attempt.game_id = v_game.id and attempt.user_id = v_uid;
  return query select v_game.id, v_correct, v_awards;
end;
$$;

revoke all on function public.quien_da_mas_status() from public;
revoke all on function public.complete_quien_da_mas(uuid, jsonb) from public;
grant execute on function public.quien_da_mas_status(), public.complete_quien_da_mas(uuid, jsonb) to authenticated;
