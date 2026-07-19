-- Cierre manual de "Tus elecciones". El admin confirma los seis resultados
-- oficiales y esos valores son la unica fuente de puntuacion final.

insert into public.scoring_rules (code, label, points, active)
values
  ('tournament_champion_hit', 'Ganador del Mundial', 25, true),
  ('tournament_highest_scoring_team_hit', 'Equipo mas goleador', 10, true),
  ('tournament_most_conceded_team_hit', 'Equipo mas goleado', 10, true),
  ('tournament_most_reds_team_hit', 'Equipo con mas rojas', 10, true),
  ('tournament_top_scorer_hit', 'Maximo goleador', 20, true),
  ('tournament_mvp_hit', 'MVP del Mundial', 20, true)
on conflict (code) do update
set label = excluded.label,
    points = excluded.points,
    active = true;

create table if not exists public.tournament_final_results (
  tournament_id uuid primary key references public.tournaments(id) on delete cascade,
  world_champion_team_id text references public.teams(id),
  highest_scoring_team_id text references public.teams(id),
  most_conceded_team_id text references public.teams(id),
  most_reds_team_id text references public.teams(id),
  top_scorer_player_id text references public.players(id),
  mvp_player_id text references public.players(id),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

alter table public.tournament_final_results enable row level security;

drop policy if exists "public tournament final results read"
  on public.tournament_final_results;
create policy "public tournament final results read"
  on public.tournament_final_results
  for select using (true);

grant select on public.tournament_final_results to anon, authenticated;
revoke insert, update, delete on public.tournament_final_results
  from anon, authenticated;

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
    p.user_id,
    choice.rule_code,
    choice.points,
    choice.label || ' acertado',
    choice.source_ref
  from public.predictions p
  join public.tournament_final_results final
    on final.tournament_id = p.tournament_id
  cross join lateral (
    values
      (
        'tournament_champion_hit'::text,
        25,
        'Campeon del Mundial'::text,
        'worldChampion'::text,
        final.world_champion_team_id,
        coalesce(
          nullif(p.selections #>> array['extras', 'worldChampion'], ''),
          nullif(p.selections #>> array['bracket', 'winners', '104'], '')
        )
      ),
      (
        'tournament_highest_scoring_team_hit',
        10,
        'Equipo mas goleador',
        'highestScoringTeam',
        final.highest_scoring_team_id,
        nullif(p.selections #>> array['extras', 'highestScoringTeam'], '')
      ),
      (
        'tournament_most_conceded_team_hit',
        10,
        'Equipo mas goleado',
        'mostConcededTeam',
        final.most_conceded_team_id,
        nullif(p.selections #>> array['extras', 'mostConcededTeam'], '')
      ),
      (
        'tournament_most_reds_team_hit',
        10,
        'Equipo con mas rojas',
        'mostRedsTeam',
        final.most_reds_team_id,
        nullif(p.selections #>> array['extras', 'mostRedsTeam'], '')
      ),
      (
        'tournament_top_scorer_hit',
        20,
        'Maximo goleador',
        'topScorer',
        final.top_scorer_player_id,
        nullif(p.selections #>> array['extras', 'topScorer'], '')
      ),
      (
        'tournament_mvp_hit',
        20,
        'MVP del Mundial',
        'mvp',
        final.mvp_player_id,
        nullif(p.selections #>> array['extras', 'mvp'], '')
      )
  ) as choice(rule_code, points, label, source_ref, actual_id, predicted_id)
  where choice.actual_id is not null
    and choice.predicted_id = choice.actual_id;

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

-- La funcion base todavia puede crear el campeon desde el partido 104. Este
-- ultimo paso lo elimina y aplica exclusivamente el cierre manual.
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
  perform public.recalculate_final_election_scores();
end;
$$;

create or replace function public.admin_set_tournament_final_results(
  p_world_champion_team_id text default null,
  p_highest_scoring_team_id text default null,
  p_most_conceded_team_id text default null,
  p_most_reds_team_id text default null,
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
    nullif(trim(p_highest_scoring_team_id), ''),
    nullif(trim(p_most_conceded_team_id), ''),
    nullif(trim(p_most_reds_team_id), ''),
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

revoke all on function public.recalculate_final_election_scores() from public;
revoke all on function public.admin_set_tournament_final_results(
  text, text, text, text, text, text
) from public;
grant execute on function public.admin_set_tournament_final_results(
  text, text, text, text, text, text
) to authenticated;

-- El despliegue retira cualquier bonus final automatico que pudiera existir.
select public.recalculate_scores();
