-- Refuerza el bloqueo de swaps de /cofres para partidos ya empezados y aun no
-- validados, incluso cuando el admin todavia no ha creado fila en matches.

create table if not exists public.match_lock_teams (
  number integer not null references public.match_kickoffs(number) on delete cascade,
  team_id text not null references public.teams(id) on delete cascade,
  primary key (number, team_id)
);

alter table public.match_lock_teams enable row level security;
revoke all on public.match_lock_teams from anon, authenticated;

insert into public.match_lock_teams (number, team_id)
values
  (1, 'mex'),
  (1, 'rsa'),
  (2, 'kor'),
  (2, 'cze'),
  (3, 'can'),
  (3, 'bih'),
  (4, 'usa'),
  (4, 'par'),
  (5, 'hai'),
  (5, 'sco'),
  (6, 'aus'),
  (6, 'tur'),
  (7, 'bra'),
  (7, 'mar'),
  (8, 'qat'),
  (8, 'sui'),
  (9, 'civ'),
  (9, 'ecu'),
  (10, 'ger'),
  (10, 'cuw'),
  (11, 'ned'),
  (11, 'jpn'),
  (12, 'swe'),
  (12, 'tun'),
  (13, 'ksa'),
  (13, 'uru'),
  (14, 'esp'),
  (14, 'cpv'),
  (15, 'irn'),
  (15, 'nzl'),
  (16, 'bel'),
  (16, 'egy'),
  (17, 'fra'),
  (17, 'sen'),
  (18, 'irq'),
  (18, 'nor'),
  (19, 'arg'),
  (19, 'alg'),
  (20, 'aut'),
  (20, 'jor'),
  (21, 'gha'),
  (21, 'pan'),
  (22, 'eng'),
  (22, 'cro'),
  (23, 'por'),
  (23, 'cod'),
  (24, 'uzb'),
  (24, 'col'),
  (25, 'cze'),
  (25, 'rsa'),
  (26, 'sui'),
  (26, 'bih'),
  (27, 'can'),
  (27, 'qat'),
  (28, 'mex'),
  (28, 'kor'),
  (29, 'bra'),
  (29, 'hai'),
  (30, 'sco'),
  (30, 'mar'),
  (31, 'tur'),
  (31, 'par'),
  (32, 'usa'),
  (32, 'aus'),
  (33, 'ger'),
  (33, 'civ'),
  (34, 'ecu'),
  (34, 'cuw'),
  (35, 'ned'),
  (35, 'swe'),
  (36, 'tun'),
  (36, 'jpn'),
  (37, 'uru'),
  (37, 'cpv'),
  (38, 'esp'),
  (38, 'ksa'),
  (39, 'bel'),
  (39, 'irn'),
  (40, 'nzl'),
  (40, 'egy'),
  (41, 'nor'),
  (41, 'sen'),
  (42, 'fra'),
  (42, 'irq'),
  (43, 'arg'),
  (43, 'aut'),
  (44, 'jor'),
  (44, 'alg'),
  (45, 'eng'),
  (45, 'gha'),
  (46, 'pan'),
  (46, 'cro'),
  (47, 'por'),
  (47, 'uzb'),
  (48, 'col'),
  (48, 'cod'),
  (49, 'sco'),
  (49, 'bra'),
  (50, 'mar'),
  (50, 'hai'),
  (51, 'sui'),
  (51, 'can'),
  (52, 'bih'),
  (52, 'qat'),
  (53, 'cze'),
  (53, 'mex'),
  (54, 'rsa'),
  (54, 'kor'),
  (55, 'cuw'),
  (55, 'civ'),
  (56, 'ecu'),
  (56, 'ger'),
  (57, 'jpn'),
  (57, 'swe'),
  (58, 'tun'),
  (58, 'ned'),
  (59, 'tur'),
  (59, 'usa'),
  (60, 'par'),
  (60, 'aus'),
  (61, 'nor'),
  (61, 'fra'),
  (62, 'sen'),
  (62, 'irq'),
  (63, 'egy'),
  (63, 'irn'),
  (64, 'nzl'),
  (64, 'bel'),
  (65, 'cpv'),
  (65, 'ksa'),
  (66, 'uru'),
  (66, 'esp'),
  (67, 'pan'),
  (67, 'eng'),
  (68, 'cro'),
  (68, 'gha'),
  (69, 'alg'),
  (69, 'aut'),
  (70, 'jor'),
  (70, 'arg'),
  (71, 'col'),
  (71, 'por'),
  (72, 'cod'),
  (72, 'uzb')
on conflict (number, team_id) do nothing;

create or replace function public.team_has_unvalidated_started_match(p_team_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.matches m
    where p_team_id in (m.home_team_id, m.away_team_id)
      and m.scheduled_at <= now()
      and m.status <> 'validated'
  )
  or exists (
    select 1
    from public.match_lock_teams lt
    join public.match_kickoffs k on k.number = lt.number
    left join public.matches m on m.id = 'wc26-' || lt.number::text
    where lt.team_id = p_team_id
      and k.kickoff <= now()
      and coalesce(m.status, 'scheduled') <> 'validated'
  );
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

  -- No se puede fichar ni sacar un jugador cuyo equipo tenga un partido ya
  -- empezado y todavia sin validar. Usamos match_lock_teams para cubrir el caso
  -- en el que aun no existe fila en matches porque el resultado no se ha metido.
  if exists (
    select 1
    from public.players p
    where p.id in (v_card.player_id, p_out_player_id)
      and public.team_has_unvalidated_started_match(p.team_id)
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

revoke all on function public.team_has_unvalidated_started_match(text) from public;
revoke all on function public.apply_card_swap(uuid, text) from public;
grant execute on function public.apply_card_swap(uuid, text) to authenticated;
