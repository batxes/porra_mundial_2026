-- Reclasifica jugadores que estaban como delanteros en el catalogo inicial,
-- pero su rol principal es mediapunta/centrocampista. Ryerson se corrige a
-- defensa porque es lateral/carrilero.
--
-- Igual que con Arda Guler, la posicion se consulta en vivo a traves de
-- players.player_id, asi que las cartas ya repartidas no se rompen. Si cambia:
--   * la elegibilidad de swaps, porque apply_card_swap exige misma posicion,
--   * el valor de sus goles, ponderado por posicion.
update public.players as player
set position = correction.position
from (
  values
    ('arg-16', 'MED'),
    ('arg-18', 'MED'),
    ('aus-10', 'MED'),
    ('cod-11', 'MED'),
    ('cze-15', 'MED'),
    ('esp-10', 'MED'),
    ('nor-26', 'DEF'),
    ('par-17', 'MED'),
    ('par-19', 'MED'),
    ('qat-10', 'MED'),
    ('tur-26', 'MED'),
    ('usa-11', 'MED')
) as correction(id, position)
where player.id = correction.id;
