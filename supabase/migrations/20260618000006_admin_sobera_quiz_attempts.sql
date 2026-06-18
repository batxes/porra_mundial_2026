create or replace function public.admin_sobera_quiz_attempts()
returns table (
  user_id uuid,
  display_name text,
  score integer,
  answers jsonb,
  awarded_drop_ids text[],
  completed_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede ver los intentos del quiz';
  end if;

  return query
  select
    a.user_id,
    coalesce(p.display_name, 'Usuario') as display_name,
    a.score,
    a.answers,
    a.awarded_drop_ids,
    a.completed_at
  from public.sobera_quiz_attempts a
  left join public.profiles p on p.id = a.user_id
  order by a.completed_at desc
  limit 200;
end;
$$;

revoke all on function public.admin_sobera_quiz_attempts() from public;
grant execute on function public.admin_sobera_quiz_attempts() to authenticated;
