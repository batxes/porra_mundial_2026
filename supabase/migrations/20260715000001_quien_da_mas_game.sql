-- Quién da más: activación desde Admin, una partida cerrada de 12 duelos
-- por usuario y sobres privados al alcanzar 3, 6, 9 y 12 aciertos.

create table if not exists public.quien_da_mas_games (
  id uuid primary key default gen_random_uuid(),
  title text not null default '¿QUIÉN DA MÁS?',
  duel_time_ms integer not null default 10000 check (duel_time_ms between 5000 and 30000),
  duels jsonb not null,
  rewards jsonb not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.quien_da_mas_settings (
  id boolean primary key default true check (id),
  active boolean not null default false,
  active_game_id uuid references public.quien_da_mas_games(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.quien_da_mas_attempts (
  game_id uuid not null references public.quien_da_mas_games(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  picks jsonb not null,
  score integer not null check (score between 0 and 12),
  awarded_drop_ids text[] not null default '{}'::text[],
  completed_at timestamptz not null default now(),
  primary key (game_id, user_id)
);

create index if not exists quien_da_mas_attempts_completed_idx
  on public.quien_da_mas_attempts (completed_at desc);

alter table public.quien_da_mas_games enable row level security;
alter table public.quien_da_mas_settings enable row level security;
alter table public.quien_da_mas_attempts enable row level security;

drop policy if exists "public quien da mas settings read" on public.quien_da_mas_settings;
create policy "public quien da mas settings read" on public.quien_da_mas_settings
  for select using (true);
drop policy if exists "admin quien da mas games read" on public.quien_da_mas_games;
create policy "admin quien da mas games read" on public.quien_da_mas_games
  for select using (public.is_admin());
drop policy if exists "owner quien da mas attempts read" on public.quien_da_mas_attempts;
create policy "owner quien da mas attempts read" on public.quien_da_mas_attempts
  for select using (auth.uid() = user_id or public.is_admin());

grant select on public.quien_da_mas_settings to anon, authenticated;
grant select on public.quien_da_mas_games, public.quien_da_mas_attempts to authenticated;
revoke insert, update, delete on public.quien_da_mas_games, public.quien_da_mas_settings, public.quien_da_mas_attempts from anon, authenticated;

insert into public.quien_da_mas_games (id, title, duel_time_ms, duels, rewards)
values (
  '00000000-0000-0000-0000-0000000000f2'::uuid,
  '¿QUIÉN DA MÁS?',
  10000,
  $duels$
  [
    {
      "id": "altura-courtois-haaland", "question": "¿Quién mide más?", "metricLabel": "de altura", "format": "height",
      "a": { "id": "courtois", "name": "Courtois", "teamCode": "be", "teamName": "Bélgica", "image": "/courtois.webp", "value": 199 },
      "b": { "id": "haaland", "name": "Haaland", "teamCode": "no", "teamName": "Noruega", "image": "/halland.webp", "value": 195 }
    },
    {
      "id": "paises-clubes-haaland-courtois", "question": "¿Quién ha jugado en más países a nivel de clubes?", "metricLabel": "países distintos", "format": "int",
      "a": { "id": "haaland", "name": "Haaland", "teamCode": "no", "teamName": "Noruega", "image": "/halland.webp", "value": 4 },
      "b": { "id": "courtois", "name": "Courtois", "teamCode": "be", "teamName": "Bélgica", "image": "/courtois.webp", "value": 3 }
    },
    {
      "id": "traspasos-dembele-ferran", "question": "¿Quién ha movido más dinero en traspasos?", "metricLabel": "traspasos acumulados", "format": "currency",
      "a": { "id": "dembele", "name": "Dembélé", "teamCode": "fr", "teamName": "Francia", "image": "/dembele.webp", "value": 220000000 },
      "b": { "id": "ferran", "name": "Ferran", "teamCode": "es", "teamName": "España", "image": "/ferran.webp", "value": 88500000 }
    },
    {
      "id": "letras-cristiano-messi", "question": "¿Quién tiene más letras en su nombre completo?", "metricLabel": "letras sin espacios", "format": "int",
      "a": { "id": "cristiano", "name": "Cristiano", "teamCode": "pt", "teamName": "Portugal", "image": "/cristiano.webp", "value": 31 },
      "b": { "id": "messi", "name": "Messi", "teamCode": "ar", "teamName": "Argentina", "image": "/messi.webp", "value": 27 }
    },
    {
      "id": "poblacion-vinicius-neymar", "question": "¿Quién nació en una ciudad con más habitantes?", "metricLabel": "habitantes · censo 2022", "format": "compact",
      "a": { "id": "vinicius", "name": "Vinícius", "teamCode": "br", "teamName": "Brasil", "image": "/vinicius.webp", "value": 896744 },
      "b": { "id": "neymar", "name": "Neymar", "teamCode": "br", "teamName": "Brasil", "image": "/neymar.webp", "value": 449955 }
    },
    {
      "id": "distancia-capital-haaland-messi", "question": "¿Quién nació a más kilómetros de la capital de su selección?", "metricLabel": "km en línea recta", "format": "int",
      "a": { "id": "haaland", "name": "Haaland", "teamCode": "no", "teamName": "Noruega", "image": "/halland.webp", "value": 1008 },
      "b": { "id": "messi", "name": "Messi", "teamCode": "ar", "teamName": "Argentina", "image": "/messi.webp", "value": 281 }
    },
    {
      "id": "hermanos-messi-mbappe", "question": "¿Quién tiene más hermanos?", "metricLabel": "hermanos", "format": "int",
      "a": { "id": "messi", "name": "Messi", "teamCode": "ar", "teamName": "Argentina", "image": "/messi.webp", "value": 3 },
      "b": { "id": "mbappe", "name": "Mbappé", "teamCode": "fr", "teamName": "Francia", "image": "/mbappe.webp", "value": 2 }
    },
    {
      "id": "primer-mundial-mbappe-messi", "question": "¿Quién marcó más goles en su primer Mundial?", "metricLabel": "goles en su debut mundialista", "format": "int",
      "a": { "id": "mbappe", "name": "Mbappé", "teamCode": "fr", "teamName": "Francia", "image": "/mbappe.webp", "value": 4 },
      "b": { "id": "messi", "name": "Messi", "teamCode": "ar", "teamName": "Argentina", "image": "/messi.webp", "value": 1 }
    },
    {
      "id": "edad-debut-messi-mbappe", "question": "¿Quién tenía más edad cuando debutó como profesional?", "metricLabel": "al debutar", "format": "age",
      "a": { "id": "messi", "name": "Messi", "teamCode": "ar", "teamName": "Argentina", "image": "/messi.webp", "value": 17.3123287671 },
      "b": { "id": "mbappe", "name": "Mbappé", "teamCode": "fr", "teamName": "Francia", "image": "/mbappe.webp", "value": 16.9506849315 }
    },
    {
      "id": "ecuador-messi-vinicius", "question": "¿Quién nació a más kilómetros del ecuador?", "metricLabel": "km hasta el ecuador", "format": "int",
      "a": { "id": "messi", "name": "Messi", "teamCode": "ar", "teamName": "Argentina", "image": "/messi.webp", "value": 3665 },
      "b": { "id": "vinicius", "name": "Vinícius", "teamCode": "br", "teamName": "Brasil", "image": "/vinicius.webp", "value": 2538 }
    },
    {
      "id": "husos-mbappe-messi", "question": "¿El país de quién tiene más husos horarios?", "metricLabel": "husos · contando ultramar", "format": "int",
      "a": { "id": "mbappe", "name": "Mbappé", "teamCode": "fr", "teamName": "Francia", "image": "/mbappe.webp", "value": 12 },
      "b": { "id": "messi", "name": "Messi", "teamCode": "ar", "teamName": "Argentina", "image": "/messi.webp", "value": 1 }
    },
    {
      "id": "finales-mundial-mbappe-messi", "question": "¿Quién marcó más goles en finales de un Mundial?", "metricLabel": "goles en finales", "format": "int",
      "a": { "id": "mbappe", "name": "Mbappé", "teamCode": "fr", "teamName": "Francia", "image": "/mbappe.webp", "value": 4 },
      "b": { "id": "messi", "name": "Messi", "teamCode": "ar", "teamName": "Argentina", "image": "/messi.webp", "value": 2 }
    }
  ]
  $duels$::jsonb,
  '[
    { "minScore": 3, "pool": "medios" },
    { "minScore": 6, "pool": "delanteros" },
    { "minScore": 9, "pool": "defensas" },
    { "minScore": 12, "pool": "stars" }
  ]'::jsonb
) on conflict (id) do nothing;

insert into public.quien_da_mas_settings (id, active, active_game_id)
values (true, false, '00000000-0000-0000-0000-0000000000f2'::uuid)
on conflict (id) do nothing;

create or replace function public.quien_da_mas_validate_duels(p_duels jsonb)
returns void language plpgsql stable as $$
declare
  v_duel jsonb;
  v_a jsonb;
  v_b jsonb;
  v_a_value numeric;
  v_b_value numeric;
begin
  if jsonb_typeof(p_duels) is distinct from 'array'
    or jsonb_array_length(p_duels) <> 12 then
    raise exception 'Los duelos de Quién da más deben ser 12';
  end if;

  for v_duel in select duel_row.value from jsonb_array_elements(p_duels) as duel_row(value) loop
    v_a := v_duel->'a';
    v_b := v_duel->'b';
    if jsonb_typeof(v_duel) is distinct from 'object'
      or jsonb_typeof(v_duel->'id') is distinct from 'string'
      or jsonb_typeof(v_duel->'question') is distinct from 'string'
      or jsonb_typeof(v_duel->'metricLabel') is distinct from 'string'
      or jsonb_typeof(v_a) is distinct from 'object'
      or jsonb_typeof(v_b) is distinct from 'object'
      or jsonb_typeof(v_a->'id') is distinct from 'string'
      or jsonb_typeof(v_a->'name') is distinct from 'string'
      or jsonb_typeof(v_a->'value') is distinct from 'number'
      or jsonb_typeof(v_b->'id') is distinct from 'string'
      or jsonb_typeof(v_b->'name') is distinct from 'string'
      or jsonb_typeof(v_b->'value') is distinct from 'number'
      or coalesce(v_duel->>'format', 'int') not in ('age', 'compact', 'currency', 'height', 'int') then
      raise exception 'Duelo de Quién da más inválido';
    end if;
    v_a_value := (v_a->>'value')::numeric;
    v_b_value := (v_b->>'value')::numeric;
    if v_a_value = v_b_value then
      raise exception 'Los duelos de Quién da más no pueden empatar';
    end if;
  end loop;
end;
$$;

create or replace function public.quien_da_mas_validate_rewards(p_rewards jsonb)
returns void language plpgsql stable as $$
declare
  v_reward jsonb;
  v_score integer;
  v_pool text;
  v_previous integer := 0;
begin
  if jsonb_typeof(p_rewards) is distinct from 'array'
    or jsonb_array_length(p_rewards) < 1
    or jsonb_array_length(p_rewards) > 4 then
    raise exception 'Premios de Quién da más inválidos';
  end if;
  for v_reward in select reward_row.value from jsonb_array_elements(p_rewards) as reward_row(value) loop
    if jsonb_typeof(v_reward) is distinct from 'object'
      or jsonb_typeof(v_reward->'minScore') is distinct from 'number'
      or jsonb_typeof(v_reward->'pool') is distinct from 'string' then
      raise exception 'Premio de Quién da más inválido';
    end if;
    v_score := (v_reward->>'minScore')::integer;
    v_pool := v_reward->>'pool';
    if v_score <= v_previous or v_score > 12
      or v_pool not in ('defensas', 'medios', 'delanteros', 'stars') then
      raise exception 'Premio de Quién da más fuera de rango';
    end if;
    v_previous := v_score;
  end loop;
end;
$$;

create or replace function public.quien_da_mas_public_rewards(p_rewards jsonb)
returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'minScore', (reward_row.item->>'minScore')::integer,
    'pool', reward_row.item->>'pool',
    'title', case reward_row.item->>'pool'
      when 'medios' then 'Sobre Medios'
      when 'delanteros' then 'Sobre Delanteros'
      when 'defensas' then 'Sobre Defensas'
      when 'stars' then 'Sobre Estrellas'
      else public.sobera_pack_label(reward_row.item->>'pool')
    end
  ) order by (reward_row.item->>'minScore')::integer), '[]'::jsonb)
  from jsonb_array_elements(p_rewards) as reward_row(item);
