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
