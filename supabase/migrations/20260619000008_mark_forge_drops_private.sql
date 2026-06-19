-- La forja necesita un drop_id por la FK de user_cards, pero esos registros no
-- deben ser sobres especiales abribles. Los marcamos como kind='forge' y los
-- ocultamos de la lectura global de card_drops.

do $$
declare
  r record;
begin
  for r in
    select conname
    from pg_constraint
    where conrelid = 'public.card_drops'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%kind%'
  loop
    execute format('alter table public.card_drops drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.card_drops
  add constraint card_drops_kind_check
  check (kind in ('daily', 'special', 'forge'));

update public.card_drops
set kind = 'forge'
where id like 'forge-%';

drop policy if exists "available card drops read" on public.card_drops;
create policy "available card drops read" on public.card_drops
  for select using (
    (available_at <= now() or public.is_admin())
    and (kind <> 'forge' or created_by = auth.uid())
    and (
      (id not like 'special-sobera-%' and id not like 'special-ruleta-%')
      or created_by = auth.uid()
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
    or (v_drop.created_by is not null and v_drop.id not like 'special-%')
  ) and v_drop.created_by is distinct from v_uid then
    raise exception 'Sobre no disponible';
  end if;

  insert into public.user_cards (user_id, drop_id, card_index, player_id)
  select v_uid, v_drop.id, cards.ordinality::integer, cards.player_id
  from unnest(v_drop.player_ids) with ordinality as cards(player_id, ordinality)
  on conflict (user_id, drop_id, card_index) do nothing;

  return query
  select c.id, c.drop_id, c.card_index, c.player_id, c.used_at, c.created_at
  from public.user_cards c
  where c.user_id = v_uid and c.drop_id = v_drop.id
  order by c.card_index;
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

  select array_agg(distinct p.position) into v_positions
  from public.user_cards c
  join public.players p on p.id = c.player_id
  where c.id = any(v_ids) and c.user_id = v_uid and c.used_at is null;

  v_same_position := case
    when array_length(v_positions, 1) = 1 then v_positions[1]
    else null
  end;

  with consumed as (
    update public.user_cards c
    set used_at = now()
    where c.id = any(v_ids) and c.user_id = v_uid and c.used_at is null
    returning c.id
  )
  select count(*) into v_consumed from consumed;

  if v_consumed <> 4 then
    raise exception 'Alguna carta no esta disponible';
  end if;

  if v_same_position is not null then
    select p.id into v_result
    from public.players p
    join public.card_pool_players cp on cp.player_id = p.id and cp.pool = 'stars'
    where p.squad_status <> 'withdrawn' and p.position = v_same_position
    order by random()
    limit 1;
  end if;

  if v_result is null then
    select p.id into v_result
    from public.players p
    join public.card_pool_players cp on cp.player_id = p.id and cp.pool = 'stars'
    where p.squad_status <> 'withdrawn'
    order by random()
    limit 1;
  end if;

  if v_result is null then
    raise exception 'No hay legendarias disponibles';
  end if;

  insert into public.card_drops (id, kind, label, player_ids, available_at, created_by)
  values (v_drop_id, 'forge', 'Forja', array[v_result], now(), v_uid);

  insert into public.user_cards (user_id, drop_id, card_index, player_id)
  values (v_uid, v_drop_id, 1, v_result);

  return query
  select c.id, c.drop_id, c.card_index, c.player_id, c.used_at, c.created_at
  from public.user_cards c
  where c.user_id = v_uid and c.drop_id = v_drop_id;
end;
$$;

revoke all on function public.open_card_drop(text) from public;
revoke all on function public.apply_card_upgrade(uuid[]) from public;
grant execute on function public.open_card_drop(text) to authenticated;
grant execute on function public.apply_card_upgrade(uuid[]) to authenticated;