$$;

create or replace function public.quien_da_mas_status()
returns table (
  active boolean, completed boolean, game_id uuid, title text, duel_time_ms integer,
  duels jsonb, rewards jsonb, score integer, awarded_drop_ids text[], completed_at timestamptz
) language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare v_uid uuid := auth.uid();
begin
  return query
  select settings.active, attempt.user_id is not null, game.id, game.title, game.duel_time_ms,
    game.duels, public.quien_da_mas_public_rewards(game.rewards), attempt.score,
    coalesce(attempt.awarded_drop_ids, '{}'::text[]), attempt.completed_at
  from public.quien_da_mas_settings as settings
  join public.quien_da_mas_games as game on game.id = settings.active_game_id
  left join public.quien_da_mas_attempts as attempt
    on attempt.game_id = game.id and attempt.user_id = v_uid
  where settings.id = true;
end;
$$;

create or replace function public.admin_quien_da_mas_status()
returns table (active boolean, active_game_id uuid, active_game_title text, total_attempts bigint, updated_at timestamptz)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.is_admin() then raise exception 'Solo el administrador puede ver Quién da más'; end if;
  return query
  select settings.active, settings.active_game_id, game.title,
    (select count(*) from public.quien_da_mas_attempts as attempt where attempt.game_id = settings.active_game_id),
    settings.updated_at
  from public.quien_da_mas_settings as settings
  left join public.quien_da_mas_games as game on game.id = settings.active_game_id
  where settings.id = true;
