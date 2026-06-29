-- Sobre Porteros: pool curado de porteros titulares vivos en playoffs.
-- Los pickers existentes ya filtran por card_alive_playoff_team_ids(), asi que
-- basta con poblar el pool titular y aceptarlo en labels/validaciones.

delete from public.card_pool_players
where pool = 'porteros';

insert into public.card_pool_players (pool, player_id)
select 'porteros', v.player_id
from (
  values
    ('ger-01'), -- Neuer
    ('alg-01'), -- Mastil
    ('arg-23'), -- E. Martinez
    ('aus-01'), -- Ryan
    ('aut-13'), -- Pentz
    ('bel-01'), -- Courtois
    ('bih-01'), -- Vasilj
    ('bra-01'), -- A. Becker
    ('cpv-01'), -- Vozinha
    ('can-16'), -- Crepeau
    ('col-12'), -- C. Vargas
    ('civ-01'), -- Y. Fofana
    ('cro-01'), -- Livakovic
    ('ecu-01'), -- Galindez
    ('egy-01'), -- M. Elshenawy
    ('esp-23'), -- Unai Simon
    ('usa-01'), -- Turner
    ('fra-16'), -- Maignan
    ('gha-01'), -- Zigi
    ('eng-01'), -- Pickford
    ('jpn-01'), -- Suzuki
    ('mar-01'), -- Bono
    ('mex-13'), -- G. Ochoa
    ('nor-01'), -- Nyland
    ('ned-01'), -- Verbruggen
    ('par-01'), -- Fernandez
    ('por-01'), -- Diogo Costa
    ('cod-01'), -- Mpasi
    ('sen-16'), -- Mendy
    ('swe-12'), -- V. Johansson
    ('sui-01') -- Kobel
) as v(player_id)
where exists (
  select 1
  from public.players p
  where p.id = v.player_id
    and p.position = 'POR'
    and p.squad_status <> 'withdrawn'
)
on conflict (pool, player_id) do nothing;

create or replace function public.sobera_pack_label(p_pool text)
returns text
language sql
stable
as $$
  select case p_pool
    when 'stars' then 'Sobre Estrellas'
    when 'madrid' then 'Sobre Madrid'
    when 'barcelona' then 'Sobre Barcelona'
    when 'sub21' then 'Sobre Promesas'
    when 'francia' then 'Sobre Francia'
    when 'premier' then 'Sobre Premier'
    when 'porteros' then 'Sobre Porteros'
    when 'defensas' then 'Sobre Defensas'
    when 'medios' then 'Sobre Mediocentros'
    when 'delanteros' then 'Sobre Delanteros'
    else 'Sobre especial'
  end;
$$;

create or replace function public.sobera_quiz_validate_rewards(p_rewards jsonb)
returns void
language plpgsql
stable
as $$
declare
  v_reward jsonb;
  v_min_score integer;
  v_pool text;
begin
  if jsonb_typeof(p_rewards) is distinct from 'array' then
    raise exception 'Premios invalidos';
  end if;
  if jsonb_array_length(p_rewards) < 1
    or jsonb_array_length(p_rewards) > 6
  then
    raise exception 'Premios invalidos';
  end if;

  for v_reward in
    select value from jsonb_array_elements(p_rewards)
  loop
    if jsonb_typeof(v_reward) is distinct from 'object'
      or jsonb_typeof(v_reward->'minScore') is distinct from 'number'
      or jsonb_typeof(v_reward->'pool') is distinct from 'string'
    then
      raise exception 'Premio invalido';
    end if;

    v_min_score := (v_reward->>'minScore')::integer;
    v_pool := v_reward->>'pool';

    if v_min_score < 1 or v_min_score > 4 then
      raise exception 'Aciertos de premio fuera de rango';
    end if;
    if v_pool not in (
      'stars',
      'madrid',
      'barcelona',
      'sub21',
      'francia',
      'premier',
      'porteros',
      'defensas',
      'medios',
      'delanteros'
    ) then
      raise exception 'Sobre de premio no valido';
    end if;
  end loop;
end;
$$;

create or replace function public.oak_quiz_validate_rewards(p_rewards jsonb)
returns void
language plpgsql
stable
as $$
declare
  v_reward jsonb;
  v_min_score integer;
  v_pool text;
begin
  if jsonb_typeof(p_rewards) is distinct from 'array' then
    raise exception 'Premios invalidos';
  end if;
  if jsonb_array_length(p_rewards) < 1 or jsonb_array_length(p_rewards) > 6 then
    raise exception 'Premios invalidos';
  end if;

  for v_reward in
    select value from jsonb_array_elements(p_rewards)
  loop
    if jsonb_typeof(v_reward) is distinct from 'object'
      or jsonb_typeof(v_reward->'minScore') is distinct from 'number'
      or jsonb_typeof(v_reward->'pool') is distinct from 'string'
    then
      raise exception 'Premio invalido';
    end if;

    v_min_score := (v_reward->>'minScore')::integer;
    v_pool := v_reward->>'pool';

    if v_min_score < 1 or v_min_score > 4 then
      raise exception 'Aciertos de premio fuera de rango';
    end if;
    if v_pool not in (
      'defensas',
      'medios',
      'delanteros',
      'porteros',
      'stars',
      'madrid',
      'barcelona',
      'sub21',
      'francia',
      'premier'
    ) then
      raise exception 'Sobre de premio no valido';
    end if;
  end loop;
