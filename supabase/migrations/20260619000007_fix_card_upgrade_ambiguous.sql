-- Fix: "column reference \"used_at\" is ambiguous" al forjar.
-- En apply_card_upgrade (migración 20260619000005), el DELETE de las cartas
-- consumidas referenciaba `used_at` SIN cualificar, que colisiona con la columna
-- de salida `used_at` del RETURNS TABLE (en plpgsql las columnas OUT son
-- variables en scope). Le ponemos alias a la tabla (`c`) y cualificamos. El
-- resto de la función es idéntico. Mismo patrón que
-- 20260617000001_fix_open_card_drop_ambiguous.
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
  v_result text;
  v_drop_id text := 'forge-' || gen_random_uuid()::text;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  -- Ids únicos (descarta duplicados en la entrada).
  select array_agg(distinct id) into v_ids
  from unnest(coalesce(p_card_ids, '{}'::uuid[])) as id;

  if coalesce(array_length(v_ids, 1), 0) <> 4 then
    raise exception 'La forja necesita 4 cartas distintas';
  end if;

  -- Puestos de las 4 cartas (para decidir el premio antes de consumirlas).
  select array_agg(distinct p.position) into v_positions
  from public.user_cards c
  join public.players p on p.id = c.player_id
  where c.id = any(v_ids) and c.user_id = v_uid and c.used_at is null;

  v_same_position := case
    when array_length(v_positions, 1) = 1 then v_positions[1]
    else null
  end;

  -- Consumir las 4 cartas (borrado atómico). Alias `c` + columnas cualificadas
  -- para no chocar con la columna de salida `used_at` del RETURNS TABLE.
  with deleted as (
    delete from public.user_cards c
    where c.id = any(v_ids) and c.user_id = v_uid and c.used_at is null
    returning c.id
  )
  select count(*) into v_consumed from deleted;

  if v_consumed <> 4 then
    raise exception 'Alguna carta no está disponible';
  end if;

  -- Premio: legendaria aleatoria del pool 'stars'. Si las 4 eran del mismo
  -- puesto, de ese puesto; si no hubiera de ese puesto, cae a cualquiera.
  if v_same_position is not null then
    select p.id into v_result
    from public.players p
    join public.card_pool_players cp on cp.player_id = p.id and cp.pool = 'stars'
    where p.squad_status <> 'withdrawn' and p.position = v_same_position
    order by random()
    limit 1;
  end if;

  if v_result is null then
    select p.id into v_result
    from public.players p
    join public.card_pool_players cp on cp.player_id = p.id and cp.pool = 'stars'
    where p.squad_status <> 'withdrawn'
    order by random()
    limit 1;
  end if;

  if v_result is null then
    raise exception 'No hay legendarias disponibles';
  end if;

  -- Drop sintético de la forja. id 'forge-...' (NO 'special-%') para que el
  -- listado de sobres abribles no lo recoja: la carta va al inventario.
  insert into public.card_drops (id, kind, label, player_ids, available_at, created_by)
  values (v_drop_id, 'special', 'Forja', array[v_result], now(), v_uid);

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
