-- Reinicio PUNTUAL de la hoguera.
--
-- El bug del cliente (el bucle se reiniciaba al refrescar el gate su config por
-- polling/focus) afecto sobre todo a la cuenta de prueba. Borramos SOLO el
-- intento de hodeiarregi@togga.net para poder re-testear la version arreglada.
--
-- NO se tocan los intentos de los demas jugadores (p.ej. los reales que ya
-- jugaron) ni los sobres concedidos.
delete from public.hoguera_attempts
where user_id in (
  select id from auth.users where lower(email) = lower('hodeiarregi@togga.net')
);
