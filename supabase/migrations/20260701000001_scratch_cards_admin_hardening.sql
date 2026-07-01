-- Hardening del Rasca: activacion desde admin, premios privados fuera de la
-- estanteria global y funciones con referencias cualificadas para evitar
-- conflictos de nombres en PL/pgSQL.

insert into public.scratch_card_settings as scs (
  id,
  active,
  active_scratch_card_id
)
select
  true,
  false,
  sc.id
from public.scratch_cards as sc
order by sc.created_at asc
limit 1
on conflict (id) do update
set
  active_scratch_card_id = coalesce(
    scs.active_scratch_card_id,
    excluded.active_scratch_card_id
  ),
  updated_at = now()
where scs.active_scratch_card_id is null;

create or replace function public.scratch_cards_status()
returns table (
  active boolean,
  completed boolean,
  scratch_card_id uuid,
  title text,
  card_count integer,
  win_chance numeric,
  rewards jsonb,
  wins integer,
  packs_awarded integer,
  cards jsonb,
  awarded_drop_ids text[],
  completed_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  return query
  select
    scs.active,
    sca.user_id is not null as completed,
    sc.id as scratch_card_id,
    sc.title,
    sc.card_count,
    sc.win_chance,
    public.scratch_cards_public_rewards(sc.rewards) as rewards,
    coalesce(sca.wins, 0) as wins,
    coalesce(sca.packs_awarded, 0) as packs_awarded,
    coalesce(sca.cards, '[]'::jsonb) as cards,
    coalesce(sca.awarded_drop_ids, '{}'::text[]) as awarded_drop_ids,
    sca.completed_at
  from public.scratch_card_settings as scs
  join public.scratch_cards as sc
    on sc.id = scs.active_scratch_card_id
  left join public.scratch_card_attempts as sca
    on sca.scratch_card_id = sc.id
    and sca.user_id = v_uid
  where scs.id is true;
end;
$$;

create or replace function public.admin_scratch_cards_status()
returns table (
  active boolean,
  active_scratch_card_id uuid,
  active_scratch_card_title text,
  card_count integer,
  win_chance numeric,
  total_attempts bigint,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede ver el estado de Rasca';
  end if;

  return query
  select
    scs.active,
    scs.active_scratch_card_id,
    sc.title as active_scratch_card_title,
    sc.card_count,
    sc.win_chance,
    (
      select count(*)
      from public.scratch_card_attempts as sca
      where sca.scratch_card_id = scs.active_scratch_card_id
    ) as total_attempts,
    scs.updated_at
  from public.scratch_card_settings as scs
  left join public.scratch_cards as sc
    on sc.id = scs.active_scratch_card_id
  where scs.id is true;
end;
$$;

create or replace function public.admin_set_scratch_cards_active(
  p_active boolean,
  p_scratch_card_id uuid default null
)
returns table (
  active boolean,
  active_scratch_card_id uuid,
  active_scratch_card_title text,
  card_count integer,
  win_chance numeric,
  total_attempts bigint,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_scratch_card_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede activar Rasca';
  end if;

  select coalesce(
    p_scratch_card_id,
    (
      select scs.active_scratch_card_id
      from public.scratch_card_settings as scs
      where scs.id is true
    ),
    (
      select sc.id
      from public.scratch_cards as sc
      order by sc.created_at asc
      limit 1
    )
  )
  into v_scratch_card_id;

  if coalesce(p_active, false) and v_scratch_card_id is null then
    raise exception 'No hay juego de Rasca para activar';
  end if;

  if v_scratch_card_id is not null and not exists (
    select 1
    from public.scratch_cards as sc
    where sc.id = v_scratch_card_id
  ) then
    raise exception 'Juego de Rasca no encontrado';
  end if;

  update public.scratch_card_settings as scs
  set
    active = coalesce(p_active, false),
    active_scratch_card_id = coalesce(
      v_scratch_card_id,
      scs.active_scratch_card_id
    ),
    updated_by = v_uid,
    updated_at = now()
  where scs.id is true;

  return query
  select
    admin_status.active,
    admin_status.active_scratch_card_id,
    admin_status.active_scratch_card_title,
    admin_status.card_count,
    admin_status.win_chance,
    admin_status.total_attempts,
    admin_status.updated_at
  from public.admin_scratch_cards_status() as admin_status;
end;
$$;

create or replace function public.admin_scratch_cards_attempts(
  p_scratch_card_id uuid default null
)
returns table (
  scratch_card_id uuid,
  scratch_card_title text,
  user_id uuid,
  display_name text,
  wins integer,
  packs_awarded integer,
  cards jsonb,
  awarded_drop_ids text[],
  completed_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede ver los intentos de Rasca';
  end if;

  return query
  select
    sca.scratch_card_id,
    sc.title as scratch_card_title,
    sca.user_id,
    coalesce(profile.display_name, 'Usuario') as display_name,
    sca.wins,
    sca.packs_awarded,
    sca.cards,
    sca.awarded_drop_ids,
    sca.completed_at
  from public.scratch_card_attempts as sca
  join public.scratch_cards as sc
    on sc.id = sca.scratch_card_id
  left join public.profiles as profile
    on profile.id = sca.user_id
  where p_scratch_card_id is null
    or sca.scratch_card_id = p_scratch_card_id
  order by sca.completed_at desc
  limit 200;
end;
$$;

create or replace function public.complete_scratch_cards(
  p_cards jsonb default '[]'::jsonb
)
returns table (
  scratch_card_id uuid,
  wins integer,
  packs_awarded integer,
  awarded_drop_ids text[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scratch_card_id uuid;
begin
  select scs.active_scratch_card_id
  into v_scratch_card_id
  from public.scratch_card_settings as scs
  where scs.id is true;

  return query
  select
    completed.scratch_card_id,
    completed.wins,
    completed.packs_awarded,
    completed.awarded_drop_ids
  from public.complete_scratch_cards(v_scratch_card_id, p_cards) as completed;
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

  select drop_row.*
  into v_drop
  from public.card_drops as drop_row
  where drop_row.id = p_drop_id
    and drop_row.available_at <= now();

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
    select 1
    from public.user_cards as user_card
    where user_card.user_id = v_uid
      and user_card.drop_id = v_drop.id
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
  select
    v_uid,
    v_drop.id,
    picked_cards.ordinality::integer,
    picked_cards.player_id
  from unnest(v_player_ids) with ordinality as picked_cards(player_id, ordinality)
  where picked_cards.player_id is not null
  on conflict (user_id, drop_id, card_index) do nothing;

  return query
  select
    user_card.id,
    user_card.drop_id,
    user_card.card_index,
    user_card.player_id,
    user_card.used_at,
    user_card.created_at
  from public.user_cards as user_card
  where user_card.user_id = v_uid
    and user_card.drop_id = v_drop.id
  order by user_card.card_index;
end;
$$;

revoke all on function public.scratch_cards_status() from public;
revoke all on function public.admin_scratch_cards_status() from public;
revoke all on function public.admin_set_scratch_cards_active(boolean, uuid) from public;
revoke all on function public.admin_scratch_cards_attempts(uuid) from public;
revoke all on function public.complete_scratch_cards(jsonb) from public;
revoke all on function public.open_card_drop(text) from public;

grant execute on function public.scratch_cards_status() to authenticated;
grant execute on function public.admin_scratch_cards_status() to authenticated;
grant execute on function public.admin_set_scratch_cards_active(boolean, uuid) to authenticated;
grant execute on function public.admin_scratch_cards_attempts(uuid) to authenticated;
grant execute on function public.complete_scratch_cards(jsonb) to authenticated;
grant execute on function public.open_card_drop(text) to authenticated;