end;
$$;

create or replace function public.admin_set_quien_da_mas_active(p_active boolean, p_game_id uuid default null)
returns table (active boolean, active_game_id uuid, active_game_title text, total_attempts bigint, updated_at timestamptz)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare v_game_id uuid;
begin
  if not public.is_admin() then raise exception 'Solo el administrador puede activar Quién da más'; end if;
  select coalesce(
    p_game_id,
    (select settings.active_game_id from public.quien_da_mas_settings as settings where settings.id = true),
    (select game.id from public.quien_da_mas_games as game order by game.created_at asc limit 1)
  ) into v_game_id;
  if coalesce(p_active, false) and v_game_id is null then raise exception 'No hay juego de Quién da más para activar'; end if;
  if v_game_id is not null and not exists (select 1 from public.quien_da_mas_games as game where game.id = v_game_id) then raise exception 'Juego de Quién da más no encontrado'; end if;
  update public.quien_da_mas_settings as settings
  set active = coalesce(p_active, false), active_game_id = coalesce(v_game_id, settings.active_game_id), updated_by = auth.uid(), updated_at = now()
  where settings.id = true;
  return query select * from public.admin_quien_da_mas_status();
end;
$$;

create or replace function public.complete_quien_da_mas(p_game_id uuid, p_picks jsonb)
returns table (game_id uuid, score integer, awarded_drop_ids text[])
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_game public.quien_da_mas_games%rowtype;
  v_duel jsonb;
  v_index integer;
  v_entry jsonb;
  v_pick text;
  v_correct integer := 0;
  v_reward jsonb;
  v_reward_index integer;
  v_threshold integer;
  v_pool text;
  v_drop_id text;
  v_player_ids text[];
  v_seen text[];
  v_awards text[] := '{}'::text[];
  v_inserted boolean := false;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  select game.* into v_game
  from public.quien_da_mas_settings as settings
  join public.quien_da_mas_games as game on game.id = settings.active_game_id
  where settings.id = true and settings.active is true and game.id = p_game_id;
  if not found then raise exception 'Quién da más no está activo'; end if;
  perform public.quien_da_mas_validate_duels(v_game.duels);
  perform public.quien_da_mas_validate_rewards(v_game.rewards);
  if jsonb_typeof(p_picks) is distinct from 'array'
    or jsonb_array_length(p_picks) <> jsonb_array_length(v_game.duels) then
    raise exception 'Las respuestas no son válidas';
  end if;

  for v_duel, v_index in
    select duel_row.value, duel_row.ordinality::integer
    from jsonb_array_elements(v_game.duels) with ordinality as duel_row(value, ordinality)
  loop
    v_entry := p_picks -> (v_index - 1);
    if jsonb_typeof(v_entry) = 'null' then
      continue;
    end if;
    v_pick := p_picks ->> (v_index - 1);
    if jsonb_typeof(v_entry) is distinct from 'string' or v_pick not in ('a', 'b') then
      raise exception 'Las respuestas no son válidas';
    end if;
    if (v_pick = 'a' and (v_duel->'a'->>'value')::numeric > (v_duel->'b'->>'value')::numeric)
      or (v_pick = 'b' and (v_duel->'b'->>'value')::numeric > (v_duel->'a'->>'value')::numeric) then
      v_correct := v_correct + 1;
    end if;
  end loop;

  insert into public.quien_da_mas_attempts as attempt (game_id, user_id, picks, score)
  values (v_game.id, v_uid, p_picks, v_correct)
  on conflict (game_id, user_id) do nothing
  returning true into v_inserted;
  if not coalesce(v_inserted, false) then
    return query
    select attempt.game_id, attempt.score, attempt.awarded_drop_ids
    from public.quien_da_mas_attempts as attempt
    where attempt.game_id = v_game.id and attempt.user_id = v_uid;
    return;
  end if;

  v_seen := public.card_user_seen_player_ids(v_uid);
  for v_reward, v_reward_index in
    select reward_row.value, reward_row.ordinality::integer
    from jsonb_array_elements(v_game.rewards) with ordinality as reward_row(value, ordinality)
  loop
    v_threshold := (v_reward->>'minScore')::integer;
    if v_correct < v_threshold then continue; end if;
    v_pool := v_reward->>'pool';
    v_drop_id := 'special-quiendamas-' || v_pool || '-' || gen_random_uuid()::text;
    v_player_ids := public.sobera_pick_reward_player_ids(
      v_pool,
      'quiendamas:' || v_game.id::text || ':' || v_uid::text || ':' || v_reward_index::text,
      v_seen
    );
    if coalesce(array_length(v_player_ids, 1), 0) <> 1 then
      raise exception 'No hay jugadores suficientes para el premio';
    end if;
    insert into public.card_drops as drop_row (id, kind, label, player_ids, available_at, created_by)
    values (v_drop_id, 'special', public.sobera_pack_label(v_pool), v_player_ids, now(), v_uid)
    on conflict (id) do nothing;
    v_seen := v_seen || v_player_ids;
    v_awards := array_append(v_awards, v_drop_id);
  end loop;
  update public.quien_da_mas_attempts as attempt
  set awarded_drop_ids = v_awards
  where attempt.game_id = v_game.id and attempt.user_id = v_uid;
  return query select v_game.id, v_correct, v_awards;
