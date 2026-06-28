create or replace function public.recalculate_playoff_progression_scores()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.score_entries
  where rule_code in ('team_progression_hit', 'tournament_champion_hit');

  insert into public.score_entries (user_id, match_id, rule_code, points, explanation, source_ref)
  select
    p.user_id,
    m.id,
    'team_progression_hit',
    case m.stage
      when 'Dieciseisavos' then 5
      when 'Octavos' then 10
      when 'Cuartos' then 15
      when 'Semifinales' then 20
      when 'Final' then 25
      else 0
    end,
    'Ganador acertado partido ' || replace(m.id, 'wc26-', ''),
    'winner-' || replace(m.id, 'wc26-', '')
  from public.predictions p
  join public.matches m on m.status in ('finished', 'validated')
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
  where replace(m.id, 'wc26-', '')::integer >= 73
    and m.stage in ('Dieciseisavos', 'Octavos', 'Cuartos', 'Semifinales', 'Final')
    and m.home_score is not null
    and m.away_score is not null
    and resolved.winner_team_id is not null
    and p.selections #>> array['bracket', 'winners', replace(m.id, 'wc26-', '')] =
      resolved.winner_team_id;

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

create or replace function public.recalculate_scores()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('app.recalculating_scores', 'on', true);
  perform public.recalculate_scores_base();

  if to_regprocedure('public.recalculate_group_scores()') is not null then
    perform public.recalculate_group_scores();
  end if;

  if to_regprocedure('public.recalculate_trainer_tactic_scores()') is not null then
    perform public.recalculate_trainer_tactic_scores();
  end if;

  perform public.recalculate_playoff_progression_scores();
end;
$$;

select public.recalculate_scores();
