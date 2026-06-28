-- Limita las cartas nuevas de sobres a jugadores de selecciones vivas en
-- eliminatorias. Antes de que la BBDD pueda conocer el cuadro, los pickers
-- mantienen el comportamiento anterior para no vaciar los sobres.

create or replace function public.card_playoff_qualified_team_ids()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  with group_codes as (
    select group_code
    from public.teams
    where group_code is not null
    group by group_code
  ),
  scored_group_matches as (
    select
      home_team.group_code,
      m.id
    from public.matches m
    join public.teams home_team on home_team.id = m.home_team_id
    join public.teams away_team on away_team.id = m.away_team_id
    where home_team.group_code = away_team.group_code
      and m.stage = 'Grupos'
      and m.status in ('finished', 'validated')
      and m.home_score is not null
      and m.away_score is not null
  ),
  group_match_counts as (
    select group_code, count(distinct id) as played
    from scored_group_matches
    group by group_code
  ),
  complete_check as (
    select
      count(*) = 12
      and bool_and(coalesce(group_match_counts.played, 0) = 6) as complete
    from group_codes
    left join group_match_counts using (group_code)
  ),
  raw_standings as (
    select
      t.id as team_id,
      t.group_code,
      t.name,
      coalesce(sum(
        case
          when m.id is null then 0
          when t.id = m.home_team_id and m.home_score > m.away_score then 3
          when t.id = m.away_team_id and m.away_score > m.home_score then 3
          when m.home_score = m.away_score then 1
          else 0
        end
      ), 0) as pts,
      coalesce(sum(
        case
          when t.id = m.home_team_id then m.home_score
          when t.id = m.away_team_id then m.away_score
          else 0
        end
      ), 0) as gf,
      coalesce(sum(
        case
          when t.id = m.home_team_id then m.away_score
          when t.id = m.away_team_id then m.home_score
          else 0
        end
      ), 0) as ga
    from public.teams t
    left join public.matches m
      on t.id in (m.home_team_id, m.away_team_id)
      and m.stage = 'Grupos'
      and m.status in ('finished', 'validated')
      and m.home_score is not null
      and m.away_score is not null
    where t.group_code is not null
    group by t.id, t.group_code, t.name
  ),
  standings as (
    select
      team_id,
      group_code,
      name,
      pts,
      gf,
      gf - ga as gd
    from raw_standings
  ),
  ranked as (
    select
      standings.*,
      row_number() over (
        partition by group_code
        order by pts desc, gd desc, gf desc, name asc
      ) as position
    from standings
  ),
  best_thirds as (
    select team_id
    from ranked
    where position = 3
    order by pts desc, gd desc, gf desc, name asc
    limit 8
  ),
  qualified as (
    select team_id
    from ranked
    where position <= 2

    union

    select team_id
    from best_thirds
  )
  select case
    when (select complete from complete_check) then
      coalesce(
        (select array_agg(team_id order by team_id) from qualified),
        '{}'::text[]
      )
    else '{}'::text[]
  end;
$$;

create or replace function public.card_recorded_playoff_team_ids()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(team_id order by team_id), '{}'::text[])
  from (
    select distinct team_id
    from (
      select m.home_team_id as team_id
      from public.matches m
      where m.stage in (
        'Dieciseisavos',
        'Octavos',
        'Cuartos',
        'Semifinales',
        'Final'
      )
        and m.home_team_id is not null

      union all

      select m.away_team_id as team_id
      from public.matches m
      where m.stage in (
        'Dieciseisavos',
        'Octavos',
        'Cuartos',
        'Semifinales',
        'Final'
      )
        and m.away_team_id is not null
    ) recorded
  ) teams;
$$;

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
          else null
        end as team_id
      from public.matches m
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
        and m.home_score <> m.away_score
    ) loser
    where loser.team_id is not null
  ) eliminated
  where team_id is not null;
$$;

create or replace function public.card_alive_playoff_team_ids()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  with qualified as (
    select unnest(public.card_playoff_qualified_team_ids()) as team_id
  ),
  recorded as (
    select unnest(public.card_recorded_playoff_team_ids()) as team_id
  ),
  base as (
    select team_id from qualified

    union

    select team_id
    from recorded
    where not exists (select 1 from qualified)
  ),
  eliminated as (
    select unnest(public.card_eliminated_playoff_team_ids()) as team_id
  )
  select coalesce(array_agg(team_id order by team_id), '{}'::text[])
  from (
    select distinct base.team_id
    from base
    where base.team_id is not null
      and not exists (
        select 1
        from eliminated
        where eliminated.team_id = base.team_id
      )
  ) alive;
$$;

