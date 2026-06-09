-- LOCAL DEVELOPMENT ONLY.
-- This file runs on `supabase db reset` (local) but NEVER on `supabase db push`,
-- so it is safe to seed a known-password admin here: it cannot reach production.
-- In production, register admin@admin.admin through the app, then flip is_admin
-- manually (see README, "First admin in production").

set search_path = public, extensions, auth;

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_sso_user,
  is_anonymous,
  confirmation_token,
  recovery_token,
  email_change,
  email_change_token_new,
  email_change_token_current,
  phone_change,
  phone_change_token,
  reauthentication_token
)
values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-0000000000ad',
  'authenticated',
  'authenticated',
  'admin@admin.admin',
  crypt('admin1234', gen_salt('bf')),
  now(),
  now(),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"display_name":"admin"}',
  false,
  false,
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  ''
)
on conflict (id) do nothing;

insert into auth.identities (
  provider_id,
  user_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
)
values (
  '00000000-0000-0000-0000-0000000000ad',
  '00000000-0000-0000-0000-0000000000ad',
  '{"sub":"00000000-0000-0000-0000-0000000000ad","email":"admin@admin.admin"}',
  'email',
  now(),
  now(),
  now()
)
on conflict do nothing;

update public.profiles
set is_admin = true
where id = '00000000-0000-0000-0000-0000000000ad';
