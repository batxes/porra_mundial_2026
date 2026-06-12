-- Edicion tardia: el admin puede habilitar a un usuario concreto para crear o
-- editar su porra despues del cierre (p. ej. alguien que no llego a tiempo).
-- Los pronosticos de partidos ya empezados siguen congelados por kickoff,
-- asi que el usuario habilitado no puede pronosticar partidos jugados.

alter table public.profiles
  add column if not exists late_edit boolean not null default false;

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
    new.is_wolf := old.is_wolf;
    new.is_hidden := old.is_hidden;
    new.late_edit := old.late_edit;
  end if;
  return new;
end;
$$;

create or replace function public.admin_set_user_late_edit(target_user_id uuid, next_late_edit boolean)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede habilitar la edicion tardia';
  end if;

  update public.profiles
  set late_edit = next_late_edit,
      updated_at = now()
  where id = target_user_id;
end;
$$;

revoke all on function public.admin_set_user_late_edit(uuid, boolean) from public;
grant execute on function public.admin_set_user_late_edit(uuid, boolean) to authenticated;

-- Misma funcion que en 20260610000000_server_side_prediction_lock.sql, con un
-- cambio: si profiles.late_edit esta activo para el usuario, el cierre general
-- (predictions_lock_at) no aplica ni para crear ni para las secciones. La
-- congelacion por partido (match_kickoffs) se mantiene siempre.
create or replace function public.save_prediction(
  p_selections jsonb,
  p_completion integer,
  p_is_definitive boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_tournament_id uuid;
  v_lock_at timestamptz;
  v_late_edit boolean := false;
  v_exists boolean;
  v_old_selections jsonb;
  v_old_definitive boolean;
  v_merged jsonb;
  v_old_mp jsonb;
  v_new_mp jsonb;
  v_section text;
  v_key text;
  v_kick timestamptz;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  select id, predictions_lock_at into v_tournament_id, v_lock_at
  from public.tournaments where slug = 'world-cup-2026';
  if v_tournament_id is null then
    raise exception 'Torneo no encontrado';
  end if;

  select coalesce(late_edit, false) into v_late_edit
  from public.profiles where id = v_uid;

  select selections, is_definitive into v_old_selections, v_old_definitive
  from public.predictions where user_id = v_uid;
  v_exists := found;

  if coalesce(v_old_definitive, false) then
    raise exception 'La porra definitiva ya no admite cambios';
  end if;

  if not v_exists and now() >= v_lock_at and not v_late_edit then
    raise exception 'El plazo para crear la porra ya se ha cerrado';
  end if;

  v_old_selections := coalesce(v_old_selections, '{}'::jsonb);
  v_merged := coalesce(p_selections, '{}'::jsonb);

  if now() >= v_lock_at and not v_late_edit then
    foreach v_section in array array['groups', 'bracket', 'extras', 'xi', 'xiFormation'] loop
      if v_old_selections ? v_section then
        v_merged := jsonb_set(v_merged, array[v_section], v_old_selections -> v_section, true);
      else
        v_merged := v_merged - v_section;
      end if;
    end loop;
  end if;

  v_old_mp := coalesce(v_old_selections -> 'matchPredictions', '{}'::jsonb);
  v_new_mp := coalesce(v_merged -> 'matchPredictions', '{}'::jsonb);
  for v_key in
    select keys.k from (
      select jsonb_object_keys(v_new_mp) as k
      union
      select jsonb_object_keys(v_old_mp) as k
    ) keys
  loop
    if v_key ~ '^[0-9]+$' then
      select kickoff into v_kick from public.match_kickoffs where number = v_key::integer;
      if v_kick is not null and now() >= v_kick then
        if v_old_mp ? v_key then
          v_new_mp := jsonb_set(v_new_mp, array[v_key], v_old_mp -> v_key, true);
        else
          v_new_mp := v_new_mp - v_key;
        end if;
      end if;
    end if;
  end loop;
  v_merged := jsonb_set(v_merged, array['matchPredictions'], v_new_mp, true);

  insert into public.predictions (user_id, tournament_id, selections, completion_percent, is_definitive, updated_at)
  values (
    v_uid,
    v_tournament_id,
    v_merged,
    greatest(0, least(100, coalesce(p_completion, 0))),
    coalesce(p_is_definitive, false),
    now()
  )
  on conflict (user_id) do update set
    selections = excluded.selections,
    completion_percent = excluded.completion_percent,
    is_definitive = excluded.is_definitive,
    updated_at = excluded.updated_at;
end;
$$;
