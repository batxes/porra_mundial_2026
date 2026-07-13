-- Detalle de intentos de San Fermín para administración.
-- Alias explícitos y conflicto de variables fijado para evitar referencias ambiguas.

create or replace function public.admin_sanfermin_attempts(
  p_sanfermin_id uuid default null
)
returns table (
  sanfermin_id uuid,
  sanfermin_title text,
  user_id uuid,
  display_name text,
  meters_reached integer,
  reached_goal boolean,
  awarded_drop_ids text[],
  completed_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede ver los intentos de San Fermín';
  end if;

  return query
  select
    attempt.sanfermin_id,
    event.title as sanfermin_title,
    attempt.user_id,
    coalesce(profile.display_name, 'Usuario') as display_name,
    attempt.meters_reached,
    attempt.reached_goal,
    attempt.awarded_drop_ids,
    attempt.completed_at
  from public.sanfermin_attempts as attempt
  join public.sanfermin_events as event on event.id = attempt.sanfermin_id
  left join public.profiles as profile on profile.id = attempt.user_id
  where p_sanfermin_id is null or attempt.sanfermin_id = p_sanfermin_id
  order by attempt.completed_at desc
  limit 200;
end;
$$;

revoke all on function public.admin_sanfermin_attempts(uuid) from public;
grant execute on function public.admin_sanfermin_attempts(uuid) to authenticated;
