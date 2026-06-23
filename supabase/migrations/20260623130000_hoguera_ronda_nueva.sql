-- Nueva ronda de la hoguera desde cero.
--
-- La ronda anterior quedo con intentos bugeados (el bucle del cliente se
-- reiniciaba al refrescar el gate su config por polling/focus) y la limpieza
-- por SQL manual no se pudo aplicar (sin acceso a la consola). Como una
-- migracion NUEVA siempre se ejecuta en el deploy (a diferencia de re-editar
-- una ya aplicada), aqui:
--   1) creamos una hoguera nueva (id nuevo),
--   2) la dejamos como hoguera activa pero PAUSADA (active = false),
--   3) vaciamos TODOS los intentos viejos (stats limpias).
-- Asi todos vuelven a tener su unica jugada, ya sobre la version arreglada.
-- Activar desde Admin -> Hoguera cuando toque. Los sobres ya concedidos se
-- conservan (no se tocan los card_drops).

insert into public.hogueras (id, title, goal_meters, flame_every_meters, rewards)
values (
  '00000000-0000-0000-0000-0000000000a5'::uuid,
  'SALTA LA HOGUERA',
  100,
  5,
  '[
    { "meters": 25,  "pool": "defensas" },
    { "meters": 50,  "pool": "medios" },
    { "meters": 75,  "pool": "premier" },
    { "meters": 100, "pool": "sub21" }
  ]'::jsonb
)
on conflict (id) do nothing;

update public.hoguera_settings
set active_hoguera_id = '00000000-0000-0000-0000-0000000000a5'::uuid,
    active = false,
    updated_at = now()
where id = true;

delete from public.hoguera_attempts;
