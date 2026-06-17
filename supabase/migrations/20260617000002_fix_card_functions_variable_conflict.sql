-- Fix definitivo del "column reference is ambiguous" (42702) al abrir sobres y
-- al hacer swaps. Estas funciones tienen parámetros de SALIDA (RETURNS TABLE)
-- cuyos nombres coinciden con columnas de las tablas (player_id, drop_id,
-- card_index, in_player_id, points_in...). Eso hace ambiguas las listas de
-- columnas de los INSERT (no basta con cualificar el SELECT). La solución
-- canónica es `#variable_conflict use_column`: ante un nombre ambiguo, usar la
-- COLUMNA. Ninguna de estas funciones lee esos params de salida como variable
-- (todas devuelven con RETURN QUERY / valores v_*), así que es seguro.

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

  if not found then
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

create or replace function public.admin_create_card_drop(
  p_label text default null,
  p_pool text default null
)
returns table (
  id text,
  kind text,
  label text,
  player_ids text[],
  available_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_drop_id text := 'special-' || gen_random_uuid()::text;
  v_label text := coalesce(nullif(trim(p_label), ''), 'Drop especial');
  v_player_ids text[];
  v_pid text;
begin
  if not public.is_admin() then
    raise exception 'Solo el admin puede soltar drops especiales';
  end if;

  if p_pool in ('stars', 'madrid', 'sub21', 'francia') then
    v_pid := coalesce(
      public.card_pool_pick(p_pool, 'special:' || v_drop_id),
      public.card_any_pick('special:' || v_drop_id)
    );
    v_player_ids := array[v_pid];
  else
    v_player_ids := public.daily_pack_player_ids('special:' || v_drop_id);
  end if;

  insert into public.card_drops (id, kind, label, player_ids, created_by)
  values (v_drop_id, 'special', v_label, v_player_ids, v_uid);

  return query
  select d.id, d.kind, d.label, d.player_ids, d.available_at, d.created_at
  from public.card_drops d
  where d.id = v_drop_id;
end;
$$;

create or replace function public.apply_card_swap(
  p_card_id uuid,
  p_out_player_id text
)
returns table (
  in_player_id text,
  out_player_id text,
  points_in integer,
  points_out integer,
  delta integer
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_card public.user_cards%rowtype;
  v_in_position text;
  v_out_position text;
  v_selections jsonb;
  v_xi jsonb;
  v_next_xi jsonb;
  v_points_in integer;
  v_points_out integer;
  v_delta integer;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  select * into v_card
  from public.user_cards
  where id = p_card_id and user_id = v_uid and used_at is null;

  if not found then
    raise exception 'Carta no disponible';
  end if;

  select position into v_in_position from public.players where id = v_card.player_id;
  select position into v_out_position from public.players where id = p_out_player_id;
  if v_in_position is null or v_out_position is null or v_in_position <> v_out_position then
    raise exception 'La carta no coincide con el puesto';
  end if;

  select selections into v_selections
  from public.predictions
  where user_id = v_uid;

  if not found then
    raise exception 'Necesitas tener una porra guardada';
  end if;

  v_xi := coalesce(v_selections -> 'xi', '[]'::jsonb);

  if exists (
    select 1 from jsonb_array_elements_text(v_xi) xi(player_id)
    where xi.player_id = v_card.player_id
  ) then
    raise exception 'Ese jugador ya esta en tu once';
  end if;

  if not exists (
    select 1 from jsonb_array_elements_text(v_xi) xi(player_id)
    where xi.player_id = p_out_player_id
  ) then
    raise exception 'Ese jugador ya no esta en tu once';
  end if;

  v_points_in := public.card_player_points(v_card.player_id);
  v_points_out := public.card_player_points(p_out_player_id);
  if not (v_points_in < v_points_out or (v_points_in = 0 and v_points_out >= 0)) then
    raise exception 'El jugador de la carta debe tener menos puntos que el que sale';
  end if;

  select jsonb_agg(
    case
      when xi.player_id = p_out_player_id then to_jsonb(v_card.player_id)
      else to_jsonb(xi.player_id)
    end
    order by xi.ordinality
  )
  into v_next_xi
  from jsonb_array_elements_text(v_xi) with ordinality as xi(player_id, ordinality);

  v_delta := v_points_in - v_points_out;

  update public.user_cards
  set used_at = now()
  where id = v_card.id;

  insert into public.card_swaps (
    user_id,
    card_id,
    in_player_id,
    out_player_id,
    points_in,
    points_out,
    delta
  )
  values (
    v_uid,
    v_card.id,
    v_card.player_id,
    p_out_player_id,
    v_points_in,
    v_points_out,
    v_delta
  );

  perform set_config('app.allow_card_swap', 'on', true);
  update public.predictions
  set selections = jsonb_set(v_selections, array['xi'], coalesce(v_next_xi, '[]'::jsonb), true),
      updated_at = now()
  where user_id = v_uid;

  return query
  select v_card.player_id, p_out_player_id, v_points_in, v_points_out, v_delta;
end;
$$;
