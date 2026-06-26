-- Sobre Barcelona: jugadores del FC Barcelona convocados al Mundial 2026.
-- La lista se siembra como pool curado y se registra en las RPCs que tienen
-- listas cerradas de sobres tematicos.

insert into public.card_pool_players (pool, player_id)
select v.pool, v.player_id from (values
  ('barcelona', 'esp-19'), -- Lamine Yamal
  ('barcelona', 'esp-04'), -- Eric Garcia
  ('barcelona', 'esp-20'), -- Pedri
  ('barcelona', 'esp-09'), -- Gavi
  ('barcelona', 'esp-22'), -- Pau Cubarsi
  ('barcelona', 'esp-10'), -- Dani Olmo
  ('barcelona', 'esp-07'), -- Ferran Torres
  ('barcelona', 'esp-13'), -- Joan Garcia
  ('barcelona', 'bra-11'), -- Raphinha
  ('barcelona', 'fra-05'), -- Jules Kounde
  ('barcelona', 'ned-21'), -- Frenkie de Jong
  ('barcelona', 'uru-04'), -- Ronald Araujo
  ('barcelona', 'por-20'), -- Joao Cancelo
  ('barcelona', 'egy-09'), -- Hamza Abdelkarim
  ('barcelona', 'eng-18'), -- Anthony Gordon
  ('barcelona', 'eng-11')  -- Marcus Rashford
) as v(pool, player_id)
where exists (select 1 from public.players p where p.id = v.player_id)
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
      'defensas',
      'medios',
      'delanteros'
    ) then
      raise exception 'Sobre de premio no valido';
    end if;
  end loop;
end;
$$;

create or replace function public.sobera_pick_reward_player_ids(
  p_pool text,
  p_seed text
)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_exclude text[] := '{}'::text[];
begin
  if v_uid is not null then
    v_exclude := public.card_user_seen_player_ids(v_uid);
  end if;
  return public.sobera_pick_reward_player_ids(p_pool, p_seed, v_exclude);
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
  v_exclude text[] := coalesce(array_remove(p_exclude, null), '{}'::text[]);
  v_pid text;
  v_ids text[];
begin
  if p_pool in ('defensas', 'medios', 'delanteros') then
    v_ids := public.card_pool_pick_many(p_pool, p_seed, 1, v_exclude);
    if coalesce(array_length(v_ids, 1), 0) = 0 then
      v_ids := public.card_pool_pick_many(p_pool, p_seed, 1);
    end if;
    return coalesce(v_ids, '{}'::text[]);
  end if;

  if p_pool in ('stars', 'madrid', 'barcelona', 'sub21', 'francia', 'premier') then
    v_pid := coalesce(
      public.card_pool_pick(p_pool, p_seed, v_exclude),
      public.card_pool_pick(p_pool, p_seed),
      public.card_any_pick(p_seed, v_exclude),
      public.card_any_pick(p_seed)
    );
    if v_pid is null then
      return '{}'::text[];
    end if;
    return array[v_pid];
  end if;

  raise exception 'Sobre de premio no valido';
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
        'defensas', 'medios', 'delanteros',
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
      'defensas', 'medios', 'delanteros',
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
      'defensas', 'medios', 'delanteros',
      'stars', 'madrid', 'barcelona', 'sub21', 'francia', 'premier'
    ) then
      raise exception 'Sobre de premio no valido';
    end if;
  end loop;
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
    else 'Sobre especial'
  end;
  v_player_ids text[];
  v_seen text[];
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  if p_pool in ('defensas', 'medios', 'delanteros') then
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

  if p_pool in ('defensas', 'medios', 'delanteros') then
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
    when p_label ilike '%Defensas%' then 'defensas'
    when p_label ilike '%Mediocentros%' then 'medios'
    when p_label ilike '%Delanteros%' then 'delanteros'
    else null
  end;
$$;

revoke all on function public.sobera_pack_label(text) from public;
revoke all on function public.sobera_quiz_validate_rewards(jsonb) from public;
revoke all on function public.sobera_pick_reward_player_ids(text, text) from public;
revoke all on function public.sobera_pick_reward_player_ids(text, text, text[]) from public;
revoke all on function public.ruleta_validate_segments(jsonb) from public;
revoke all on function public.hoguera_validate_rewards(jsonb) from public;
revoke all on function public.suarez_dentist_validate_rewards(jsonb) from public;
revoke all on function public.open_themed_card_pack(text, date) from public;
revoke all on function public.admin_create_card_drop(text, text) from public;
revoke all on function public.card_pool_from_pack_label(text) from public;

grant execute on function public.open_themed_card_pack(text, date) to authenticated;
grant execute on function public.admin_create_card_drop(text, text) to authenticated;
