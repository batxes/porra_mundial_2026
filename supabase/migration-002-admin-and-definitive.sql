-- Run this file if schema.sql was already applied before the admin panel was added.
alter table public.profiles add column if not exists is_admin boolean not null default false;
alter table public.predictions add column if not exists is_definitive boolean not null default false;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.prevent_definitive_prediction_changes()
returns trigger
language plpgsql
as $$
begin
  if old.is_definitive then
    raise exception 'La porra definitiva ya no admite cambios';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_definitive_prediction_changes on public.predictions;
create trigger prevent_definitive_prediction_changes
  before update on public.predictions
  for each row execute procedure public.prevent_definitive_prediction_changes();

create policy "admin match insert" on public.matches for insert with check (public.is_admin());
create policy "admin match update" on public.matches for update using (public.is_admin()) with check (public.is_admin());
create policy "admin event insert" on public.match_events for insert with check (public.is_admin());
create policy "admin event update" on public.match_events for update using (public.is_admin()) with check (public.is_admin());

-- Replace the email and execute once after registering your own account.
-- update public.profiles set is_admin = true where id = (select id from auth.users where email = 'tu@email.com');
