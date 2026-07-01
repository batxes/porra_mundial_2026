-- Sobres dirigidos desde admin: un drop especial privado para un usuario.
-- Usa prefijo special-admin-* para que /cofres lo trate como sobre suelto,
-- pero RLS/open_card_drop lo limiten al destinatario (created_by).

insert into public.players (
  id,
  team_id,
  display_name,
  position,
  squad_status,
  source_updated_at
)
values (
  'apr-bicho',
  'por',
  'El Bicho',
  'DEL',
  'withdrawn',
  now()
)
on conflict (id) do update set
  team_id = excluded.team_id,
  display_name = excluded.display_name,
  position = excluded.position,
  squad_status = excluded.squad_status,
  source_updated_at = excluded.source_updated_at;

delete from public.card_pool_players
where player_id = 'apr-bicho';

create or replace function public.card_player_points(p_player_id text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_player_id = 'apr-bicho' then 99
    else (
      select coalesce(sum(
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
          else 0
        end
      ), 0)::integer
      from public.match_events e
      join public.matches m on m.id = e.match_id and m.status in ('finished', 'validated')
      left join public.players pl on pl.id = e.player_id
      where e.player_id = p_player_id
        and e.event_type in ('goal', 'penalty_goal', 'mvp', 'penalty_save', 'penalty_miss', 'red_card')
    )
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

  if p_pool = 'aprils' then
    v_player_ids := array['apr-bicho'];
  elsif p_pool in ('porteros', 'defensas', 'medios', 'delanteros') then
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

create or replace function public.admin_create_user_card_drop(
  p_target_user_id uuid,
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
  v_drop_id text := 'special-admin-' || gen_random_uuid()::text;
  v_label text := coalesce(nullif(trim(p_label), ''), 'Drop especial');
  v_player_ids text[];
  v_seed text;
  v_seen text[];
begin
  if not public.is_admin() then
    raise exception 'Solo el admin puede enviar sobres dirigidos';
  end if;

  if p_target_user_id is null then
    raise exception 'El destinatario es obligatorio';
  end if;

  perform 1 from public.profiles where id = p_target_user_id;
  if not found then
    raise exception 'Usuario no encontrado';
  end if;

  v_seen := public.card_user_seen_player_ids(p_target_user_id);
  v_seed := 'special-admin:' || v_drop_id || ':' || p_target_user_id::text;

  if p_pool = 'aprils' then
    v_player_ids := array['apr-bicho'];
  elsif p_pool in (
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
    v_player_ids := public.sobera_pick_reward_player_ids(p_pool, v_seed, v_seen);
  else
    v_player_ids := public.daily_pack_player_ids_avoiding(v_seed, v_seen);
    if coalesce(array_length(v_player_ids, 1), 0) = 0 then
      v_player_ids := public.daily_pack_player_ids(v_seed);
    end if;
  end if;

  if coalesce(array_length(v_player_ids, 1), 0) = 0 then
    raise exception 'No hay jugadores disponibles para el sobre';
  end if;

  insert into public.card_drops (id, kind, label, player_ids, created_by)
  values (v_drop_id, 'special', v_label, v_player_ids, p_target_user_id);

  return query
  select d.id, d.kind, d.label, d.player_ids, d.available_at, d.created_at
  from public.card_drops d
  where d.id = v_drop_id;
end;
$$;

create or replace function public.apply_card_upgrade(p_card_ids uuid[])
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
declare
  v_uid uuid := auth.uid();
  v_ids uuid[];
  v_consumed integer;
  v_positions text[];
  v_same_position text;
  v_alive text[] := public.card_alive_playoff_team_ids();
  v_result text;
  v_drop_id text := 'forge-' || gen_random_uuid()::text;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  select array_agg(distinct id) into v_ids
  from unnest(coalesce(p_card_ids, '{}'::uuid[])) as id;

  if coalesce(array_length(v_ids, 1), 0) <> 4 then
    raise exception 'La forja necesita 4 cartas distintas';
  end if;

  if exists (
    select 1
    from public.user_cards c
    where c.id = any(v_ids)
      and c.user_id = v_uid
      and c.player_id = 'apr-bicho'
  ) then
    raise exception 'Esta carta no se puede forjar';
  end if;

  select array_agg(distinct p.position) into v_positions
  from public.user_cards c
  join public.players p on p.id = c.player_id
  where c.id = any(v_ids)
    and c.user_id = v_uid
    and c.used_at is null;

  v_same_position := case
    when array_length(v_positions, 1) = 1 then v_positions[1]
    else null
  end;

  if v_same_position is not null then
    select p.id into v_result
    from public.players p
    join public.card_pool_players cp
      on cp.player_id = p.id
      and cp.pool = 'stars'
    where p.squad_status <> 'withdrawn'
      and p.position = v_same_position
      and (
        coalesce(array_length(v_alive, 1), 0) = 0
        or p.team_id = any(v_alive)
      )
    order by random()
    limit 1;
  end if;

  if v_result is null then
    select p.id into v_result
    from public.players p
    join public.card_pool_players cp
      on cp.player_id = p.id
      and cp.pool = 'stars'
    where p.squad_status <> 'withdrawn'
      and (
        coalesce(array_length(v_alive, 1), 0) = 0
        or p.team_id = any(v_alive)
      )
    order by random()
    limit 1;
  end if;

  if v_result is null then
    raise exception 'No hay legendarias vivas disponibles';
  end if;

  with consumed as (
    update public.user_cards c
    set used_at = now()
    where c.id = any(v_ids)
      and c.user_id = v_uid
      and c.used_at is null
    returning c.id
  )
  select count(*) into v_consumed from consumed;

  if v_consumed <> 4 then
    raise exception 'Alguna carta no esta disponible';
  end if;

  insert into public.card_drops (id, kind, label, player_ids, available_at, created_by)
  values (v_drop_id, 'forge', 'Forja', array[v_result], now(), v_uid);

  insert into public.user_cards (user_id, drop_id, card_index, player_id)
  values (v_uid, v_drop_id, 1, v_result);

  return query
  select c.id, c.drop_id, c.card_index, c.player_id, c.used_at, c.created_at
  from public.user_cards c
  where c.user_id = v_uid
    and c.drop_id = v_drop_id;
end;
$$;

drop policy if exists "available card drops read" on public.card_drops;
create policy "available card drops read" on public.card_drops
  for select using (
    (available_at <= now() or public.is_admin())
    and (kind <> 'forge' or created_by = auth.uid())
    and (
      created_by is null
      or created_by = auth.uid()
      or (
        id like 'special-%'
        and id not like 'special-sobera-%'
        and id not like 'special-ruleta-%'
        and id not like 'special-oak-%'
        and id not like 'special-hoguera-%'
        and id not like 'special-portero-%'
        and id not like 'special-suarez-%'
        and id not like 'special-ronaldao-%'
        and id not like 'special-rasca-%'
        and id not like 'special-admin-%'
      )
    )
  );

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
    or v_drop.id like 'special-ronaldao-%'
    or v_drop.id like 'special-rasca-%'
    or v_drop.id like 'special-admin-%'
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

revoke all on function public.admin_create_user_card_drop(uuid, text, text) from public;
revoke all on function public.admin_create_card_drop(text, text) from public;
revoke all on function public.apply_card_upgrade(uuid[]) from public;
revoke all on function public.card_player_points(text) from public;
revoke all on function public.open_card_drop(text) from public;

grant execute on function public.admin_create_user_card_drop(uuid, text, text) to authenticated;
grant execute on function public.admin_create_card_drop(text, text) to authenticated;
grant execute on function public.apply_card_upgrade(uuid[]) to authenticated;
grant execute on function public.open_card_drop(text) to authenticated;
