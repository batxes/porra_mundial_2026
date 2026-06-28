-- Evita timeouts al abrir sobres antiguos con jugadores ya eliminados.
-- La migracion anterior recalculaba el set de selecciones vivas varias veces
-- durante el reroll de un mismo sobre. Aqui lo calculamos una vez por flujo.

create index if not exists card_drops_created_by_idx
on public.card_drops (created_by)
where created_by is not null;

create or replace function public.card_pool_pick_with_alive(
  p_pool text,
  p_seed text,
  p_exclude text[] default '{}'::text[],
  p_alive_team_ids text[] default '{}'::text[]
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.id
  from public.players p
  join public.card_pool_players cp on cp.player_id = p.id and cp.pool = p_pool
  where p.squad_status <> 'withdrawn'
    and p.id <> all (coalesce(array_remove(p_exclude, null), '{}'::text[]))
    and (
      coalesce(array_length(p_alive_team_ids, 1), 0) = 0
      or p.team_id = any(p_alive_team_ids)
    )
  order by md5(coalesce(p_seed, '') || ':' || p.id)
  limit 1;
$$;

create or replace function public.card_any_pick_with_alive(
  p_seed text,
  p_exclude text[] default '{}'::text[],
  p_alive_team_ids text[] default '{}'::text[]
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.id
  from public.players p
  where p.squad_status <> 'withdrawn'
    and p.id <> all (coalesce(array_remove(p_exclude, null), '{}'::text[]))
    and (
      coalesce(array_length(p_alive_team_ids, 1), 0) = 0
      or p.team_id = any(p_alive_team_ids)
    )
  order by md5(coalesce(p_seed, '') || ':' || p.id)
  limit 1;
$$;

create or replace function public.card_pool_pick_many_with_alive(
  p_pool text,
  p_seed text,
  p_count integer default 3,
  p_exclude text[] default '{}'::text[],
  p_alive_team_ids text[] default '{}'::text[]
)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(picked.id order by picked.sort_key), '{}'::text[])
  from (
    select p.id, md5(coalesce(p_seed, '') || ':' || p.id) as sort_key
    from public.players p
    join public.card_pool_players cp on cp.player_id = p.id and cp.pool = p_pool
    where p.squad_status <> 'withdrawn'
      and p.id <> all (coalesce(array_remove(p_exclude, null), '{}'::text[]))
      and (
        coalesce(array_length(p_alive_team_ids, 1), 0) = 0
        or p.team_id = any(p_alive_team_ids)
      )
    order by sort_key
    limit least(3, greatest(1, coalesce(p_count, 3)))
  ) picked;
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
  select public.card_pool_pick_with_alive(
    p_pool,
    p_seed,
    p_exclude,
    public.card_alive_playoff_team_ids()
  );
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
  select public.card_any_pick_with_alive(
    p_seed,
    p_exclude,
    public.card_alive_playoff_team_ids()
  );
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
  select public.card_pool_pick_many_with_alive(
    p_pool,
    p_seed,
    p_count,
    p_exclude,
    public.card_alive_playoff_team_ids()
  );
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
  v_alive text[] := public.card_alive_playoff_team_ids();
  v_exclude text[] := coalesce(array_remove(p_exclude, null), '{}'::text[]);
  v_star text;
  v_top text;
  v_random text;
begin
  v_star := coalesce(
    public.card_pool_pick_with_alive('stars', p_seed || ':star', v_exclude, v_alive),
    public.card_pool_pick_with_alive('stars', p_seed || ':star', '{}'::text[], v_alive),
    public.card_any_pick_with_alive(p_seed || ':star', v_exclude, v_alive),
    public.card_any_pick_with_alive(p_seed || ':star', '{}'::text[], v_alive)
  );

  v_top := coalesce(
    public.card_pool_pick_with_alive('top150', p_seed || ':top', array_append(v_exclude, v_star), v_alive),
    public.card_pool_pick_with_alive('top150', p_seed || ':top', array[v_star], v_alive),
    public.card_any_pick_with_alive(p_seed || ':top', array_append(v_exclude, v_star), v_alive),
    public.card_any_pick_with_alive(p_seed || ':top', array[v_star], v_alive)
  );

  v_random := coalesce(
    public.card_any_pick_with_alive(p_seed || ':any', array_append(array_append(v_exclude, v_star), v_top), v_alive),
    public.card_any_pick_with_alive(p_seed || ':any', array[v_star, v_top], v_alive)
  );

  return array[v_random, v_top, v_star];
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
  if p_pool in ('defensas', 'medios', 'delanteros') then
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

create or replace function public.card_player_ids_need_playoff_reroll(
  p_player_ids text[]
)
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
    coalesce(array_length(alive.team_ids, 1), 0) > 0
    and exists (
      select 1
      from unnest(coalesce(array_remove(p_player_ids, null), '{}'::text[])) as stale(player_id)
      join public.players p on p.id = stale.player_id
      where not (p.team_id = any(alive.team_ids))
    )
  from alive;
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

revoke all on function public.card_pool_pick_with_alive(text, text, text[], text[]) from public;
revoke all on function public.card_any_pick_with_alive(text, text[], text[]) from public;
revoke all on function public.card_pool_pick_many_with_alive(text, text, integer, text[], text[]) from public;
revoke all on function public.card_player_ids_need_playoff_reroll(text[]) from public;
revoke all on function public.card_pool_pick(text, text, text[]) from public;
revoke all on function public.card_any_pick(text, text[]) from public;
revoke all on function public.card_pool_pick_many(text, text, integer, text[]) from public;
revoke all on function public.open_card_drop(text) from public;

grant execute on function public.open_card_drop(text) to authenticated;
