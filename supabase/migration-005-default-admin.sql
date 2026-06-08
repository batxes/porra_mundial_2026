-- Marks admin@admin.admin as the site administrator when that Auth user exists.
-- Create the user first in Supabase Auth, then run this migration.

update public.profiles
set is_admin = true,
    updated_at = now()
where id = (
  select id
  from auth.users
  where email = 'admin@admin.admin'
  limit 1
);