end;
$$;

create or replace function public.ruleta_validate_segments(p_segments jsonb)
returns void
language plpgsql
stable
as $$
declare
  v_item jsonb;
  v_pool text;
  v_count integer;
begin
  if jsonb_typeof(p_segments) is distinct from 'array' then
    raise exception 'La ruleta debe tener casillas';
  end if;

  v_count := jsonb_array_length(p_segments);
  if v_count < 2 or v_count > 12 then
    raise exception 'La ruleta debe tener entre 2 y 12 casillas';
  end if;

  for v_item in
    select value from jsonb_array_elements(p_segments)
  loop
    if jsonb_typeof(v_item) is distinct from 'object' then
      raise exception 'Casilla invalida';
    end if;
    if jsonb_typeof(v_item->'pool') not in ('string', 'null') then
      raise exception 'Casilla invalida';
    end if;
    if jsonb_typeof(v_item->'pool') = 'string' then
      v_pool := v_item->>'pool';
      if v_pool not in (
        'defensas', 'medios', 'delanteros', 'porteros',
        'stars', 'madrid', 'barcelona', 'sub21', 'francia', 'premier',
        'diario'
      ) then
        raise exception 'Sobre de casilla no valido';
      end if;
    end if;
  end loop;
end;
$$;

create or replace function public.hoguera_validate_rewards(p_rewards jsonb)
returns void
language plpgsql
stable
as $$
declare
  v_reward jsonb;
  v_meters integer;
  v_pool text;
begin
  if jsonb_typeof(p_rewards) is distinct from 'array' then
    raise exception 'Premios invalidos';
  end if;
  if jsonb_array_length(p_rewards) < 1 or jsonb_array_length(p_rewards) > 6 then
    raise exception 'Premios invalidos';
  end if;

  for v_reward in
    select value from jsonb_array_elements(p_rewards)
  loop
    if jsonb_typeof(v_reward) is distinct from 'object'
      or jsonb_typeof(v_reward->'meters') is distinct from 'number'
      or jsonb_typeof(v_reward->'pool') is distinct from 'string'
    then
      raise exception 'Premio invalido';
    end if;

    v_meters := (v_reward->>'meters')::integer;
    v_pool := v_reward->>'pool';

    if v_meters < 1 or v_meters > 1000 then
      raise exception 'Metros de premio fuera de rango';
    end if;
    if v_pool not in (
      'defensas', 'medios', 'delanteros', 'porteros',
      'stars', 'madrid', 'barcelona', 'sub21', 'francia', 'premier'
    ) then
      raise exception 'Sobre de premio no valido';
    end if;
  end loop;
end;
$$;

create or replace function public.suarez_dentist_validate_rewards(p_rewards jsonb)
returns void
language plpgsql
stable
as $$
declare
  v_reward jsonb;
  v_pool text;
begin
  if jsonb_typeof(p_rewards) is distinct from 'array' then
    raise exception 'Premios invalidos';
  end if;
  if jsonb_array_length(p_rewards) < 1 or jsonb_array_length(p_rewards) > 4 then
    raise exception 'Premios invalidos';
  end if;

  for v_reward in
    select value from jsonb_array_elements(p_rewards)
  loop
    if jsonb_typeof(v_reward) is distinct from 'object'
      or jsonb_typeof(v_reward->'pool') is distinct from 'string'
    then
      raise exception 'Premio invalido';
    end if;

    v_pool := v_reward->>'pool';

    if v_pool not in (
      'defensas', 'medios', 'delanteros', 'porteros',
      'stars', 'madrid', 'barcelona', 'sub21', 'francia', 'premier'
    ) then
      raise exception 'Sobre de premio no valido';
    end if;
  end loop;
end;
$$;

create or replace function public.sobera_pick_reward_player_ids(
  p_pool text,
  p_seed text,
  p_exclude text[]
)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alive text[] := public.card_alive_playoff_team_ids();
  v_exclude text[] := coalesce(array_remove(p_exclude, null), '{}'::text[]);
  v_pid text;
  v_ids text[];
begin
  if p_pool in ('porteros', 'defensas', 'medios', 'delanteros') then
    v_ids := public.card_pool_pick_many_with_alive(p_pool, p_seed, 1, v_exclude, v_alive);
    if coalesce(array_length(v_ids, 1), 0) = 0 then
      v_ids := public.card_pool_pick_many_with_alive(p_pool, p_seed, 1, '{}'::text[], v_alive);
    end if;
    return coalesce(v_ids, '{}'::text[]);
  end if;

  if p_pool in ('stars', 'madrid', 'barcelona', 'sub21', 'francia', 'premier') then
    v_pid := coalesce(
      public.card_pool_pick_with_alive(p_pool, p_seed, v_exclude, v_alive),
      public.card_pool_pick_with_alive(p_pool, p_seed, '{}'::text[], v_alive),
      public.card_any_pick_with_alive(p_seed, v_exclude, v_alive),
      public.card_any_pick_with_alive(p_seed, '{}'::text[], v_alive)
    );
    if v_pid is null then
      return '{}'::text[];
    end if;
    return array[v_pid];
  end if;

  raise exception 'Sobre de premio no valido';
