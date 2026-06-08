create or replace function public.admin_delete_user(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  target_email text;
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede borrar usuarios';
  end if;
  if auth.uid() = target_user_id then
    raise exception 'No puedes borrar tu propio usuario desde la web';
  end if;

  select email into target_email from auth.users where id = target_user_id;
  if target_email = 'admin@admin.admin' then
    raise exception 'El administrador principal no se puede borrar';
  end if;

  delete from auth.users where id = target_user_id;
end;
$$;

create or replace function public.admin_set_user_admin(target_user_id uuid, next_is_admin boolean)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  target_email text;
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede cambiar roles';
  end if;

  select email into target_email from auth.users where id = target_user_id;
  if target_email = 'admin@admin.admin' and next_is_admin = false then
    raise exception 'El administrador principal no puede perder el rol admin';
  end if;

  update public.profiles
  set is_admin = next_is_admin,
      updated_at = now()
  where id = target_user_id;
end;
$$;
