-- Refuerza el bloqueo de swaps para cualquier cruce de playoffs ya conocido.
-- Las filas estaticas de match_lock_teams cubren grupos y dieciseisavos; esta
-- capa infiere octavos en adelante desde los partidos previos validados.

create or replace function public.match_shootout_winner_team_id(p_match_number integer)
returns text
language sql
stable
security definer
set search_path = public
as $$
  with goals as (
    select
      e.team_id,
      count(*)::integer as goals
    from public.match_events e
    where e.match_id = 'wc26-' || p_match_number::text
      and e.details ->> 'phase' = 'shootout'
      and e.event_type = 'penalty_goal'
      and e.team_id is not null
    group by e.team_id
  ),
  ranked as (
    select
      team_id,
      goals,
      count(*) over () as teams_count,
      max(goals) over () as max_goals
    from goals
  )
  select team_id
  from ranked
  where teams_count >= 2
    and goals = max_goals
    and 1 = (
      select count(*)
      from ranked tied
      where tied.goals = ranked.max_goals
    )
  limit 1;
$$;

create or replace function public.match_winner_team_id(p_match_number integer)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when m.home_score is null or m.away_score is null then null
    when m.status not in ('finished', 'validated') then null
    when m.home_score > m.away_score then m.home_team_id
    when m.away_score > m.home_score then m.away_team_id
    else public.match_shootout_winner_team_id(p_match_number)
  end
  from public.matches m
  where m.id = 'wc26-' || p_match_number::text
  limit 1;
$$;

create or replace function public.match_loser_team_id(p_match_number integer)
returns text
language sql
stable
security definer
set search_path = public
as $$
  with match_row as (
    select
      m.home_team_id,
      m.away_team_id,
      public.match_winner_team_id(p_match_number) as winner_team_id
    from public.matches m
    where m.id = 'wc26-' || p_match_number::text
    limit 1
  )
  select case
    when winner_team_id = home_team_id then away_team_id
    when winner_team_id = away_team_id then home_team_id
    else null
  end
  from match_row;
$$;

create or replace function public.inferred_knockout_match_lock_teams()
returns table(number integer, team_id text)
language sql
stable
security definer
set search_path = public
as $$
  select inferred.number, inferred.team_id
  from (
    values
      (89, public.match_winner_team_id(74)),
      (89, public.match_winner_team_id(77)),
      (90, public.match_winner_team_id(73)),
      (90, public.match_winner_team_id(75)),
      (91, public.match_winner_team_id(76)),
      (91, public.match_winner_team_id(78)),
      (92, public.match_winner_team_id(79)),
      (92, public.match_winner_team_id(80)),
      (93, public.match_winner_team_id(83)),
      (93, public.match_winner_team_id(84)),
      (94, public.match_winner_team_id(81)),
      (94, public.match_winner_team_id(82)),
      (95, public.match_winner_team_id(86)),
      (95, public.match_winner_team_id(88)),
      (96, public.match_winner_team_id(85)),
      (96, public.match_winner_team_id(87)),
      (97, public.match_winner_team_id(89)),
      (97, public.match_winner_team_id(90)),
      (98, public.match_winner_team_id(93)),
      (98, public.match_winner_team_id(94)),
      (99, public.match_winner_team_id(91)),
      (99, public.match_winner_team_id(92)),
      (100, public.match_winner_team_id(95)),
      (100, public.match_winner_team_id(96)),
      (101, public.match_winner_team_id(97)),
      (101, public.match_winner_team_id(98)),
      (102, public.match_winner_team_id(99)),
      (102, public.match_winner_team_id(100)),
      (103, public.match_loser_team_id(101)),
      (103, public.match_loser_team_id(102)),
      (104, public.match_winner_team_id(101)),
      (104, public.match_winner_team_id(102))
  ) as inferred(number, team_id)
  where inferred.team_id is not null;
$$;

create or replace function public.team_has_unvalidated_started_match(p_team_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.matches m
    where p_team_id in (m.home_team_id, m.away_team_id)
      and m.scheduled_at <= now()
      and m.status <> 'validated'
  )
  or exists (
    select 1
    from public.match_lock_teams lt
    join public.match_kickoffs k on k.number = lt.number
    left join public.matches m on m.id = 'wc26-' || lt.number::text
    where lt.team_id = p_team_id
      and k.kickoff <= now()
      and coalesce(m.status, 'scheduled') <> 'validated'
  )
  or exists (
    select 1
    from public.inferred_knockout_match_lock_teams() inferred
    join public.match_kickoffs k on k.number = inferred.number
    left join public.matches m on m.id = 'wc26-' || inferred.number::text
    where inferred.team_id = p_team_id
      and k.kickoff <= now()
      and coalesce(m.status, 'scheduled') <> 'validated'
  );
$$;

revoke all on function public.match_shootout_winner_team_id(integer) from public;
revoke all on function public.match_winner_team_id(integer) from public;
revoke all on function public.match_loser_team_id(integer) from public;
revoke all on function public.inferred_knockout_match_lock_teams() from public;
revoke all on function public.team_has_unvalidated_started_match(text) from public;
