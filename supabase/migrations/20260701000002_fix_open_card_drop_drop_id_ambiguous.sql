-- La migracion de hardening del Rasca rehizo open_card_drop sin
-- #variable_conflict use_column. En funciones RETURNS TABLE, drop_id/card_index
-- tambien existen como variables de salida, asi que el ON CONFLICT puede quedar
-- ambiguo en PL/pgSQL. Restauramos la directiva manteniendo la privacidad de
-- special-rasca-* y special-admin-*.

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

revoke all on function public.open_card_drop(text) from public;
grant execute on function public.open_card_drop(text) to authenticated;
