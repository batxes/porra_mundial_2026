-- Retira la puntuacion por "cuadro" (acertar quien pasa de ronda).
--
-- El chip de cuadro (rule_code 'team_progression_hit', 5/10/15/20/25 puntos por
-- acertar el ganador de cada eliminatoria via bracket.winners[nº partido]) deja
-- de otorgarse. Se conserva el bonus de Campeon del Mundial
-- ('tournament_champion_hit'), que es una apuesta aparte (categoria "Tus
-- elecciones"), no parte del cuadro.
--
-- Nota de diseno: recalculate_scores_base() todavia puede insertar
-- 'team_progression_hit'. No pasa nada: esta funcion corre la ULTIMA dentro de
-- recalculate_scores() y borra todas esas entradas sin reinsertarlas, de modo
-- que ningun total acaba incluyendo puntos de cuadro. Todos los triggers
-- (matches/match_events/predictions) usan la pipeline completa.

create or replace function public.recalculate_playoff_progression_scores()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- El cuadro ya no puntua: eliminamos cualquier entrada previa, tanto la de
  -- progresion (retirada) como la de campeon (la recalculamos abajo).
  delete from public.score_entries
  where rule_code in ('team_progression_hit', 'tournament_champion_hit');

  -- Bonus de Campeon del Mundial (se mantiene). Resuelve el ganador del 104
  -- contemplando tanda de penaltis (shootout).
  insert into public.score_entries (user_id, match_id, rule_code, points, explanation, source_ref)
  select
    p.user_id,
    m.id,
    'tournament_champion_hit',
    25,
    'Campeon del Mundial acertado',
    'champion'
  from public.predictions p
  join public.matches m on m.id = 'wc26-104' and m.status in ('finished', 'validated')
  left join lateral (
    select
      count(*) filter (where e.team_id = m.home_team_id) as home_penalties,
      count(*) filter (where e.team_id = m.away_team_id) as away_penalties
    from public.match_events e
    where e.match_id = m.id
      and e.event_type = 'penalty_goal'
      and e.details ->> 'phase' = 'shootout'
  ) shootout on true
  cross join lateral (
    select
      case
        when m.home_score > m.away_score then m.home_team_id
        when m.away_score > m.home_score then m.away_team_id
        when m.home_score = m.away_score
          and coalesce(shootout.home_penalties, 0) > coalesce(shootout.away_penalties, 0)
          then m.home_team_id
        when m.home_score = m.away_score
          and coalesce(shootout.away_penalties, 0) > coalesce(shootout.home_penalties, 0)
          then m.away_team_id
      end as winner_team_id
  ) resolved
  where m.home_score is not null
    and m.away_score is not null
    and resolved.winner_team_id is not null
    and coalesce(
      nullif(p.selections #>> array['extras', 'worldChampion'], ''),
      nullif(p.selections #>> array['bracket', 'winners', '104'], '')
    ) = resolved.winner_team_id;

  update public.profiles profile
  set total_points = coalesce(totals.total_points, 0),
      updated_at = now()
  from (
    select profiles.id, coalesce(sum(score_entries.points), 0)::integer as total_points
    from public.profiles
    left join public.score_entries on score_entries.user_id = profiles.id
    group by profiles.id
  ) totals
  where profile.id = totals.id;
end;
$$;

-- Recalculo completo: limpia los team_progression_hit ya persistidos y
-- actualiza los total_points de todos los perfiles.
select public.recalculate_scores();
