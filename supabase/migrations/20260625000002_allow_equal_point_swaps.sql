-- Permite swaps con la misma puntuacion (10 -> 10, 0 -> 0, etc.).
-- La regla sigue bloqueando cambios que suben puntos a posteriori.

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

  -- Anti-trampa "partido en vivo": no se puede fichar NI sacar a un jugador cuyo
  -- equipo tenga un partido ya empezado y todavia sin validar. En esa ventana el
  -- usuario ve el partido pero los eventos aun no estan en la BBDD, asi que el
  -- cambio capturaria (o esquivaria) puntos a posteriori.
  if exists (
    select 1
    from public.matches m
    join public.players p
      on p.team_id in (m.home_team_id, m.away_team_id)
    where p.id in (v_card.player_id, p_out_player_id)
      and m.scheduled_at <= now()
      and m.status <> 'validated'
  ) then
    raise exception 'No puedes cambiar a un jugador mientras su equipo esta en juego. Disponible cuando se valide el partido.';
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
  if v_points_in > v_points_out then
    raise exception 'El jugador de la carta no puede tener mas puntos que el que sale';
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

grant execute on function public.apply_card_swap(uuid, text) to authenticated;
