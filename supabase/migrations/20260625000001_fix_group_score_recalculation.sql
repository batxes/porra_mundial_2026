create or replace function public.recalculate_scores()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('app.recalculating_scores', 'on', true);
  delete from public.score_entries where true;

  insert into public.score_entries (user_id, match_id, rule_code, points, explanation, source_ref)
  select
    p.user_id,
    m.id,
    'match_outcome_hit',
    1,
    'Eleccion acertada partido ' || replace(m.id, 'wc26-', ''),
    'match-outcome-' || replace(m.id, 'wc26-', '')
  from public.predictions p
  join public.matches m on m.status in ('finished', 'validated')
  cross join lateral (
    select
      p.selections #>> array['matchPredictions', replace(m.id, 'wc26-', ''), 'homeScore'] as home_score_text,
      p.selections #>> array['matchPredictions', replace(m.id, 'wc26-', ''), 'awayScore'] as away_score_text
  ) forecast_raw
  cross join lateral (
    select
      case when forecast_raw.home_score_text ~ '^[0-9]+$' then forecast_raw.home_score_text::integer end as home_score,
      case when forecast_raw.away_score_text ~ '^[0-9]+$' then forecast_raw.away_score_text::integer end as away_score
  ) forecast
  where m.home_score is not null
    and m.away_score is not null
    and forecast.home_score is not null
    and forecast.away_score is not null
    and (
      case
        when forecast.home_score > forecast.away_score then 'home'
        when forecast.away_score > forecast.home_score then 'away'
        else 'draw'
      end
    ) = (
      case
        when m.home_score > m.away_score then 'home'
        when m.away_score > m.home_score then 'away'
        else 'draw'
      end
    );

  insert into public.score_entries (user_id, match_id, rule_code, points, explanation, source_ref)
  select
    p.user_id,
    m.id,
    'match_exact_score',
    coalesce(m.home_score, 0) + coalesce(m.away_score, 0),
    'Marcador exacto partido ' || replace(m.id, 'wc26-', '') || ': ' || m.home_score || '-' || m.away_score,
    'match-' || replace(m.id, 'wc26-', '')
  from public.predictions p
  join public.matches m on m.status in ('finished', 'validated')
  where m.home_score is not null
    and m.away_score is not null
    and p.selections #>> array['matchPredictions', replace(m.id, 'wc26-', ''), 'homeScore'] = m.home_score::text
    and p.selections #>> array['matchPredictions', replace(m.id, 'wc26-', ''), 'awayScore'] = m.away_score::text;

  insert into public.score_entries (user_id, match_id, rule_code, points, explanation, source_ref)
  select
    p.user_id,
    e.match_id,
    case e.event_type
      when 'goal' then 'player_goal'
      when 'penalty_goal' then 'player_penalty_goal'
      when 'mvp' then 'player_match_mvp'
      when 'penalty_save' then 'player_penalty_save'
      when 'penalty_miss' then 'player_penalty_miss'
      when 'red_card' then 'player_red_card'
    end,
    case e.event_type
      when 'goal' then
        case pl.position
          when 'DEL' then 2
          when 'MED' then 6
          when 'DEF' then 11
          when 'POR' then 35
          else 2
        end
      when 'penalty_goal' then 1
      when 'mvp' then 3
      when 'penalty_save' then 2
      when 'penalty_miss' then -1
      when 'red_card' then -2
    end,
    coalesce(pl.display_name, 'Jugador') || ' - ' ||
      case e.event_type
        when 'goal' then 'Gol de tu once'
        when 'penalty_goal' then 'Penalti marcado'
        when 'mvp' then 'MVP del partido'
        when 'penalty_save' then 'Penalti parado'
        when 'penalty_miss' then 'Penalti fallado'
        when 'red_card' then 'Tarjeta roja'
      end || ' en partido ' || replace(e.match_id, 'wc26-', ''),
    e.id::text
  from public.predictions p
  join lateral jsonb_array_elements_text(coalesce(p.selections -> 'xi', '[]'::jsonb)) as xi(player_id) on true
  join public.match_events e on e.player_id = xi.player_id
  join public.matches m on m.id = e.match_id and m.status in ('finished', 'validated')
  left join public.players pl on pl.id = e.player_id
  where e.event_type in ('goal', 'penalty_goal', 'mvp', 'penalty_save', 'penalty_miss', 'red_card');

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
  where replace(m.id, 'wc26-', '')::integer >= 73
    and m.stage in ('Dieciseisavos', 'Octavos', 'Cuartos', 'Semifinales', 'Final')
    and m.home_score is not null
    and m.away_score is not null
    and m.home_score <> m.away_score
    and p.selections #>> array['bracket', 'winners', replace(m.id, 'wc26-', '')] =
      case when m.home_score > m.away_score then m.home_team_id else m.away_team_id end;

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
  where m.home_score is not null
    and m.away_score is not null
    and m.home_score <> m.away_score
    and coalesce(
      p.selections #>> array['extras', 'worldChampion'],
      p.selections #>> array['bracket', 'winners', '104']
    ) = case when m.home_score > m.away_score then m.home_team_id else m.away_team_id end;

  with group_matches as (
    select
      m.id,
      coalesce(m.group_code, home_team.group_code) as group_code,
      m.home_team_id,
      m.away_team_id,
      m.home_score,
      m.away_score,
      m.status
    from public.matches m
    join public.teams home_team on home_team.id = m.home_team_id
    join public.teams away_team on away_team.id = m.away_team_id
    where m.stage = 'Grupos'
      and home_team.group_code is not null
      and home_team.group_code = away_team.group_code
  ),
  group_completion as (
    select
      group_code,
      count(*) as expected_matches,
      count(*) filter (
        where status in ('finished', 'validated')
          and home_score is not null
          and away_score is not null
      ) as completed_matches
    from group_matches
    group by group_code
  ),
  all_groups_complete as (
    select
      count(*) = 12
        and bool_and(expected_matches = 6 and completed_matches = expected_matches) as complete
    from group_completion
  ),
  completed_group_matches as (
    select *
    from group_matches
    where status in ('finished', 'validated')
      and home_score is not null
      and away_score is not null
  ),
  match_points as (
    select
      group_code,
      home_team_id as team_id,
      case when home_score > away_score then 3 when home_score = away_score then 1 else 0 end as pts,
      home_score as gf,
      away_score as ga
    from completed_group_matches
    union all
    select
      group_code,
      away_team_id as team_id,
      case when away_score > home_score then 3 when home_score = away_score then 1 else 0 end as pts,
      away_score as gf,
      home_score as ga
    from completed_group_matches
  ),
  team_standings as (
    select
      t.group_code,
      t.id as team_id,
      t.name as team_name,
      coalesce(sum(mp.pts), 0)::integer as pts,
      coalesce(sum(mp.gf), 0)::integer as gf,
      coalesce(sum(mp.ga), 0)::integer as ga
    from public.teams t
    left join match_points mp on mp.team_id = t.id and mp.group_code = t.group_code
    where t.group_code is not null
    group by t.group_code, t.id, t.name
  ),
  ranked_standings as (
    select
      ts.group_code,
      ts.team_id,
      ts.team_name,
      ts.pts,
      ts.gf,
      ts.ga,
      ts.gf - ts.ga as gd,
      row_number() over (
        partition by ts.group_code
        order by ts.pts desc, ts.gf - ts.ga desc, ts.gf desc, ts.team_name asc
      ) as actual_position
    from team_standings ts
    join group_completion gc on gc.group_code = ts.group_code
    cross join all_groups_complete agc
    where gc.expected_matches = 6
      and gc.completed_matches = gc.expected_matches
      and agc.complete
  ),
  best_thirds as (
    select rs.team_id
    from ranked_standings rs
    cross join all_groups_complete agc
    where agc.complete
      and rs.actual_position = 3
    order by rs.pts desc, rs.gd desc, rs.gf desc, rs.team_name asc
    limit 8
  ),
  predicted_group_positions as (
    select
      p.user_id,
      group_entry.group_code,
      team_entry.team_id,
      team_entry.predicted_position_text::integer as predicted_position
    from public.predictions p
    join lateral jsonb_each(coalesce(p.selections -> 'groups', '{}'::jsonb)) as group_entry(group_code, positions) on true
    join lateral jsonb_each_text(group_entry.positions) as team_entry(team_id, predicted_position_text) on true
    where team_entry.predicted_position_text ~ '^[0-9]+$'
  ),
  selected_third_groups as (
    select distinct
      p.user_id,
      third_group.group_code
    from public.predictions p
    join lateral jsonb_array_elements_text(coalesce(p.selections #> '{bracket,thirdQualifiers}', '[]'::jsonb)) as third_group(group_code) on true
  ),
  group_score_rows as (
    select
      pg.user_id,
      null::text as match_id,
      'group_qualification_hit'::text as rule_code,
      2 as points,
      rs.team_name || ' clasificado desde el grupo ' || rs.group_code as explanation,
      'group-qualified-' || rs.group_code || '-' || rs.team_id as source_ref
    from ranked_standings rs
    join predicted_group_positions pg
      on pg.group_code = rs.group_code
      and pg.team_id = rs.team_id
    where rs.actual_position <= 2
      and pg.predicted_position in (1, 2)

    union all

    select
      pg.user_id,
      null::text as match_id,
      'group_position_hit'::text as rule_code,
      3 as points,
      rs.team_name || ' ' || rs.actual_position || 'o en el grupo ' || rs.group_code as explanation,
      'group-position-' || rs.group_code || '-' || rs.team_id as source_ref
    from ranked_standings rs
    join predicted_group_positions pg
      on pg.group_code = rs.group_code
      and pg.team_id = rs.team_id
    where rs.actual_position <= 2
      and pg.predicted_position = rs.actual_position

    union all

    select
      pg.user_id,
      null::text as match_id,
      'group_third_qualification_hit'::text as rule_code,
      1 as points,
      rs.team_name || ' tercer clasificado desde el grupo ' || rs.group_code as explanation,
      'group-third-qualified-' || rs.group_code || '-' || rs.team_id as source_ref
    from ranked_standings rs
    join best_thirds bt on bt.team_id = rs.team_id
    join predicted_group_positions pg
      on pg.group_code = rs.group_code
      and pg.team_id = rs.team_id
    join selected_third_groups stg
      on stg.user_id = pg.user_id
      and stg.group_code = rs.group_code
    where rs.actual_position = 3
      and pg.predicted_position = 3
  )
  insert into public.score_entries (user_id, match_id, rule_code, points, explanation, source_ref)
  select user_id, match_id, rule_code, points, explanation, source_ref
  from group_score_rows;

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

select public.recalculate_scores();
