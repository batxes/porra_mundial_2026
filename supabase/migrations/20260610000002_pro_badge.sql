alter table public.profiles
  add column if not exists is_pro boolean not null default false;

create or replace function public.prevent_profile_score_or_admin_self_update()
returns trigger
language plpgsql
as $$
begin
  if current_setting('app.recalculating_scores', true) = 'on' then
    return new;
  end if;
  if not public.is_admin() then
    new.total_points := old.total_points;
    new.is_admin := old.is_admin;
    new.is_pro := old.is_pro;
  end if;
  return new;
end;
$$;

create or replace function public.admin_set_user_pro(target_user_id uuid, next_is_pro boolean)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede gestionar el badge PRO';
  end if;

  update public.profiles
  set is_pro = next_is_pro,
      updated_at = now()
  where id = target_user_id;
end;
$$;
