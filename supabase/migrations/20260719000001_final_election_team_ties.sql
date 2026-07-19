-- Permite varios ganadores oficiales cuando hay empate en las tres
-- categorias estadisticas por equipos. Cada usuario sigue eligiendo un solo
-- equipo y recibe los puntos completos si su eleccion esta entre los empatados.

alter table public.tournament_final_results
  drop constraint if exists tournament_final_results_highest_scoring_team_id_fkey,
  drop constraint if exists tournament_final_results_most_conceded_team_id_fkey,
  drop constraint if exists tournament_final_results_most_reds_team_id_fkey;

alter table public.tournament_final_results
  alter column highest_scoring_team_id type text[]
    using case
      when highest_scoring_team_id is null then '{}'::text[]
      else array[highest_scoring_team_id]
    end,
  alter column most_conceded_team_id type text[]
    using case
      when most_conceded_team_id is null then '{}'::text[]
      else array[most_conceded_team_id]
    end,
  alter column most_reds_team_id type text[]
    using case
      when most_reds_team_id is null then '{}'::text[]
      else array[most_reds_team_id]
    end;

alter table public.tournament_final_results
  alter column highest_scoring_team_id set default '{}'::text[],
  alter column highest_scoring_team_id set not null,
  alter column most_conceded_team_id set default '{}'::text[],
  alter column most_conceded_team_id set not null,
  alter column most_reds_team_id set default '{}'::text[],
  alter column most_reds_team_id set not null;

