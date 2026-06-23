-- Reinicio de la ronda de la hoguera.
--
-- Un bug del cliente (el bucle del juego se reiniciaba cuando el gate refrescaba
-- su config por el polling de 30s / el evento focus) dejo partidas cortadas y a
-- algunos jugadores con su intento unico gastado de forma injusta.
--
-- Vaciamos los intentos de la hoguera activa para que TODOS vuelvan a tener su
-- unica jugada, ya sobre la version arreglada. Los sobres que se hubieran
-- concedido durante el fallo se conservan (no se tocan los card_drops).
delete from public.hoguera_attempts
where hoguera_id = '00000000-0000-0000-0000-0000000000a3'::uuid;