create or replace function public.card_player_is_alive_playoff(p_team_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with alive as (
    select public.card_alive_playoff_team_ids() as team_ids
  )
  select
    coalesce(array_length(team_ids, 1), 0) = 0
    or p_team_id = any(team_ids)
  from alive;
$$;

create or replace function public.card_pool_pick(
  p_pool text,
  p_seed text,
  p_exclude text[] default '{}'::text[]
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  with alive as (
    select public.card_alive_playoff_team_ids() as team_ids
  )
  select p.id
  from public.players p
  join public.card_pool_players cp on cp.player_id = p.id and cp.pool = p_pool
  cross join alive
  where p.squad_status <> 'withdrawn'
    and p.id <> all (coalesce(array_remove(p_exclude, null), '{}'::text[]))
    and (
      coalesce(array_length(alive.team_ids, 1), 0) = 0
      or p.team_id = any(alive.team_ids)
    )
  order by md5(coalesce(p_seed, '') || ':' || p.id)
  limit 1;
$$;

create or replace function public.card_any_pick(
  p_seed text,
  p_exclude text[] default '{}'::text[]
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  with alive as (
    select public.card_alive_playoff_team_ids() as team_ids
  )
  select p.id
  from public.players p
  cross join alive
  where p.squad_status <> 'withdrawn'
    and p.id <> all (coalesce(array_remove(p_exclude, null), '{}'::text[]))
    and (
      coalesce(array_length(alive.team_ids, 1), 0) = 0
      or p.team_id = any(alive.team_ids)
    )
  order by md5(coalesce(p_seed, '') || ':' || p.id)
  limit 1;
$$;

create or replace function public.card_pool_pick_many(
  p_pool text,
  p_seed text,
  p_count integer default 3,
  p_exclude text[] default '{}'::text[]
)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  with alive as (
    select public.card_alive_playoff_team_ids() as team_ids
  )
  select coalesce(array_agg(picked.id order by picked.sort_key), '{}'::text[])
  from (
    select p.id, md5(coalesce(p_seed, '') || ':' || p.id) as sort_key
    from public.players p
    join public.card_pool_players cp on cp.player_id = p.id and cp.pool = p_pool
    cross join alive
    where p.squad_status <> 'withdrawn'
      and p.id <> all (coalesce(array_remove(p_exclude, null), '{}'::text[]))
      and (
        coalesce(array_length(alive.team_ids, 1), 0) = 0
        or p.team_id = any(alive.team_ids)
      )
    order by sort_key
    limit least(3, greatest(1, coalesce(p_count, 3)))
  ) picked;
$$;

create or replace function public.open_card_drop(p_drop_id text)
returns table (
  card_id uuid,
  drop_id text,
  card_index integer,
  player_id text,
  used_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_drop public.card_drops%rowtype;
  v_pool text;
  v_seen text[];
  v_player_ids text[];
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  select * into v_drop
  from public.card_drops
  where id = p_drop_id and available_at <= now();

  if not found or v_drop.kind = 'forge' then
    raise exception 'Sobre no disponible';
  end if;

  if (
    v_drop.id like 'special-sobera-%'
    or v_drop.id like 'special-ruleta-%'
    or v_drop.id like 'special-oak-%'
    or v_drop.id like 'special-hoguera-%'
    or v_drop.id like 'special-suarez-%'
    or (v_drop.created_by is not null and v_drop.id not like 'special-%')
  ) and v_drop.created_by is distinct from v_uid then
    raise exception 'Sobre no disponible';
  end if;

  v_player_ids := v_drop.player_ids;

  if not exists (
    select 1 from public.user_cards c
    where c.user_id = v_uid and c.drop_id = v_drop.id
  ) then
    v_pool := coalesce(
      public.card_pool_from_pack_label(v_drop.label),
      case when v_drop.id like 'special-%' then 'diario' else null end
    );

    if v_pool is not null
      and (
        (v_drop.id like 'special-%' and v_drop.created_by is distinct from v_uid)
        or exists (
          select 1
          from unnest(v_drop.player_ids) as stale(player_id)
          join public.players p on p.id = stale.player_id
          where not public.card_player_is_alive_playoff(p.team_id)
        )
      )
    then
      v_seen := public.card_user_seen_player_ids(v_uid);
      if v_pool = 'diario' then
        v_player_ids := public.daily_pack_player_ids_avoiding(
          'drop:' || v_drop.id || ':' || v_uid::text,
          v_seen
        );
      else
        v_player_ids := public.sobera_pick_reward_player_ids(
          v_pool,
          'drop:' || v_drop.id || ':' || v_uid::text,
          v_seen
        );
      end if;

      if coalesce(array_length(v_player_ids, 1), 0) = 0 then
        v_player_ids := v_drop.player_ids;
      end if;
    end if;
  end if;

  insert into public.user_cards (user_id, drop_id, card_index, player_id)
  select v_uid, v_drop.id, cards.ordinality::integer, cards.player_id
  from unnest(v_player_ids) with ordinality as cards(player_id, ordinality)
  where cards.player_id is not null
  on conflict (user_id, drop_id, card_index) do nothing;

  return query
  select c.id, c.drop_id, c.card_index, c.player_id, c.used_at, c.created_at
  from public.user_cards c
  where c.user_id = v_uid and c.drop_id = v_drop.id
  order by c.card_index;
end;
$$;

revoke all on function public.card_playoff_qualified_team_ids() from public;
revoke all on function public.card_recorded_playoff_team_ids() from public;
revoke all on function public.card_eliminated_playoff_team_ids() from public;
revoke all on function public.card_alive_playoff_team_ids() from public;
revoke all on function public.card_player_is_alive_playoff(text) from public;
revoke all on function public.card_pool_pick(text, text, text[]) from public;
revoke all on function public.card_any_pick(text, text[]) from public;
revoke all on function public.card_pool_pick_many(text, text, integer, text[]) from public;
revoke all on function public.open_card_drop(text) from public;

grant execute on function public.open_card_drop(text) to authenticated;
