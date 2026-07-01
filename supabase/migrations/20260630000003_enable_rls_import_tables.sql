-- Fix del advisor de Supabase "rls_disabled_in_public".
--
-- Las tablas de importacion data_import_runs y match_source_versions se quedaron
-- SIN row level security en el esquema inicial (20260608000000_initial_schema.sql),
-- mientras que el resto de tablas publicas si lo tienen. Resultado: el rol `anon`
-- (la clave publica que viaja en el frontend) tenia SELECT/INSERT/UPDATE/DELETE
-- libre sobre ellas.
--
-- Son metadata del importador, escritas server-side (service_role / migraciones,
-- que SE SALTAN RLS) y no las consulta ningun codigo cliente. Por tanto activar
-- RLS sin politicas deja a anon/authenticated sin acceso y no rompe el importador.
-- Mismo patron que public.match_lock_teams (RLS on, 0 politicas).

alter table public.data_import_runs      enable row level security;
alter table public.match_source_versions enable row level security;

-- Defensa en profundidad: retirar los privilegios de los roles publicos del API.
-- (Con RLS activado y sin politicas ya no se accede a ninguna fila; esto es el
-- segundo cerrojo por si en el futuro se anadiera alguna politica permisiva.)
revoke all on public.data_import_runs      from anon, authenticated;
revoke all on public.match_source_versions from anon, authenticated;
