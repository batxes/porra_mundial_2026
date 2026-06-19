-- Fix: "column reference \"active_ruleta_id\" is ambiguous" al activar/pausar la
-- ruleta. En admin_set_ruleta_active se referencia active_ruleta_id SIN
-- cualificar (subconsulta del coalesce y lado derecho del UPDATE), que colisiona
-- con la columna de salida active_ruleta_id del RETURNS TABLE. Recreamos con
-- `#variable_conflict use_column` (resuelve a la COLUMNA). Cuerpo idéntico a
-- 20260619000003. Misma clase que el fix del quiz (20260619000009).
create or replace function public.admin_set_ruleta_active(
  p_active boolean,
  p_ruleta_id uuid default null
)
returns table (
  active boolean,
  active_ruleta_id uuid,
  active_ruleta_title text,
  total_attempts bigint,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_ruleta_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede activar la ruleta';
  end if;

  select coalesce(
    p_ruleta_id,
    (select active_ruleta_id from public.ruleta_settings where id = true),
    (select id from public.ruletas order by created_at asc limit 1)
  )
  into v_ruleta_id;

  if coalesce(p_active, false) and v_ruleta_id is null then
    raise exception 'No hay ruleta para activar';
  end if;

  update public.ruleta_settings
  set
    active = coalesce(p_active, false),
    active_ruleta_id = coalesce(v_ruleta_id, active_ruleta_id),
    updated_by = v_uid,
    updated_at = now()
  where id = true;

  return query
  select * from public.admin_ruleta_status();
end;
$$;

revoke all on function public.admin_set_ruleta_active(boolean, uuid) from public;
grant execute on function public.admin_set_ruleta_active(boolean, uuid) to authenticated;
