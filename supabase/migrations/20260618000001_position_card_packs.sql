-- Sobres por puesto: defensas, mediocentros y delanteros.
-- Cada sobre de estos pools da 3 cartas distintas del puesto correspondiente.

insert into public.card_pool_players (pool, player_id)
select v.pool, v.player_id
from (
  select
    case p.position
      when 'DEF' then 'defensas'
      when 'MED' then 'medios'
      when 'DEL' then 'delanteros'
    end as pool,
    p.id as player_id
  from public.players p
  where p.position in ('DEF', 'MED', 'DEL')
    and p.squad_status <> 'withdrawn'
) as v
where v.pool is not null
on conflict (pool, player_id) do nothing;

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
  select coalesce(array_agg(picked.id order by picked.sort_key), '{}'::text[])
  from (
    select p.id, md5(coalesce(p_seed, '') || ':' || p.id) as sort_key
    from public.players p
    join public.card_pool_players cp on cp.player_id = p.id and cp.pool = p_pool
    where p.squad_status <> 'withdrawn'
      and p.id <> all (coalesce(array_remove(p_exclude, null), '{}'::text[]))
    order by sort_key
    limit least(3, greatest(1, coalesce(p_count, 3)))
  ) picked;
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
    when 'defensas' then 'Sobre Defensas'
    when 'medios' then 'Sobre Mediocentros'
    when 'delanteros' then 'Sobre Delanteros'
    else 'Sobre especial'
  end;
  v_player_ids text[];
  v_pid text;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;
  if p_pool not in (
    'stars',
    'madrid',
    'sub21',
    'francia',
    'premier',
    'defensas',
    'medios',
    'delanteros'
  ) then
    raise exception 'Pool no valido';
  end if;
  v_drop_id := p_pool || '-' || v_day_key || '-' || v_uid::text;

  if p_pool in ('defensas', 'medios', 'delanteros') then
    v_player_ids := public.card_pool_pick_many(p_pool, 'themed:' || v_drop_id, 3);
  else
    v_pid := coalesce(
      public.card_pool_pick(p_pool, 'themed:' || v_drop_id),
      public.card_any_pick('themed:' || v_drop_id)
    );
    v_player_ids := array[v_pid];
  end if;

  if coalesce(array_length(v_player_ids, 1), 0) = 0 then
    raise exception 'No hay jugadores disponibles para el sobre';
  end if;

  insert into public.card_drops (id, kind, label, player_ids, available_at, created_by)
  values (v_drop_id, 'special', v_label, v_player_ids, v_day::timestamptz, v_uid)
  on conflict (id) do nothing;

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
    v_player_ids := public.card_pool_pick_many(p_pool, 'special:' || v_drop_id, 3);
  elsif p_pool in ('stars', 'madrid', 'sub21', 'francia', 'premier') then
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

revoke all on function public.card_pool_pick_many(text, text, integer, text[]) from public;
revoke all on function public.open_themed_card_pack(text, date) from public;
revoke all on function public.admin_create_card_drop(text, text) from public;

grant execute on function public.open_themed_card_pack(text, date) to authenticated;
grant execute on function public.admin_create_card_drop(text, text) to authenticated;
