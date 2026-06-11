create or replace function public.admin_list_user_emails()
returns table (user_id uuid, email text)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede ver los emails';
  end if;

  return query select u.id, u.email::text from auth.users u;
end;
$$;

revoke all on function public.admin_list_user_emails() from public;
grant execute on function public.admin_list_user_emails() to authenticated;