end;
$$;

create or replace function public.admin_quien_da_mas_attempts(p_game_id uuid default null)
returns table (
  game_id uuid, game_title text, user_id uuid, display_name text,
  score integer, awarded_drop_ids text[], completed_at timestamptz
)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.is_admin() then raise exception 'Solo el administrador puede ver los intentos de Quién da más'; end if;
  return query
  select attempt.game_id, game.title, attempt.user_id, coalesce(profile.display_name, 'Usuario'),
    attempt.score, attempt.awarded_drop_ids, attempt.completed_at
  from public.quien_da_mas_attempts as attempt
  join public.quien_da_mas_games as game on game.id = attempt.game_id
  left join public.profiles as profile on profile.id = attempt.user_id
  where p_game_id is null or attempt.game_id = p_game_id
  order by attempt.completed_at desc
  limit 200;
end;
$$;

-- Los sobres de Quién da más siguen siendo privados incluso para el admin.
drop policy if exists "available card drops read" on public.card_drops;
create policy "available card drops read" on public.card_drops for select using (
  (available_at <= now() or public.is_admin())
  and (kind <> 'forge' or created_by = auth.uid())
  and (created_by is null or created_by = auth.uid() or (
    id like 'special-%'
    and id not like 'special-sobera-%' and id not like 'special-ruleta-%'
    and id not like 'special-oak-%' and id not like 'special-hoguera-%'
    and id not like 'special-portero-%' and id not like 'special-suarez-%'
    and id not like 'special-ronaldao-%' and id not like 'special-mourinho-%'
    and id not like 'special-rasca-%' and id not like 'special-admin-%'
    and id not like 'special-sanfermin-%' and id not like 'special-quiendamas-%'
  ))
);

