-- Alinea Rasca con el contrato de los otros minijuegos publicados:
-- activacion idempotente desde admin, referencias PL/pgSQL sin ambiguedad
-- y permisos explicitos para la RPC moderna que usa el modal.

create or replace function public.admin_set_scratch_cards_active(
  p_active boolean,
  p_scratch_card_id uuid default null
)
returns table (
  active boolean,
  active_scratch_card_id uuid,
  active_scratch_card_title text,
  card_count integer,
  win_chance numeric,
  total_attempts bigint,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_scratch_card_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede activar Rasca';
  end if;

  select coalesce(
    p_scratch_card_id,
    (
      select scs.active_scratch_card_id
      from public.scratch_card_settings as scs
      where scs.id = true
    ),
    (
      select sc.id
      from public.scratch_cards as sc
      order by sc.created_at asc
      limit 1
    )
  )
  into v_scratch_card_id;

  if coalesce(p_active, false) and v_scratch_card_id is null then
    raise exception 'No hay juego de Rasca para activar';
  end if;

  if v_scratch_card_id is not null and not exists (
    select 1
    from public.scratch_cards as sc
    where sc.id = v_scratch_card_id
  ) then
    raise exception 'Juego de Rasca no encontrado';
  end if;

  update public.scratch_card_settings
  set
    active = coalesce(p_active, false),
    active_scratch_card_id = coalesce(
      v_scratch_card_id,
      scratch_card_settings.active_scratch_card_id
    ),
    updated_by = v_uid,
    updated_at = now()
  where scratch_card_settings.id = true;

  return query
  select
    status_row.active,
    status_row.active_scratch_card_id,
    status_row.active_scratch_card_title,
    status_row.card_count,
    status_row.win_chance,
    status_row.total_attempts,
    status_row.updated_at
  from public.admin_scratch_cards_status() as status_row;
end;
$$;

create or replace function public.complete_scratch_cards(
  p_cards jsonb default '[]'::jsonb
)
returns table (
  scratch_card_id uuid,
  wins integer,
  packs_awarded integer,
  awarded_drop_ids text[]
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_scratch_card_id uuid;
begin
  select scratch_card_settings.active_scratch_card_id
  into v_scratch_card_id
  from public.scratch_card_settings
  where scratch_card_settings.id = true;

  return query
  select
    completed.scratch_card_id,
    completed.wins,
    completed.packs_awarded,
    completed.awarded_drop_ids
  from public.complete_scratch_cards(v_scratch_card_id, p_cards) as completed;
end;
$$;

revoke all on function public.admin_set_scratch_cards_active(boolean, uuid) from public;
revoke all on function public.complete_scratch_cards(uuid, jsonb) from public;
revoke all on function public.complete_scratch_cards(jsonb) from public;

grant execute on function public.admin_set_scratch_cards_active(boolean, uuid) to authenticated;
grant execute on function public.complete_scratch_cards(uuid, jsonb) to authenticated;
grant execute on function public.complete_scratch_cards(jsonb) to authenticated;
