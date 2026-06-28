create table if not exists public.match_tactic_results (
  match_id text not null references public.matches(id) on delete cascade,
  team_id text not null references public.teams(id) on delete cascade,
  tactic_id text not null check (
    tactic_id in (
      'over-25',
      'clean-sheet',
      'first-goal',
      'set-piece',
      'red-card',
      'penalty'
    )
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (match_id, team_id, tactic_id)
);

alter table public.match_tactic_results enable row level security;

drop policy if exists "public validated tactic read" on public.match_tactic_results;
drop policy if exists "admin tactic insert" on public.match_tactic_results;
drop policy if exists "admin tactic update" on public.match_tactic_results;
drop policy if exists "admin tactic delete" on public.match_tactic_results;

create policy "public validated tactic read" on public.match_tactic_results
for select using (
  exists (
    select 1
    from public.matches m
    where m.id = match_tactic_results.match_id
      and m.status = 'validated'
  )
);

create policy "admin tactic insert" on public.match_tactic_results
for insert with check (public.is_admin());

create policy "admin tactic update" on public.match_tactic_results
for update using (public.is_admin()) with check (public.is_admin());

create policy "admin tactic delete" on public.match_tactic_results
for delete using (public.is_admin());

insert into public.scoring_rules (code, label, points)
values ('trainer_tactic_hit', 'Chip de entrenador', 0)
on conflict (code) do update set
  label = excluded.label,
  points = excluded.points,
  active = true;

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
    t.name || ' - ' || tactic.label || ' partido ' || replace(mtr.match_id, 'wc26-', ''),
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
        when 'over-25' then 2
        when 'clean-sheet' then 2
        when 'first-goal' then 2
        when 'set-piece' then 2
        when 'red-card' then 5
        when 'penalty' then 3
      end as points,
      case mtr.tactic_id
        when 'over-25' then 'Goleador'
        when 'clean-sheet' then 'Muro'
        when 'first-goal' then 'Abrelatas'
        when 'set-piece' then 'Estratega'
        when 'red-card' then 'Carnicero'
        when 'penalty' then 'VAR'
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
  perform public.recalculate_trainer_tactic_scores();
end;
$$;

create or replace function public.recalculate_trainer_tactic_scores_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recalculate_trainer_tactic_scores();
  return coalesce(new, old);
end;
$$;

drop trigger if exists recalculate_trainer_tactic_scores_after_change on public.match_tactic_results;
create trigger recalculate_trainer_tactic_scores_after_change
  after insert or update or delete on public.match_tactic_results
  for each row execute procedure public.recalculate_trainer_tactic_scores_trigger();

select public.recalculate_scores();