create or replace function public.recalculate_final_election_scores()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.score_entries
  where rule_code in (
    'tournament_champion_hit',
    'tournament_highest_scoring_team_hit',
    'tournament_most_conceded_team_hit',
    'tournament_most_reds_team_hit',
    'tournament_top_scorer_hit',
    'tournament_mvp_hit'
  );

  insert into public.score_entries (
    user_id,
    rule_code,
    points,
    explanation,
    source_ref
  )
  select
    prediction.user_id,
    choice.rule_code,
    choice.points,
    choice.label || ' acertado',
    choice.source_ref
  from public.predictions prediction
  join public.tournament_final_results final
    on final.tournament_id = prediction.tournament_id
  cross join lateral (
    values
      (
        'tournament_champion_hit'::text,
        25,
        'Campeon del Mundial'::text,
        'worldChampion'::text,
        case
          when final.world_champion_team_id is null then '{}'::text[]
          else array[final.world_champion_team_id]
        end,
        coalesce(
          nullif(prediction.selections #>> array['extras', 'worldChampion'], ''),
          nullif(prediction.selections #>> array['bracket', 'winners', '104'], '')
        )
      ),
      (
        'tournament_highest_scoring_team_hit',
        10,
        'Equipo mas goleador',
        'highestScoringTeam',
        final.highest_scoring_team_id,
        nullif(prediction.selections #>> array['extras', 'highestScoringTeam'], '')
      ),
      (
        'tournament_most_conceded_team_hit',
        10,
        'Equipo mas goleado',
        'mostConcededTeam',
        final.most_conceded_team_id,
        nullif(prediction.selections #>> array['extras', 'mostConcededTeam'], '')
      ),
      (
        'tournament_most_reds_team_hit',
        10,
        'Equipo con mas rojas',
        'mostRedsTeam',
        final.most_reds_team_id,
        nullif(prediction.selections #>> array['extras', 'mostRedsTeam'], '')
      ),
      (
        'tournament_top_scorer_hit',
        20,
        'Maximo goleador',
        'topScorer',
        case
          when final.top_scorer_player_id is null then '{}'::text[]
          else array[final.top_scorer_player_id]
        end,
        nullif(prediction.selections #>> array['extras', 'topScorer'], '')
      ),
      (
        'tournament_mvp_hit',
        20,
        'MVP del Mundial',
        'mvp',
        case
          when final.mvp_player_id is null then '{}'::text[]
          else array[final.mvp_player_id]
        end,
        nullif(prediction.selections #>> array['extras', 'mvp'], '')
      )
  ) as choice(rule_code, points, label, source_ref, actual_ids, predicted_id)
  where cardinality(choice.actual_ids) > 0
    and choice.predicted_id = any(choice.actual_ids);

  update public.profiles profile
  set total_points = coalesce(totals.total_points, 0),
      updated_at = now()
  from (
    select
      profiles.id,
      coalesce(sum(score_entries.points), 0)::integer as total_points
    from public.profiles
    left join public.score_entries
      on score_entries.user_id = profiles.id
    group by profiles.id
  ) totals
  where profile.id = totals.id;
end;
$$;

revoke all on function public.recalculate_final_election_scores() from public;

drop function if exists public.admin_set_tournament_final_results(
  text, text, text, text, text, text
);

create or replace function public.admin_set_tournament_final_results(
  p_world_champion_team_id text default null,
  p_highest_scoring_team_ids text[] default '{}'::text[],
  p_most_conceded_team_ids text[] default '{}'::text[],
  p_most_reds_team_ids text[] default '{}'::text[],
  p_top_scorer_player_id text default null,
  p_mvp_player_id text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tournament_id uuid;
  v_highest_scoring_team_ids text[];
  v_most_conceded_team_ids text[];
  v_most_reds_team_ids text[];
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede guardar los resultados finales';
  end if;

  select id into v_tournament_id
  from public.tournaments
  where slug = 'world-cup-2026';

  if v_tournament_id is null then
    raise exception 'No se ha encontrado el Mundial 2026';
  end if;

  select coalesce(array_agg(team_id order by team_id), '{}'::text[])
  into v_highest_scoring_team_ids
  from (
    select distinct nullif(trim(selected.team_id), '') as team_id
    from unnest(coalesce(p_highest_scoring_team_ids, '{}'::text[]))
      as selected(team_id)
  ) normalized
  where team_id is not null;

  select coalesce(array_agg(team_id order by team_id), '{}'::text[])
  into v_most_conceded_team_ids
  from (
    select distinct nullif(trim(selected.team_id), '') as team_id
    from unnest(coalesce(p_most_conceded_team_ids, '{}'::text[]))
      as selected(team_id)
  ) normalized
  where team_id is not null;

  select coalesce(array_agg(team_id order by team_id), '{}'::text[])
  into v_most_reds_team_ids
  from (
    select distinct nullif(trim(selected.team_id), '') as team_id
    from unnest(coalesce(p_most_reds_team_ids, '{}'::text[]))
      as selected(team_id)
  ) normalized
  where team_id is not null;

  if exists (
    select 1
    from unnest(
      v_highest_scoring_team_ids ||
      v_most_conceded_team_ids ||
      v_most_reds_team_ids
    ) as selected(team_id)
    where not exists (
      select 1
      from public.teams
      where teams.id = selected.team_id
    )
  ) then
    raise exception 'Hay equipos finales que no existen';
  end if;

  insert into public.tournament_final_results (
    tournament_id,
    world_champion_team_id,
    highest_scoring_team_id,
    most_conceded_team_id,
    most_reds_team_id,
    top_scorer_player_id,
    mvp_player_id,
    updated_by,
    updated_at
  )
  values (
    v_tournament_id,
    nullif(trim(p_world_champion_team_id), ''),
    v_highest_scoring_team_ids,
    v_most_conceded_team_ids,
    v_most_reds_team_ids,
    nullif(trim(p_top_scorer_player_id), ''),
    nullif(trim(p_mvp_player_id), ''),
    auth.uid(),
    now()
  )
  on conflict (tournament_id) do update
  set world_champion_team_id = excluded.world_champion_team_id,
      highest_scoring_team_id = excluded.highest_scoring_team_id,
      most_conceded_team_id = excluded.most_conceded_team_id,
      most_reds_team_id = excluded.most_reds_team_id,
      top_scorer_player_id = excluded.top_scorer_player_id,
      mvp_player_id = excluded.mvp_player_id,
      updated_by = excluded.updated_by,
      updated_at = now();

  perform public.recalculate_scores();
end;
$$;

revoke all on function public.admin_set_tournament_final_results(
  text, text[], text[], text[], text, text
) from public;
grant execute on function public.admin_set_tournament_final_results(
  text, text[], text[], text[], text, text
) to authenticated;

select public.recalculate_scores();
