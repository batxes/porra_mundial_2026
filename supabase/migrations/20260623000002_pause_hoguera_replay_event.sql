-- Deja el segundo evento de hoguera preparado, pero sin activarlo.
-- La activacion debe hacerse manualmente desde el panel admin.

insert into public.hoguera_settings (id, active, active_hoguera_id, updated_at)
values (true, false, '00000000-0000-0000-0000-0000000000a4'::uuid, now())
on conflict (id) do update
set
  active = false,
  active_hoguera_id = excluded.active_hoguera_id,
  updated_at = now();
