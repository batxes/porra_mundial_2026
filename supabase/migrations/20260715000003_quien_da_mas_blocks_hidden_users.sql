-- Quién da más también respeta las cuentas ocultas desde Admin. Las cuentas
-- sin acceso no reciben el banco de duelos y un trigger cierra cualquier
-- intento de insertar una partida mediante una llamada directa al RPC.

create or replace function public.quien_da_mas_attempt_requires_eligible_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.profiles as profile
    where profile.id = new.user_id
      and profile.total_points > 0
      and not coalesce(profile.is_hidden, false)
  ) then
    raise exception 'Necesitas tener al menos 1 punto y estar activo en la clasificación para jugar';
  end if;
  return new;
end;
$$;

drop trigger if exists quien_da_mas_attempt_requires_eligible_profile on public.quien_da_mas_attempts;
create trigger quien_da_mas_attempt_requires_eligible_profile
before insert on public.quien_da_mas_attempts
for each row execute function public.quien_da_mas_attempt_requires_eligible_profile();

create or replace function public.quien_da_mas_status()
returns table (
  active boolean, completed boolean, game_id uuid, title text, duel_time_ms integer,
  duels jsonb, rewards jsonb, score integer, awarded_drop_ids text[], completed_at timestamptz
) language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare v_uid uuid := auth.uid();
begin
  return query
  select
    settings.active
      and coalesce(profile.total_points, 0) > 0
      and not coalesce(profile.is_hidden, false),
    attempt.user_id is not null,
    game.id,
    game.title,
    game.duel_time_ms,
    case when coalesce(profile.total_points, 0) > 0 and not coalesce(profile.is_hidden, false)
      then game.duels else '[]'::jsonb end,
    case when coalesce(profile.total_points, 0) > 0 and not coalesce(profile.is_hidden, false)
      then public.quien_da_mas_public_rewards(game.rewards) else '[]'::jsonb end,
    attempt.score,
    coalesce(attempt.awarded_drop_ids, '{}'::text[]),
    attempt.completed_at
  from public.quien_da_mas_settings as settings
  join public.quien_da_mas_games as game on game.id = settings.active_game_id
  left join public.profiles as profile on profile.id = v_uid
  left join public.quien_da_mas_attempts as attempt
    on attempt.game_id = game.id and attempt.user_id = v_uid
  where settings.id = true;
end;
$$;

revoke all on function public.quien_da_mas_attempt_requires_eligible_profile() from public;
revoke all on function public.quien_da_mas_status() from public;
grant execute on function public.quien_da_mas_status() to authenticated;
