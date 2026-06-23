-- Reinicio TOTAL de la hoguera.
--
-- Un bug del cliente (el bucle se reiniciaba al refrescar el gate su config por
-- polling/focus) dejo partidas cortadas e intentos injustos. Borramos TODOS los
-- intentos (sin filtrar por hoguera_id, para no dejarnos ninguno) y asi todos
-- vuelven a tener su unica jugada, ya sobre la version arreglada.
--
-- Los sobres ya concedidos se conservan (no se tocan los card_drops).
delete from public.hoguera_attempts;
