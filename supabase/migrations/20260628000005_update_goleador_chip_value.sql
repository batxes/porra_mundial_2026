create or replace function public.recalculate_trainer_tactic_scores()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('app.recalculating_scores', 'on', true);

  delete from public.score_entries
  where rule_code = 'trainer_tactic_hit';

  insert into public.score_entries (user_id, match_id, rule_code, points, explanation, source_ref)
  select
    p.user_id,
    mtr.match_id,
    'trainer_tactic_hit',
    tactic.points,
    t.name || ' - ' || tactic.label || ' en el partido ' || replace(mtr.match_id, 'wc26-', ''),
    'trainer-tactic-' || replace(mtr.match_id, 'wc26-', '') || '-' || mtr.team_id || '-' || mtr.tactic_id
  from public.predictions p
  join public.match_tactic_results mtr on true
  join public.matches m on m.id = mtr.match_id and m.status in ('finished', 'validated')
  join public.teams t on t.id = mtr.team_id
  cross join lateral (
    select replace(mtr.match_id, 'wc26-', '') as match_number
  ) match_key
  cross join lateral (
    select
      coalesce(
        p.selections #>> array['matchPredictions', match_key.match_number, 'trainerTeamId'],
        p.selections #>> array['matchPredictions', match_key.match_number, 'teamId'],
        p.selections #>> array['matchPredictions', match_key.match_number, 'trainerId']
      ) as team_id,
      p.selections #>> array['matchPredictions', match_key.match_number, 'tacticId'] as tactic_id
  ) pick
  cross join lateral (
    select
      case mtr.tactic_id
        when 'over-25' then 3
        when 'clean-sheet' then 2
        when 'first-goal' then 1
        when 'set-piece' then 3
        when 'red-card' then 5
        when 'penalty' then 6
      end as points,
      case mtr.tactic_id
        when 'over-25' then 'Goleador'
        when 'clean-sheet' then 'Muro'
        when 'first-goal' then 'Abrelatas'
        when 'set-piece' then 'Estratega'
        when 'red-card' then 'Carnicero'
        when 'penalty' then 'Remontada'
      end as label
  ) tactic
  where pick.team_id = mtr.team_id
    and pick.tactic_id = mtr.tactic_id
    and tactic.points is not null;

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
