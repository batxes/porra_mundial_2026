-- Optional admin helpers for the Admin > Usuarios panel.
-- Passwords are never exposed. Password reset emails are handled by Supabase Auth.

create or replace function public.admin_delete_user(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede borrar usuarios';
  end if;
  if auth.uid() = target_user_id then
    raise exception 'No puedes borrar tu propio usuario desde la web';
  end if;

  delete from auth.users where id = target_user_id;
end;
$$;

create or replace function public.admin_set_user_admin(target_user_id uuid, next_is_admin boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede cambiar roles';
  end if;

  update public.profiles
  set is_admin = next_is_admin,
      updated_at = now()
  where id = target_user_id;
end;
$$;
