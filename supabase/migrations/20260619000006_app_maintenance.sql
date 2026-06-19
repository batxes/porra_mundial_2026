-- Modo mantenimiento global: el admin puede "tumbar" la web. Con `maintenance`
-- en true, todos los usuarios (menos el admin) ven una pantalla de
-- mantenimiento. Mismo patrón que ruleta_settings: tabla singleton + lectura
-- pública (vía RPC) + RPC admin para cambiarlo. Aditivo, no toca el core.

create table if not exists public.app_settings (
  id boolean primary key default true check (id),
  maintenance boolean not null default false,
  maintenance_message text,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

drop policy if exists "public app settings read" on public.app_settings;
create policy "public app settings read" on public.app_settings
  for select using (true);

grant select on public.app_settings to anon, authenticated;
revoke insert, update, delete on public.app_settings from anon, authenticated;

-- Fila singleton (id = true).
insert into public.app_settings (id, maintenance)
values (true, false)
on conflict (id) do nothing;

-- Estado del mantenimiento (público: lo lee el gate del shell para todos).
create or replace function public.maintenance_status()
returns table (maintenance boolean, maintenance_message text)
language sql
stable
security definer
set search_path = public
as $$
  select s.maintenance, s.maintenance_message
  from public.app_settings s
  where s.id = true;
$$;

-- Activar/desactivar (solo admin).
create or replace function public.admin_set_maintenance(
  p_active boolean,
  p_message text default null
)
returns table (maintenance boolean, maintenance_message text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo el admin puede cambiar el mantenimiento';
  end if;

  insert into public.app_settings (id, maintenance, maintenance_message, updated_at)
  values (
    true,
    coalesce(p_active, false),
    nullif(trim(coalesce(p_message, '')), ''),
    now()
  )
  on conflict (id) do update
    set maintenance = excluded.maintenance,
        maintenance_message = excluded.maintenance_message,
        updated_at = now();

  return query
  select s.maintenance, s.maintenance_message
  from public.app_settings s
  where s.id = true;
end;
$$;

revoke all on function public.maintenance_status() from public;
revoke all on function public.admin_set_maintenance(boolean, text) from public;
grant execute on function public.maintenance_status() to anon, authenticated;
grant execute on function public.admin_set_maintenance(boolean, text) to authenticated;
