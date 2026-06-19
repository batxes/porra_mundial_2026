-- Fix: "column reference \"active_quiz_id\" is ambiguous" al activar/pausar el
-- quiz. En admin_set_sobera_quiz_active la subconsulta
-- `(select active_quiz_id from public.sobera_quiz_settings ...)` usa
-- active_quiz_id SIN cualificar, que colisiona con la columna de salida
-- active_quiz_id del RETURNS TABLE (en plpgsql las columnas OUT son variables en
-- scope). Recreamos la función con `#variable_conflict use_column` para que esos
-- nombres se resuelvan a la COLUMNA. Solo añade esa directiva; el cuerpo es
-- idéntico a 20260618000008.
create or replace function public.admin_set_sobera_quiz_active(
  p_active boolean,
  p_quiz_id uuid default null
)
returns table (
  active boolean,
  active_quiz_id uuid,
  active_quiz_title text,
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
  v_quiz_id uuid;
  v_current_active_quiz_id uuid;
  v_current_active_title text;
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede activar el quiz';
  end if;

  select coalesce(
    p_quiz_id,
    (select active_quiz_id from public.sobera_quiz_settings where id = true),
    (select id from public.sobera_quizzes order by created_at desc limit 1)
  )
  into v_quiz_id;

  if coalesce(p_active, false) and v_quiz_id is null then
    raise exception 'No hay quiz para activar';
  end if;

  if v_quiz_id is not null and not exists (
    select 1 from public.sobera_quizzes q where q.id = v_quiz_id
  ) then
    raise exception 'Quiz no encontrado';
  end if;

  if coalesce(p_active, false) then
    select s.active_quiz_id, q.title
    into v_current_active_quiz_id, v_current_active_title
    from public.sobera_quiz_settings s
    left join public.sobera_quizzes q on q.id = s.active_quiz_id
    where s.id = true
      and s.active is true
      and s.active_quiz_id is not null;

    if v_current_active_quiz_id is not null
      and v_current_active_quiz_id <> v_quiz_id then
      raise exception 'Ya hay una ronda activa (%). Pausala antes de activar otra',
        coalesce(v_current_active_title, 'otra ronda');
    end if;
  end if;

  update public.sobera_quiz_settings
  set
    active = coalesce(p_active, false),
    active_quiz_id = coalesce(v_quiz_id, sobera_quiz_settings.active_quiz_id),
    updated_by = v_uid,
    updated_at = now()
  where id = true;

  return query
  select *
  from public.admin_sobera_quiz_status();
end;
$$;

revoke all on function public.admin_set_sobera_quiz_active(boolean, uuid) from public;
grant execute on function public.admin_set_sobera_quiz_active(boolean, uuid) to authenticated;
