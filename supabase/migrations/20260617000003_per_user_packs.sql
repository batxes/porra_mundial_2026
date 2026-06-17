-- Sobres POR USUARIO: cada usuario tiene su propio drop, con cartas sembradas
-- por su uid (antes eran iguales para todos). Y pool nuevo "premier" (22).
-- Las tablas de cartas tenían poquísimos datos (la feature se acababa de
-- activar), así que el cambio de modelo es seguro.

-- 1) Pool premier (Premier League). where-exists + on-conflict, idempotente.
insert into public.card_pool_players (pool, player_id)
select v.pool, v.player_id from (values
  ('premier', 'nor-09'),
  ('premier', 'eng-04'),
  ('premier', 'eng-07'),
  ('premier', 'ger-17'),
  ('premier', 'ecu-23'),
  ('premier', 'fra-17'),
  ('premier', 'eng-17'),
  ('premier', 'arg-24'),
  ('premier', 'fra-24'),
  ('premier', 'swe-09'),
  ('premier', 'gha-11'),
  ('premier', 'ned-08'),
  ('premier', 'eng-08'),
  ('premier', 'bel-11'),
  ('premier', 'esp-18'),
  ('premier', 'cro-04'),
  ('premier', 'esp-24'),
  ('premier', 'bra-22'),
  ('premier', 'ger-07'),
  ('premier', 'nor-10'),
  ('premier', 'eng-18'),
  ('premier', 'swe-17')
) as v(pool, player_id)
where exists (select 1 from public.players p where p.id = v.player_id)
on conflict (pool, player_id) do nothing;

-- 2) Diario POR USUARIO: drop_id `daily-<fecha>-<uid>`, semilla con uid → 3
--    cartas distintas por usuario (mismo tiering). Determinista por (fecha,uid).
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
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;
  v_drop_id := 'daily-' || v_day_key || '-' || v_uid::text;

  insert into public.card_drops (id, kind, label, player_ids, available_at, created_by)
  values (
    v_drop_id,
    'daily',
    v_label,
    public.daily_pack_player_ids('daily:' || v_day_key || ':' || v_uid::text),
    v_day::timestamptz,
    v_uid
  )
  on conflict (id) do nothing;

  return query
  select * from public.open_card_drop(v_drop_id);
end;
$$;

-- 3) Temáticos POR USUARIO (incluye premier): drop_id `<pool>-<fecha>-<uid>`,
--    1 carta del pool sembrada por uid → distinta por usuario.
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
  v_pid text;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;
  if p_pool not in ('stars', 'madrid', 'sub21', 'francia', 'premier') then
    raise exception 'Pool no válido';
  end if;
  v_drop_id := p_pool || '-' || v_day_key || '-' || v_uid::text;

  v_pid := coalesce(
    public.card_pool_pick(p_pool, 'themed:' || v_drop_id),
    public.card_any_pick('themed:' || v_drop_id)
  );
  if v_pid is null then
    raise exception 'No hay jugadores disponibles para el sobre';
  end if;

  insert into public.card_drops (id, kind, label, player_ids, available_at, created_by)
  values (v_drop_id, 'special', v_label, array[v_pid], v_day::timestamptz, v_uid)
  on conflict (id) do nothing;

  return query
  select * from public.open_card_drop(v_drop_id);
end;
$$;
