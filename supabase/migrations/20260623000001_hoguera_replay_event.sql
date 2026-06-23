-- Segundo evento de Salta la hoguera.
-- El primer despliegue se probo en produccion antes del fix de reinicio; usamos
-- un nuevo id para que los intentos anteriores no bloqueen la partida corregida.

insert into public.hogueras (
  id,
  title,
  goal_meters,
  flame_every_meters,
  rewards
)
values (
  '00000000-0000-0000-0000-0000000000a4'::uuid,
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
on conflict (id) do update
set
  title = excluded.title,
  goal_meters = excluded.goal_meters,
  flame_every_meters = excluded.flame_every_meters,
  rewards = excluded.rewards,
  updated_at = now();

insert into public.hoguera_settings (id, active, active_hoguera_id, updated_at)
values (true, false, '00000000-0000-0000-0000-0000000000a4'::uuid, now())
on conflict (id) do update
set
  active = false,
  active_hoguera_id = excluded.active_hoguera_id,
  updated_at = now();
