-- Marks admin@admin.admin as the site administrator when that Auth user exists.
-- Create the user first in Supabase Auth, then run this migration.
-- The app.recalculating_scores setting bypasses the profile trigger that prevents
-- non-admin browser sessions from changing is_admin.

begin;

set local app.recalculating_scores = 'on';

update public.profiles
set is_admin = true,
    display_name = 'admin',
    updated_at = now()
where id = (
  select id
  from auth.users
  where lower(email) = 'admin@admin.admin'
  limit 1
);

commit;