end;
$$;

create or replace function public.open_themed_card_pack(
  p_pool text,
  p_day date default current_date
)
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
  v_day date := coalesce(p_day, current_date);
  v_day_key text := to_char(v_day, 'YYYY-MM-DD');
  v_drop_id text;
  v_label text := case p_pool
    when 'stars' then 'Sobre Estrellas'
    when 'madrid' then 'Sobre Madrid'
    when 'barcelona' then 'Sobre Barcelona'
    when 'sub21' then 'Sobre Promesas'
    when 'francia' then 'Sobre Francia'
    when 'premier' then 'Sobre Premier'
    when 'porteros' then 'Sobre Porteros'
    else 'Sobre especial'
  end;
  v_player_ids text[];
  v_seen text[];
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  if p_pool in ('porteros', 'defensas', 'medios', 'delanteros') then
    raise exception 'Los sobres por puesto solo se abren como drops';
  end if;

  if p_pool not in ('stars', 'madrid', 'barcelona', 'sub21', 'francia', 'premier') then
    raise exception 'Pool no valido';
  end if;

  v_drop_id := p_pool || '-' || v_day_key || '-' || v_uid::text;
  v_seen := public.card_user_seen_player_ids(v_uid);
  v_player_ids := public.sobera_pick_reward_player_ids(
    p_pool,
    'themed:' || v_drop_id,
    v_seen
  );

  if coalesce(array_length(v_player_ids, 1), 0) = 0 then
    raise exception 'No hay jugadores disponibles para el sobre';
  end if;

  insert into public.card_drops as d (id, kind, label, player_ids, available_at, created_by)
  values (v_drop_id, 'special', v_label, v_player_ids, v_day::timestamptz, v_uid)
  on conflict (id) do update
  set player_ids = excluded.player_ids
  where not exists (
    select 1 from public.user_cards uc where uc.drop_id = d.id
  );

  return query
  select * from public.open_card_drop(v_drop_id);
end;
$$;

create or replace function public.admin_create_card_drop(
  p_label text default null,
  p_pool text default null
)
returns table (
  id text,
  kind text,
  label text,
  player_ids text[],
  available_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_drop_id text := 'special-' || gen_random_uuid()::text;
  v_label text := coalesce(nullif(trim(p_label), ''), 'Drop especial');
  v_player_ids text[];
  v_pid text;
begin
  if not public.is_admin() then
    raise exception 'Solo el admin puede soltar drops especiales';
  end if;

  if p_pool in ('porteros', 'defensas', 'medios', 'delanteros') then
    v_player_ids := public.card_pool_pick_many(p_pool, 'special:' || v_drop_id, 1);
  elsif p_pool in ('stars', 'madrid', 'barcelona', 'sub21', 'francia', 'premier') then
    v_pid := coalesce(
      public.card_pool_pick(p_pool, 'special:' || v_drop_id),
      public.card_any_pick('special:' || v_drop_id)
    );
    v_player_ids := array[v_pid];
  else
    v_player_ids := public.daily_pack_player_ids('special:' || v_drop_id);
  end if;

  if coalesce(array_length(v_player_ids, 1), 0) = 0 then
    raise exception 'No hay jugadores disponibles para el sobre';
  end if;

  insert into public.card_drops (id, kind, label, player_ids, created_by)
  values (v_drop_id, 'special', v_label, v_player_ids, v_uid);

  return query
  select d.id, d.kind, d.label, d.player_ids, d.available_at, d.created_at
  from public.card_drops d
  where d.id = v_drop_id;
end;
$$;

create or replace function public.card_pool_from_pack_label(p_label text)
returns text
language sql
stable
as $$
  select case
    when p_label ilike '%diario%' then 'diario'
    when p_label ilike '%Estrellas%' then 'stars'
    when p_label ilike '%Madrid%' then 'madrid'
    when p_label ilike '%Barcelona%' then 'barcelona'
    when p_label ilike '%Promesas%' then 'sub21'
    when p_label ilike '%Francia%' then 'francia'
    when p_label ilike '%Premier%' then 'premier'
    when p_label ilike '%Porteros%' then 'porteros'
    when p_label ilike '%Defensas%' then 'defensas'
    when p_label ilike '%Mediocentros%' then 'medios'
    when p_label ilike '%Delanteros%' then 'delanteros'
    else null
  end;
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
    or v_drop.id like 'special-portero-%'
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
        or public.card_player_ids_need_playoff_reroll(v_drop.player_ids)
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
