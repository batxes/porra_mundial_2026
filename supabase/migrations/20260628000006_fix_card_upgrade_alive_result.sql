-- La forja tambien debe respetar selecciones vivas en playoffs.
-- Ademas calcula la carta resultado antes de consumir las 4 cartas, para que
-- cualquier fallo de generacion ocurra sin tocar el inventario.

create or replace function public.apply_card_upgrade(p_card_ids uuid[])
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
  v_ids uuid[];
  v_consumed integer;
  v_positions text[];
  v_same_position text;
  v_alive text[] := public.card_alive_playoff_team_ids();
  v_result text;
  v_drop_id text := 'forge-' || gen_random_uuid()::text;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  select array_agg(distinct id) into v_ids
  from unnest(coalesce(p_card_ids, '{}'::uuid[])) as id;

  if coalesce(array_length(v_ids, 1), 0) <> 4 then
    raise exception 'La forja necesita 4 cartas distintas';
  end if;

  select array_agg(distinct p.position) into v_positions
  from public.user_cards c
  join public.players p on p.id = c.player_id
  where c.id = any(v_ids) and c.user_id = v_uid and c.used_at is null;

  v_same_position := case
    when array_length(v_positions, 1) = 1 then v_positions[1]
    else null
  end;

  if v_same_position is not null then
    select p.id into v_result
    from public.players p
    join public.card_pool_players cp on cp.player_id = p.id and cp.pool = 'stars'
    where p.squad_status <> 'withdrawn'
      and p.position = v_same_position
      and (
        coalesce(array_length(v_alive, 1), 0) = 0
        or p.team_id = any(v_alive)
      )
    order by random()
    limit 1;
  end if;

  if v_result is null then
    select p.id into v_result
    from public.players p
    join public.card_pool_players cp on cp.player_id = p.id and cp.pool = 'stars'
    where p.squad_status <> 'withdrawn'
      and (
        coalesce(array_length(v_alive, 1), 0) = 0
        or p.team_id = any(v_alive)
      )
    order by random()
    limit 1;
  end if;

  if v_result is null then
    raise exception 'No hay legendarias vivas disponibles';
  end if;

  with consumed as (
    update public.user_cards c
    set used_at = now()
    where c.id = any(v_ids) and c.user_id = v_uid and c.used_at is null
    returning c.id
  )
  select count(*) into v_consumed from consumed;

  if v_consumed <> 4 then
    raise exception 'Alguna carta no esta disponible';
  end if;

  insert into public.card_drops (id, kind, label, player_ids, available_at, created_by)
  values (v_drop_id, 'forge', 'Forja', array[v_result], now(), v_uid);

  insert into public.user_cards (user_id, drop_id, card_index, player_id)
  values (v_uid, v_drop_id, 1, v_result);

  return query
  select c.id, c.drop_id, c.card_index, c.player_id, c.used_at, c.created_at
  from public.user_cards c
  where c.user_id = v_uid and c.drop_id = v_drop_id;
end;
$$;

revoke all on function public.apply_card_upgrade(uuid[]) from public;
grant execute on function public.apply_card_upgrade(uuid[]) to authenticated;