create or replace function public.open_card_drop(p_drop_id text)
returns table (card_id uuid, drop_id text, card_index integer, player_id text, used_at timestamptz, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare v_uid uuid := auth.uid(); v_drop public.card_drops%rowtype; v_pool text; v_seen text[]; v_player_ids text[];
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  select drop_row.* into v_drop from public.card_drops as drop_row where drop_row.id = p_drop_id and drop_row.available_at <= now();
  if not found or v_drop.kind = 'forge' then raise exception 'Sobre no disponible'; end if;
  if (v_drop.id like 'special-sobera-%' or v_drop.id like 'special-ruleta-%' or v_drop.id like 'special-oak-%' or v_drop.id like 'special-hoguera-%' or v_drop.id like 'special-portero-%' or v_drop.id like 'special-suarez-%' or v_drop.id like 'special-ronaldao-%' or v_drop.id like 'special-mourinho-%' or v_drop.id like 'special-rasca-%' or v_drop.id like 'special-admin-%' or v_drop.id like 'special-sanfermin-%' or v_drop.id like 'special-quiendamas-%' or (v_drop.created_by is not null and v_drop.id not like 'special-%')) and v_drop.created_by is distinct from v_uid then raise exception 'Sobre no disponible'; end if;
  v_player_ids := v_drop.player_ids;
  if not exists (select 1 from public.user_cards as user_card where user_card.user_id = v_uid and user_card.drop_id = v_drop.id) then
    v_pool := coalesce(public.card_pool_from_pack_label(v_drop.label), case when v_drop.id like 'special-%' then 'diario' else null end);
    if v_pool is not null and ((v_drop.id like 'special-%' and v_drop.created_by is distinct from v_uid) or public.card_player_ids_need_playoff_reroll(v_drop.player_ids)) then
      v_seen := public.card_user_seen_player_ids(v_uid);
      if v_pool = 'diario' then v_player_ids := public.daily_pack_player_ids_avoiding('drop:' || v_drop.id || ':' || v_uid::text, v_seen);
      else v_player_ids := public.sobera_pick_reward_player_ids(v_pool, 'drop:' || v_drop.id || ':' || v_uid::text, v_seen); end if;
      if coalesce(array_length(v_player_ids, 1), 0) = 0 then v_player_ids := v_drop.player_ids; end if;
    end if;
  end if;
  insert into public.user_cards (user_id, drop_id, card_index, player_id)
  select v_uid, v_drop.id, picked_cards.ordinality::integer, picked_cards.player_id
  from unnest(v_player_ids) with ordinality as picked_cards(player_id, ordinality)
  where picked_cards.player_id is not null on conflict (user_id, drop_id, card_index) do nothing;
  return query select user_card.id, user_card.drop_id, user_card.card_index, user_card.player_id, user_card.used_at, user_card.created_at
  from public.user_cards as user_card where user_card.user_id = v_uid and user_card.drop_id = v_drop.id order by user_card.card_index;
end;
$$;

revoke all on function public.quien_da_mas_validate_duels(jsonb) from public;
revoke all on function public.quien_da_mas_validate_rewards(jsonb) from public;
revoke all on function public.quien_da_mas_public_rewards(jsonb) from public;
revoke all on function public.quien_da_mas_status() from public;
revoke all on function public.admin_quien_da_mas_status() from public;
revoke all on function public.admin_set_quien_da_mas_active(boolean, uuid) from public;
revoke all on function public.complete_quien_da_mas(uuid, jsonb) from public;
revoke all on function public.admin_quien_da_mas_attempts(uuid) from public;
revoke all on function public.open_card_drop(text) from public;
grant execute on function public.quien_da_mas_status(), public.admin_quien_da_mas_status(), public.admin_set_quien_da_mas_active(boolean, uuid), public.complete_quien_da_mas(uuid, jsonb), public.admin_quien_da_mas_attempts(uuid), public.open_card_drop(text) to authenticated;
