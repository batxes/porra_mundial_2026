-- Run this file once in the Supabase SQL editor.
-- The browser app only uses the public anon key. Keep the service role key in server-side jobs.

create extension if not exists pgcrypto;

create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  predictions_lock_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 40),
  avatar_url text,
  total_points integer not null default 0,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.teams (
  id text primary key,
  fifa_code text not null unique,
  name text not null,
  flag_code text not null,
  group_code text check (group_code between 'A' and 'L'),
  source_updated_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.players (
  id text primary key,
  fifa_id text unique,
  team_id text not null references public.teams(id),
  display_name text not null,
  position text not null check (position in ('POR', 'DEF', 'MED', 'DEL')),
  squad_status text not null default 'provisional' check (squad_status in ('provisional', 'validated', 'withdrawn')),
  source_updated_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.matches (
  id text primary key,
  tournament_id uuid not null references public.tournaments(id),
  stage text not null,
  group_code text,
  home_team_id text references public.teams(id),
  away_team_id text references public.teams(id),
  scheduled_at timestamptz not null,
  venue text,
  status text not null default 'scheduled' check (status in ('scheduled', 'live', 'finished', 'validated')),
  home_score integer,
  away_score integer,
  validated_at timestamptz,
  source_updated_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.match_events (
  id uuid primary key default gen_random_uuid(),
  match_id text not null references public.matches(id) on delete cascade,
  source_event_id text,
  minute integer check (minute >= 0),
  added_minute integer check (added_minute >= 0),
  event_type text not null check (
    event_type in ('goal', 'penalty_goal', 'penalty_miss', 'penalty_save', 'yellow_card', 'red_card', 'own_goal', 'mvp')
  ),
  team_id text references public.teams(id),
  player_id text references public.players(id),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (match_id, source_event_id)
);

create table if not exists public.player_match_stats (
  match_id text not null references public.matches(id) on delete cascade,
  player_id text not null references public.players(id),
  team_id text not null references public.teams(id),
  goals integer not null default 0,
  penalty_goals integer not null default 0,
  penalty_misses integer not null default 0,
  penalty_saves integer not null default 0,
  goalkeeper_saves integer not null default 0,
  yellow_cards integer not null default 0,
  red_cards integer not null default 0,
  is_mvp boolean not null default false,
  source_updated_at timestamptz,
  primary key (match_id, player_id)
);

create table if not exists public.predictions (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  tournament_id uuid not null references public.tournaments(id),
  selections jsonb not null default '{}'::jsonb,
  completion_percent integer not null default 0 check (completion_percent between 0 and 100),
  is_definitive boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.scoring_rules (
  code text primary key,
  label text not null,
  points integer not null,
  active boolean not null default true
);

create table if not exists public.score_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  match_id text references public.matches(id) on delete cascade,
  rule_code text not null references public.scoring_rules(code),
  points integer not null,
  explanation text not null,
  source_ref text,
  created_at timestamptz not null default now()
);

create table if not exists public.data_import_runs (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  source_url text not null,
  source_kind text not null check (source_kind in ('fifa_official', 'sportradar', 'api_football', 'manual_review')),
  payload_sha256 text not null,
  status text not null default 'pending' check (status in ('pending', 'imported', 'reviewed', 'rejected')),
  fetched_at timestamptz not null default now(),
  reviewed_at timestamptz,
  notes text
);

create table if not exists public.match_source_versions (
  id uuid primary key default gen_random_uuid(),
  match_id text not null references public.matches(id) on delete cascade,
  import_run_id uuid not null references public.data_import_runs(id),
  raw_payload jsonb not null,
  created_at timestamptz not null default now()
);

insert into public.tournaments (slug, name, starts_at, ends_at, predictions_lock_at)
values ('world-cup-2026', 'Mundial 2026', '2026-06-11 19:00:00+00', '2026-07-19 23:59:59+00', '2026-06-11 19:00:00+00')
on conflict (slug) do update set
  name = excluded.name,
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at,
  predictions_lock_at = excluded.predictions_lock_at;

insert into public.scoring_rules (code, label, points) values
  ('match_outcome_hit', 'Eleccion acertada', 1),
  ('match_exact_score', 'Marcador exacto', 0),
  ('player_goal', 'Gol de jugador del once segun posicion', 0),
  ('player_penalty_goal', 'Penalti marcado', 1),
  ('player_match_mvp', 'MVP del partido', 3),
  ('player_penalty_save', 'Penalti parado', 2),
  ('player_penalty_miss', 'Penalti fallado', -1),
  ('player_red_card', 'Tarjeta roja', -2),
  ('team_progression_hit', 'Acierto de clasificación según ronda', 0),
  ('group_qualification_hit', 'Equipo clasificado en grupos', 2),
  ('group_position_hit', 'Orden exacto en grupo', 3),
  ('tournament_champion_hit', 'Ganador del Mundial', 25),
  ('tournament_mvp_hit', 'MVP del Mundial', 20),
  ('tournament_top_scorer_hit', 'Máximo goleador', 20)
on conflict (code) do update set label = excluded.label, points = excluded.points;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.prevent_definitive_prediction_changes()
returns trigger
language plpgsql
as $$
begin
  if old.is_definitive then
    raise exception 'La porra definitiva ya no admite cambios';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_definitive_prediction_changes on public.predictions;
create trigger prevent_definitive_prediction_changes
  before update on public.predictions
  for each row execute procedure public.prevent_definitive_prediction_changes();

alter table public.tournaments enable row level security;
alter table public.profiles enable row level security;
alter table public.teams enable row level security;
alter table public.players enable row level security;
alter table public.matches enable row level security;
alter table public.match_events enable row level security;
alter table public.player_match_stats enable row level security;
alter table public.predictions enable row level security;
alter table public.scoring_rules enable row level security;
alter table public.score_entries enable row level security;

create policy "public tournament read" on public.tournaments for select using (true);
create policy "public profile read" on public.profiles for select using (true);
create policy "owner profile update" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);
create policy "public team read" on public.teams for select using (true);
create policy "public validated player read" on public.players for select using (squad_status = 'validated');
create policy "public validated match read" on public.matches for select using (status = 'validated');
create policy "admin match insert" on public.matches for insert with check (public.is_admin());
create policy "admin match update" on public.matches for update using (public.is_admin()) with check (public.is_admin());
create policy "public validated event read" on public.match_events for select using (
  exists (select 1 from public.matches where matches.id = match_events.match_id and matches.status = 'validated')
);
create policy "admin event insert" on public.match_events for insert with check (public.is_admin());
create policy "admin event update" on public.match_events for update using (public.is_admin()) with check (public.is_admin());
create policy "public validated stats read" on public.player_match_stats for select using (
  exists (select 1 from public.matches where matches.id = player_match_stats.match_id and matches.status = 'validated')
);
create policy "public scoring rule read" on public.scoring_rules for select using (active);
create policy "public score ledger read" on public.score_entries for select using (true);
create policy "owner prediction insert before lock" on public.predictions for insert with check (
  auth.uid() = user_id
  and exists (select 1 from public.tournaments where tournaments.id = tournament_id and now() < predictions_lock_at)
);
create policy "owner prediction update before lock" on public.predictions for update using (
  auth.uid() = user_id
  and exists (select 1 from public.tournaments where tournaments.id = tournament_id and now() < predictions_lock_at)
) with check (auth.uid() = user_id);
create policy "owner or locked prediction read" on public.predictions for select using (
  auth.uid() = user_id
  or exists (select 1 from public.tournaments where tournaments.id = tournament_id and now() >= predictions_lock_at)
);

create or replace function public.prevent_profile_score_or_admin_self_update()
returns trigger
language plpgsql
as $$
begin
  if current_setting('app.recalculating_scores', true) = 'on' then
    return new;
  end if;
  if not public.is_admin() then
    new.total_points := old.total_points;
    new.is_admin := old.is_admin;
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_profile_score_or_admin_self_update on public.profiles;
create trigger prevent_profile_score_or_admin_self_update
  before update on public.profiles
  for each row execute procedure public.prevent_profile_score_or_admin_self_update();

drop policy if exists "admin profile update" on public.profiles;
create policy "admin profile update" on public.profiles for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin match delete" on public.matches;
create policy "admin match delete" on public.matches for delete using (public.is_admin());
drop policy if exists "admin event delete" on public.match_events;
create policy "admin event delete" on public.match_events for delete using (public.is_admin());

create or replace function public.recalculate_scores()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
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
  where profile.id = totals.id;
end;
$$;

create or replace function public.recalculate_scores_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recalculate_scores();
  return coalesce(new, old);
end;
$$;

drop trigger if exists recalculate_scores_after_match_change on public.matches;
create trigger recalculate_scores_after_match_change
  after insert or update or delete on public.matches
  for each row execute procedure public.recalculate_scores_trigger();

drop trigger if exists recalculate_scores_after_event_change on public.match_events;
create trigger recalculate_scores_after_event_change
  after insert or update or delete on public.match_events
  for each row execute procedure public.recalculate_scores_trigger();

drop trigger if exists recalculate_scores_after_prediction_change on public.predictions;
create trigger recalculate_scores_after_prediction_change
  after insert or update or delete on public.predictions
  for each row execute procedure public.recalculate_scores_trigger();

create or replace function public.admin_delete_user(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  target_email text;
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede borrar usuarios';
  end if;
  if auth.uid() = target_user_id then
    raise exception 'No puedes borrar tu propio usuario desde la web';
  end if;

  select email into target_email from auth.users where id = target_user_id;
  if target_email = 'admin@admin.admin' then
    raise exception 'El administrador principal no se puede borrar';
  end if;

  delete from auth.users where id = target_user_id;
end;
$$;

create or replace function public.admin_set_user_admin(target_user_id uuid, next_is_admin boolean)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  target_email text;
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede cambiar roles';
  end if;

  select email into target_email from auth.users where id = target_user_id;
  if target_email = 'admin@admin.admin' and next_is_admin = false then
    raise exception 'El administrador principal no puede perder el rol admin';
  end if;

  update public.profiles
  set is_admin = next_is_admin,
      updated_at = now()
  where id = target_user_id;
end;
$$;

update public.profiles
set is_admin = true,
    updated_at = now()
where id = (
  select id
  from auth.users
  where email = 'admin@admin.admin'
  limit 1
);
