-- Reduce repeticiones de cartas por usuario.
-- Cuando hay alternativas en el pool, los sobres nuevos evitan jugadores que el
-- usuario ya tiene o que ya tiene concedidos en sobres pendientes de abrir.

create or replace function public.card_user_seen_player_ids(p_uid uuid)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct seen.player_id), '{}'::text[])
  from (
    select uc.player_id
    from public.user_cards uc
    where uc.user_id = p_uid

    union all

    select unnest(d.player_ids) as player_id
    from public.card_drops d
    where d.created_by = p_uid
  ) seen
  where seen.player_id is not null;
$$;

create or replace function public.daily_pack_player_ids_avoiding(
  p_seed text,
  p_exclude text[] default '{}'::text[]
)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_exclude text[] := coalesce(array_remove(p_exclude, null), '{}'::text[]);
  v_star text;
  v_top text;
  v_random text;
begin
  v_star := coalesce(
    public.card_pool_pick('stars', p_seed || ':star', v_exclude),
    public.card_pool_pick('stars', p_seed || ':star'),
    public.card_any_pick(p_seed || ':star', v_exclude),
    public.card_any_pick(p_seed || ':star')
  );

  v_top := coalesce(
    public.card_pool_pick('top150', p_seed || ':top', array_append(v_exclude, v_star)),
    public.card_pool_pick('top150', p_seed || ':top', array[v_star]),
    public.card_any_pick(p_seed || ':top', array_append(v_exclude, v_star)),
    public.card_any_pick(p_seed || ':top', array[v_star])
  );

  v_random := coalesce(
    public.card_any_pick(p_seed || ':any', array_append(array_append(v_exclude, v_star), v_top)),
    public.card_any_pick(p_seed || ':any', array[v_star, v_top])
  );

  return array[v_random, v_top, v_star];
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

  if p_pool in ('stars', 'madrid', 'sub21', 'francia', 'premier') then
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

create or replace function public.ruleta_pick_player_ids(
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
  return public.ruleta_pick_player_ids(p_pool, p_seed, v_exclude);
end;
$$;

create or replace function public.ruleta_pick_player_ids(
  p_pool text,
  p_seed text,
  p_exclude text[]
)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_pool is null then
    return '{}'::text[];
  end if;
  if p_pool = 'diario' then
    return public.daily_pack_player_ids_avoiding(p_seed, p_exclude);
  end if;
  return public.sobera_pick_reward_player_ids(p_pool, p_seed, p_exclude);
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
    when p_label ilike '%Promesas%' then 'sub21'
    when p_label ilike '%Francia%' then 'francia'
    when p_label ilike '%Premier%' then 'premier'
    when p_label ilike '%Defensas%' then 'defensas'
    when p_label ilike '%Mediocentros%' then 'medios'
    when p_label ilike '%Delanteros%' then 'delanteros'
    else null
  end;
$$;

create or replace function public.open_daily_card_pack(p_day date default current_date)
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
  v_label text := 'Sobre diario ' || to_char(v_day, 'DD/MM/YYYY');
  v_seen text[];
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  v_drop_id := 'daily-' || v_day_key || '-' || v_uid::text;
  v_seen := public.card_user_seen_player_ids(v_uid);

  insert into public.card_drops as d (id, kind, label, player_ids, available_at, created_by)
  values (
    v_drop_id,
    'daily',
    v_label,
    public.daily_pack_player_ids_avoiding('daily:' || v_day_key || ':' || v_uid::text, v_seen),
    v_day::timestamptz,
    v_uid
  )
  on conflict (id) do update
  set player_ids = excluded.player_ids
  where not exists (
    select 1 from public.user_cards uc where uc.drop_id = d.id
  );

  return query
  select * from public.open_card_drop(v_drop_id);
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

  if p_pool not in ('stars', 'madrid', 'sub21', 'francia', 'premier') then
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
    v_pool := public.card_pool_from_pack_label(v_drop.label);
    if v_drop.id like 'special-%'
      and v_drop.created_by is distinct from v_uid
      and v_pool is not null
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

revoke all on function public.card_user_seen_player_ids(uuid) from public;
revoke all on function public.daily_pack_player_ids_avoiding(text, text[]) from public;
revoke all on function public.sobera_pick_reward_player_ids(text, text) from public;
revoke all on function public.sobera_pick_reward_player_ids(text, text, text[]) from public;
revoke all on function public.ruleta_pick_player_ids(text, text) from public;
revoke all on function public.ruleta_pick_player_ids(text, text, text[]) from public;
revoke all on function public.card_pool_from_pack_label(text) from public;
revoke all on function public.open_card_drop(text) from public;
revoke all on function public.open_daily_card_pack(date) from public;
revoke all on function public.open_themed_card_pack(text, date) from public;

grant execute on function public.open_card_drop(text) to authenticated;
grant execute on function public.open_daily_card_pack(date) to authenticated;
grant execute on function public.open_themed_card_pack(text, date) to authenticated;
