create or replace function public.recalculate_group_scores()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('app.recalculating_scores', 'on', true);

  delete from public.score_entries
  where rule_code in (
    'group_qualification_hit',
    'group_third_qualification_hit',
    'group_position_hit'
  );

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
      and pg.predicted_position <> rs.actual_position

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

do $$
begin
  if to_regprocedure('public.recalculate_scores_base()') is null
    and to_regprocedure('public.recalculate_scores()') is not null then
    alter function public.recalculate_scores() rename to recalculate_scores_base;
  end if;
end $$;

create or replace function public.recalculate_scores()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recalculate_scores_base();
  perform public.recalculate_group_scores();
  perform public.recalculate_trainer_tactic_scores();
end;
$$;

select public.recalculate_scores();
