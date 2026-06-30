-- La lista de equipos vivos para sobres tambien debe resolver eliminatorias
-- empatadas por tanda. Sin esto, el perdedor por penaltis seguia vivo para
-- card_alive_playoff_team_ids() y podia volver a salir en sobres.

create or replace function public.card_eliminated_playoff_team_ids()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(team_id order by team_id), '{}'::text[])
  from (
    with qualified as (
      select public.card_playoff_qualified_team_ids() as team_ids
    )
    select t.id as team_id
    from public.teams t
    cross join qualified
    where t.group_code is not null
      and coalesce(array_length(qualified.team_ids, 1), 0) > 0
      and not (t.id = any(qualified.team_ids))

    union

    select loser.team_id
    from (
      select distinct
        case
          when m.home_score > m.away_score then m.away_team_id
          when m.away_score > m.home_score then m.home_team_id
          when m.home_score = m.away_score
            and coalesce(shootout.home_penalties, 0) > coalesce(shootout.away_penalties, 0)
            then m.away_team_id
          when m.home_score = m.away_score
            and coalesce(shootout.away_penalties, 0) > coalesce(shootout.home_penalties, 0)
            then m.home_team_id
          else null
        end as team_id
      from public.matches m
      left join lateral (
        select
          count(*) filter (where e.team_id = m.home_team_id) as home_penalties,
          count(*) filter (where e.team_id = m.away_team_id) as away_penalties
        from public.match_events e
        where e.match_id = m.id
          and e.event_type = 'penalty_goal'
          and e.details ->> 'phase' = 'shootout'
      ) shootout on true
      where m.stage in (
          'Dieciseisavos',
          'Octavos',
          'Cuartos',
          'Semifinales',
          'Final'
        )
        and m.status in ('finished', 'validated')
        and m.home_team_id is not null
        and m.away_team_id is not null
        and m.home_score is not null
        and m.away_score is not null
    ) loser
    where loser.team_id is not null
  ) eliminated
  where team_id is not null;
$$;
