-- Updates knockout scoring to the current TRILIPORRA rules:
-- dieciseisavos 5, octavos 10, cuartos 15, semifinales 20, final 25.
-- Run this after the previous migrations if your Supabase project already exists.

create or replace function public.recalculate_scores()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.scoring_rules (code, label, points) values
    ('team_progression_hit', 'Acierto de clasificación según ronda', 0),
    ('tournament_champion_hit', 'Ganador del Mundial', 25),
    ('tournament_mvp_hit', 'MVP del Mundial', 20),
    ('tournament_top_scorer_hit', 'Máximo goleador', 20)
  on conflict (code) do update set label = excluded.label, points = excluded.points;

  perform set_config('app.recalculating_scores', 'on', true);
  delete from public.score_entries;

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
    coalesce(pl.display_name, 'Jugador') || ' · ' ||
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
    'Campeón del Mundial acertado',
    'champion'
  from public.predictions p
  join public.matches m on m.id = 'wc26-104' and m.status in ('finished', 'validated')
  where m.home_score is not null
    and m.away_score is not null
    and m.home_score <> m.away_score
    and p.selections #>> array['bracket', 'winners', '104'] =
      case when m.home_score > m.away_score then m.home_team_id else m.away_team_id end;

  update public.profiles profile
  set total_points = coalesce(totals.total_points, 0),
      updated_at = now()
  from (
    select profiles.id, coalesce(sum(score_entries.points), 0)::integer as total_points
    from public.profiles
    left join public.score_entries on score_entries.user_id = profiles.id
    group by profiles.id
  ) totals
  where totals.id = profile.id;
end;
$$;

select public.recalculate_scores();
