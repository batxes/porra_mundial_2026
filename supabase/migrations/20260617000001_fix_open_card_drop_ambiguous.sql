-- Fix: "column reference \"player_id\" is ambiguous" al abrir un sobre.
-- En open_card_drop (migración 20260614), el INSERT...SELECT usaba `player_id`
-- sin cualificar, que colisiona con la columna de salida `player_id` del
-- RETURNS TABLE (en plpgsql, las columnas OUT son variables en scope). Nunca se
-- había ejecutado (CARDS_DEMO=true) hasta activar las cartas. Lo cualificamos
-- como `cards.player_id` / `cards.ordinality`. Solo cambia eso; el resto igual.
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
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  select * into v_drop
  from public.card_drops
  where id = p_drop_id and available_at <= now();

  if not found then
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
