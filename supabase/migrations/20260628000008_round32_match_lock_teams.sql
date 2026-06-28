-- Bloquea swaps de /cofres para los cruces reales de dieciseisavos ya
-- resueltos. El calendario base guarda slots ("Runner-up Group A"), asi que
-- match_lock_teams necesita los equipos reales hasta que exista fila en matches.

insert into public.match_lock_teams (number, team_id)
values
  (73, 'rsa'),
  (73, 'can'),
  (74, 'ger'),
  (74, 'par'),
  (75, 'ned'),
  (75, 'mar'),
  (76, 'bra'),
  (76, 'jpn'),
  (77, 'fra'),
  (77, 'swe'),
  (78, 'civ'),
  (78, 'nor'),
  (79, 'mex'),
  (79, 'ecu'),
  (80, 'eng'),
  (80, 'cod'),
  (81, 'usa'),
  (81, 'bih'),
  (82, 'bel'),
  (82, 'sen'),
  (83, 'por'),
  (83, 'cro'),
  (84, 'esp'),
  (84, 'aut'),
  (85, 'sui'),
  (85, 'alg'),
  (86, 'arg'),
  (86, 'cpv'),
  (87, 'col'),
  (87, 'gha'),
  (88, 'aus'),
  (88, 'egy')
on conflict (number, team_id) do nothing;
