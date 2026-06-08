-- Run this after migration-002. It makes scoring deterministic and recalculable.

insert into public.scoring_rules (code, label, points) values
  ('match_exact_score', 'Marcador exacto', 0)
on conflict (code) do update set label = excluded.label, points = excluded.points;

insert into public.players (id, team_id, display_name, position, squad_status) values
  ('martinez', 'arg', 'Emiliano Martínez', 'POR', 'provisional'),
  ('alisson', 'bra', 'Alisson Becker', 'POR', 'provisional'),
  ('simon', 'esp', 'Unai Simón', 'POR', 'provisional'),
  ('maignan', 'fra', 'Mike Maignan', 'POR', 'provisional'),
  ('bounou', 'mar', 'Yassine Bounou', 'POR', 'provisional'),
  ('dibu', 'uru', 'Sergio Rochet', 'POR', 'provisional'),
  ('gvardiol', 'cro', 'Joško Gvardiol', 'DEF', 'provisional'),
  ('saliba', 'fra', 'William Saliba', 'DEF', 'provisional'),
  ('hakimi', 'mar', 'Achraf Hakimi', 'DEF', 'provisional'),
  ('dias', 'por', 'Rúben Dias', 'DEF', 'provisional'),
  ('romero', 'arg', 'Cristian Romero', 'DEF', 'provisional'),
  ('van-dijk', 'ned', 'Virgil van Dijk', 'DEF', 'provisional'),
  ('trent', 'eng', 'Trent Alexander-Arnold', 'DEF', 'provisional'),
  ('theo', 'fra', 'Theo Hernández', 'DEF', 'provisional'),
  ('davies', 'can', 'Alphonso Davies', 'DEF', 'provisional'),
  ('araujo', 'uru', 'Ronald Araújo', 'DEF', 'provisional'),
  ('rodri', 'esp', 'Rodri', 'MED', 'provisional'),
  ('bellingham', 'eng', 'Jude Bellingham', 'MED', 'provisional'),
  ('valverde', 'uru', 'Federico Valverde', 'MED', 'provisional'),
  ('pedri', 'esp', 'Pedri', 'MED', 'provisional'),
  ('vitinha', 'por', 'Vitinha', 'MED', 'provisional'),
  ('wirtz', 'ger', 'Florian Wirtz', 'MED', 'provisional'),
  ('mac-allister', 'arg', 'Alexis Mac Allister', 'MED', 'provisional'),
  ('hakha', 'tur', 'Hakan Çalhanoğlu', 'MED', 'provisional'),
  ('kdb', 'bel', 'Kevin De Bruyne', 'MED', 'provisional'),
  ('odegaard', 'nor', 'Martin Ødegaard', 'MED', 'provisional'),
  ('kudus', 'gha', 'Mohammed Kudus', 'MED', 'provisional'),
  ('enzo', 'arg', 'Enzo Fernández', 'MED', 'provisional'),
  ('yamal', 'esp', 'Lamine Yamal', 'DEL', 'provisional'),
  ('mbappe', 'fra', 'Kylian Mbappé', 'DEL', 'provisional'),
  ('vinicius', 'bra', 'Vinícius Júnior', 'DEL', 'provisional'),
  ('haaland', 'nor', 'Erling Haaland', 'DEL', 'provisional'),
  ('kane', 'eng', 'Harry Kane', 'DEL', 'provisional'),
  ('lautaro', 'arg', 'Lautaro Martínez', 'DEL', 'provisional'),
  ('salah', 'egy', 'Mohamed Salah', 'DEL', 'provisional'),
  ('leao', 'por', 'Rafael Leão', 'DEL', 'provisional'),
  ('diaz', 'col', 'Luis Díaz', 'DEL', 'provisional'),
  ('pulisic', 'usa', 'Christian Pulisic', 'DEL', 'provisional'),
  ('kubo', 'jpn', 'Takefusa Kubo', 'DEL', 'provisional'),
  ('mane', 'sen', 'Sadio Mané', 'DEL', 'provisional')
on conflict (id) do update set
  team_id = excluded.team_id,
  display_name = excluded.display_name,
  position = excluded.position,
  squad_status = excluded.squad_status;

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
      when 'goal' then 2
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
    1,
    'Ganador acertado partido ' || replace(m.id, 'wc26-', ''),
    'winner-' || replace(m.id, 'wc26-', '')
  from public.predictions p
  join public.matches m on m.status in ('finished', 'validated')
  where replace(m.id, 'wc26-', '')::integer >= 73
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
    5,
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

select public.recalculate_scores();
