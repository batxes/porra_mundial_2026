-- Pools de jugadores para las cartas (tiering del sobre diario + sobres
-- temáticos) y RPCs que los usan. TODO es ADITIVO e IDEMPOTENTE: no se toca
-- ninguna tabla del core (players, predictions, matches...) salvo para leer.
-- Las tablas de cartas (card_drops/user_cards/card_swaps) están vacías en prod
-- (CARDS_DEMO era true), así que reescribir sus RPCs no afecta a datos viejos.

-- 1) Tabla de pools: a qué pool pertenece cada jugador (curado a mano en el
--    cliente, lo portamos aquí para que el servidor decida las cartas).
create table if not exists public.card_pool_players (
  pool text not null,
  player_id text not null references public.players(id) on delete cascade,
  primary key (pool, player_id)
);

alter table public.card_pool_players enable row level security;

drop policy if exists "card pools read" on public.card_pool_players;
create policy "card pools read" on public.card_pool_players
  for select using (true);

grant select on public.card_pool_players to anon, authenticated;
revoke insert, update, delete on public.card_pool_players from anon, authenticated;

-- 2) Semilla de los pools (generada desde star-players.ts / top150-players.ts /
--    cofres-view.tsx). El `where exists` evita romper la migración si algún id
--    no estuviera en players (se salta, no aborta).

-- pool stars: 93 jugadores
insert into public.card_pool_players (pool, player_id)
select v.pool, v.player_id from (values
  ('stars', 'esp-19'),
  ('stars', 'fra-10'),
  ('stars', 'eng-09'),
  ('stars', 'fra-07'),
  ('stars', 'fra-11'),
  ('stars', 'nor-09'),
  ('stars', 'bra-07'),
  ('stars', 'mar-02'),
  ('stars', 'por-23'),
  ('stars', 'esp-20'),
  ('stars', 'uru-08'),
  ('stars', 'por-08'),
  ('stars', 'arg-09'),
  ('stars', 'esp-16'),
  ('stars', 'bra-11'),
  ('stars', 'arg-10'),
  ('stars', 'por-15'),
  ('stars', 'eng-10'),
  ('stars', 'eng-04'),
  ('stars', 'ecu-23'),
  ('stars', 'bra-03'),
  ('stars', 'ger-17'),
  ('stars', 'col-07'),
  ('stars', 'gha-11'),
  ('stars', 'arg-22'),
  ('stars', 'eng-07'),
  ('stars', 'ned-04'),
  ('stars', 'ger-06'),
  ('stars', 'can-19'),
  ('stars', 'por-10'),
  ('stars', 'ger-10'),
  ('stars', 'cro-10'),
  ('stars', 'por-25'),
  ('stars', 'ned-22'),
  ('stars', 'bel-07'),
  ('stars', 'fra-20'),
  ('stars', 'bel-11'),
  ('stars', 'por-07'),
  ('stars', 'fra-24'),
  ('stars', 'ger-02'),
  ('stars', 'fra-13'),
  ('stars', 'bel-01'),
  ('stars', 'ned-14'),
  ('stars', 'por-03'),
  ('stars', 'bra-08'),
  ('stars', 'arg-23'),
  ('stars', 'ned-21'),
  ('stars', 'esp-24'),
  ('stars', 'sen-10'),
  ('stars', 'esp-18'),
  ('stars', 'esp-17'),
  ('stars', 'arg-24'),
  ('stars', 'nor-10'),
  ('stars', 'ecu-06'),
  ('stars', 'sco-04'),
  ('stars', 'ned-08'),
  ('stars', 'egy-10'),
  ('stars', 'ned-11'),
  ('stars', 'cro-04'),
  ('stars', 'fra-15'),
  ('stars', 'bra-01'),
  ('stars', 'esp-22'),
  ('stars', 'bra-04'),
  ('stars', 'fra-17'),
  ('stars', 'fra-16'),
  ('stars', 'sen-18'),
  ('stars', 'por-17'),
  ('stars', 'arg-20'),
  ('stars', 'usa-08'),
  ('stars', 'bra-22'),
  ('stars', 'por-20'),
  ('stars', 'esp-10'),
  ('stars', 'swe-17'),
  ('stars', 'tur-08'),
  ('stars', 'usa-10'),
  ('stars', 'fra-05'),
  ('stars', 'kor-07'),
  ('stars', 'eng-24'),
  ('stars', 'eng-06'),
  ('stars', 'esp-08'),
  ('stars', 'bra-05'),
  ('stars', 'esp-06'),
  ('stars', 'eng-21'),
  ('stars', 'tur-11'),
  ('stars', 'mex-09'),
  ('stars', 'por-09'),
  ('stars', 'esp-21'),
  ('stars', 'fra-09'),
  ('stars', 'arg-06'),
  ('stars', 'fra-12'),
  ('stars', 'kor-04'),
  ('stars', 'swe-09'),
  ('stars', 'ecu-07')
) as v(pool, player_id)
where exists (select 1 from public.players p where p.id = v.player_id)
on conflict (pool, player_id) do nothing;

-- pool top150: 146 jugadores
insert into public.card_pool_players (pool, player_id)
select v.pool, v.player_id from (values
  ('top150', 'esp-19'),
  ('top150', 'nor-09'),
  ('top150', 'fra-10'),
  ('top150', 'esp-20'),
  ('top150', 'fra-11'),
  ('top150', 'por-23'),
  ('top150', 'por-15'),
  ('top150', 'bra-07'),
  ('top150', 'eng-10'),
  ('top150', 'eng-04'),
  ('top150', 'fra-20'),
  ('top150', 'eng-07'),
  ('top150', 'ger-10'),
  ('top150', 'ger-17'),
  ('top150', 'ecu-23'),
  ('top150', 'arg-09'),
  ('top150', 'fra-07'),
  ('top150', 'fra-17'),
  ('top150', 'ger-05'),
  ('top150', 'eng-17'),
  ('top150', 'uru-08'),
  ('top150', 'tur-08'),
  ('top150', 'arg-24'),
  ('top150', 'civ-11'),
  ('top150', 'fra-24'),
  ('top150', 'swe-09'),
  ('top150', 'arg-22'),
  ('top150', 'mar-02'),
  ('top150', 'ecu-06'),
  ('top150', 'gha-11'),
  ('top150', 'por-25'),
  ('top150', 'arg-18'),
  ('top150', 'esp-22'),
  ('top150', 'fra-18'),
  ('top150', 'ned-08'),
  ('top150', 'eng-08'),
  ('top150', 'bel-11'),
  ('top150', 'tur-11'),
  ('top150', 'esp-18'),
  ('top150', 'bra-03'),
  ('top150', 'bra-09'),
  ('top150', 'col-07'),
  ('top150', 'eng-06'),
  ('top150', 'eng-03'),
  ('top150', 'eng-16'),
  ('top150', 'arg-20'),
  ('top150', 'bra-11'),
  ('top150', 'fra-04'),
  ('top150', 'fra-08'),
  ('top150', 'fra-12'),
  ('top150', 'bra-08'),
  ('top150', 'cro-04'),
  ('top150', 'eng-21'),
  ('top150', 'eng-18'),
  ('top150', 'swe-17'),
  ('top150', 'bra-25'),
  ('top150', 'nor-10'),
  ('top150', 'eng-09'),
  ('top150', 'eng-24'),
  ('top150', 'cro-22'),
  ('top150', 'por-18'),
  ('top150', 'esp-10'),
  ('top150', 'fra-05'),
  ('top150', 'bra-26'),
  ('top150', 'ned-11'),
  ('top150', 'ger-07'),
  ('top150', 'ger-15'),
  ('top150', 'ger-11'),
  ('top150', 'sen-13'),
  ('top150', 'por-03'),
  ('top150', 'uzb-02'),
  ('top150', 'sui-09'),
  ('top150', 'ger-23'),
  ('top150', 'ecu-03'),
  ('top150', 'mar-06'),
  ('top150', 'egy-22'),
  ('top150', 'por-06'),
  ('top150', 'por-17'),
  ('top150', 'fra-25'),
  ('top150', 'fra-06'),
  ('top150', 'fra-26'),
  ('top150', 'fra-09'),
  ('top150', 'esp-07'),
  ('top150', 'esp-16'),
  ('top150', 'esp-24'),
  ('top150', 'eng-20'),
  ('top150', 'bra-22'),
  ('top150', 'bra-23'),
  ('top150', 'bel-24'),
  ('top150', 'ned-06'),
  ('top150', 'ned-18'),
  ('top150', 'ger-24'),
  ('top150', 'ger-16'),
  ('top150', 'alg-22'),
  ('top150', 'esp-13'),
  ('top150', 'fra-15'),
  ('top150', 'civ-15'),
  ('top150', 'arg-13'),
  ('top150', 'civ-02'),
  ('top150', 'sui-01'),
  ('top150', 'sen-18'),
  ('top150', 'usa-20'),
  ('top150', 'sen-26'),
  ('top150', 'mar-11'),
  ('top150', 'ger-09'),
  ('top150', 'ger-14'),
  ('top150', 'ger-18'),
  ('top150', 'alg-15'),
  ('top150', 'sen-11'),
  ('top150', 'can-19'),
  ('top150', 'eng-11'),
  ('top150', 'eng-02'),
  ('top150', 'jpn-24'),
  ('top150', 'por-01'),
  ('top150', 'por-16'),
  ('top150', 'por-14'),
  ('top150', 'usa-10'),
  ('top150', 'cro-17'),
  ('top150', 'arg-06'),
  ('top150', 'esp-15'),
  ('top150', 'arg-17'),
  ('top150', 'arg-08'),
  ('top150', 'esp-17'),
  ('top150', 'cro-02'),
  ('top150', 'sen-08'),
  ('top150', 'nor-11'),
  ('top150', 'sco-04'),
  ('top150', 'civ-24'),
  ('top150', 'bra-19'),
  ('top150', 'ned-25'),
  ('top150', 'ned-01'),
  ('top150', 'civ-09'),
  ('top150', 'mar-10'),
  ('top150', 'mar-23'),
  ('top150', 'cod-14'),
  ('top150', 'swe-07'),
  ('top150', 'swe-18'),
  ('top150', 'bel-26'),
  ('top150', 'bel-12'),
  ('top150', 'sen-21'),
  ('top150', 'uru-20'),
  ('top150', 'tur-20'),
  ('top150', 'bra-14'),
  ('top150', 'civ-21'),
  ('top150', 'ger-06'),
  ('top150', 'ned-21')
) as v(pool, player_id)
where exists (select 1 from public.players p where p.id = v.player_id)
on conflict (pool, player_id) do nothing;

-- pool madrid: 11 jugadores
insert into public.card_pool_players (pool, player_id)
select v.pool, v.player_id from (values
  ('madrid', 'bel-01'),
  ('madrid', 'bra-07'),
  ('madrid', 'bra-19'),
  ('madrid', 'eng-10'),
  ('madrid', 'fra-08'),
  ('madrid', 'fra-10'),
  ('madrid', 'ger-02'),
  ('madrid', 'mar-10'),
  ('madrid', 'uru-08'),
  ('madrid', 'aut-08'),
  ('madrid', 'esp-24')
) as v(pool, player_id)
where exists (select 1 from public.players p where p.id = v.player_id)
on conflict (pool, player_id) do nothing;

-- pool sub21: 9 jugadores
insert into public.card_pool_players (pool, player_id)
select v.pool, v.player_id from (values
  ('sub21', 'mex-19'),
  ('sub21', 'esp-19'),
  ('sub21', 'egy-09'),
  ('sub21', 'ned-25'),
  ('sub21', 'bra-19'),
  ('sub21', 'fra-20'),
  ('sub21', 'por-15'),
  ('sub21', 'tur-08'),
  ('sub21', 'arg-18')
) as v(pool, player_id)
where exists (select 1 from public.players p where p.id = v.player_id)
on conflict (pool, player_id) do nothing;

-- pool francia: 19 jugadores
insert into public.card_pool_players (pool, player_id)
select v.pool, v.player_id from (values
  ('francia', 'fra-16'),
  ('francia', 'fra-05'),
  ('francia', 'fra-04'),
  ('francia', 'fra-17'),
  ('francia', 'fra-19'),
  ('francia', 'fra-08'),
  ('francia', 'fra-14'),
  ('francia', 'fra-11'),
  ('francia', 'fra-20'),
  ('francia', 'fra-07'),
  ('francia', 'fra-10'),
  ('francia', 'fra-12'),
  ('francia', 'fra-09'),
  ('francia', 'fra-24'),
  ('francia', 'fra-13'),
  ('francia', 'fra-06'),
  ('francia', 'fra-18'),
  ('francia', 'fra-21'),
  ('francia', 'fra-02')
) as v(pool, player_id)
where exists (select 1 from public.players p where p.id = v.player_id)
on conflict (pool, player_id) do nothing;

-- 3) Relajar el CHECK de card_drops.player_ids: ahora un drop puede tener 1..3
--    cartas (los temáticos son de 1 carta; el diario, 3). La tabla está vacía,
--    así que es seguro. Se borra cualquier check sobre array_length de forma
--    robusta (sin depender del nombre autogenerado) y se añade el nuevo.
do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.card_drops'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%array_length%'
  loop
    execute format('alter table public.card_drops drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.card_drops
  add constraint card_drops_player_ids_count
  check (coalesce(array_length(player_ids, 1), 0) between 1 and 3);

-- 4) Helpers de selección determinista (mismo md5(seed:id) que el SQL original,
--    así "igual para todos" por semilla). Null-safe en las exclusiones.
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
  select p.id
  from public.players p
  join public.card_pool_players cp on cp.player_id = p.id and cp.pool = p_pool
  where p.squad_status <> 'withdrawn'
    and p.id <> all (coalesce(array_remove(p_exclude, null), '{}'::text[]))
  order by md5(coalesce(p_seed, '') || ':' || p.id)
  limit 1;
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
  select p.id
  from public.players p
  where p.squad_status <> 'withdrawn'
    and p.id <> all (coalesce(array_remove(p_exclude, null), '{}'::text[]))
  order by md5(coalesce(p_seed, '') || ':' || p.id)
  limit 1;
$$;

-- Tirada del sobre diario: 3 cartas con "pity" garantizado, todas distintas.
--   índice 0 → totalmente aleatoria
--   índice 1 → del Top-150 (jugadorazo asegurado)
--   índice 2 → de rareza máxima (estrella/legendaria); clímax del revelado.
-- Refleja pickDailyPlayers() del cliente. Coalesce a carta aleatoria por si un
-- pool quedara vacío (no debería).
create or replace function public.daily_pack_player_ids(p_seed text)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_star text;
  v_top text;
  v_random text;
begin
  v_star := coalesce(
    public.card_pool_pick('stars', p_seed || ':star'),
    public.card_any_pick(p_seed || ':star')
  );
  v_top := coalesce(
    public.card_pool_pick('top150', p_seed || ':top', array[v_star]),
    public.card_any_pick(p_seed || ':top', array[v_star])
  );
  v_random := public.card_any_pick(p_seed || ':any', array[v_star, v_top]);
  return array[v_random, v_top, v_star];
end;
$$;

-- 5) Reescribir el diario para que use el tiering de 3 niveles (antes daba 3
--    aleatorios sin tiers). Misma firma → reemplaza.
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
declare
  v_drop_id text := 'daily-' || to_char(coalesce(p_day, current_date), 'YYYY-MM-DD');
  v_label text := 'Sobre diario ' || to_char(coalesce(p_day, current_date), 'DD/MM/YYYY');
begin
  insert into public.card_drops (id, kind, label, player_ids, available_at)
  values (
    v_drop_id,
    'daily',
    v_label,
    public.daily_pack_player_ids('daily:' || v_drop_id),
    (coalesce(p_day, current_date))::timestamptz
  )
  on conflict (id) do nothing;

  return query
  select * from public.open_card_drop(v_drop_id);
end;
$$;

-- 6) Sobres TEMÁTICOS (Madrid/Promesas/Estrellas/Francia): 1 carta del pool,
--    determinista por día (igual para todos), creado on-demand como el diario.
--    El cliente pasa p_day (zona horaria de Madrid) para que el drop_id coincida.
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
declare
  v_day date := coalesce(p_day, current_date);
  v_drop_id text := p_pool || '-' || to_char(v_day, 'YYYY-MM-DD');
  v_label text := case p_pool
    when 'stars' then 'Sobre Estrellas'
    when 'madrid' then 'Sobre Madrid'
    when 'sub21' then 'Sobre Promesas'
    when 'francia' then 'Sobre Francia'
    else 'Sobre especial'
  end;
  v_pid text;
begin
  if p_pool not in ('stars', 'madrid', 'sub21', 'francia') then
    raise exception 'Pool no válido';
  end if;

  v_pid := coalesce(
    public.card_pool_pick(p_pool, 'themed:' || v_drop_id),
    public.card_any_pick('themed:' || v_drop_id)
  );
  if v_pid is null then
    raise exception 'No hay jugadores disponibles para el sobre';
  end if;

  insert into public.card_drops (id, kind, label, player_ids, available_at)
  values (v_drop_id, 'special', v_label, array[v_pid], v_day::timestamptz)
  on conflict (id) do nothing;

  return query
  select * from public.open_card_drop(v_drop_id);
end;
$$;

-- 7) Drops de admin POR TIPO: ahora respeta el pool (antes solo usaba el label).
--    Se borra la versión de 1 argumento para evitar ambigüedad en PostgREST.
drop function if exists public.admin_create_card_drop(text);

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

  if p_pool in ('stars', 'madrid', 'sub21', 'francia') then
    v_pid := coalesce(
      public.card_pool_pick(p_pool, 'special:' || v_drop_id),
      public.card_any_pick('special:' || v_drop_id)
    );
    v_player_ids := array[v_pid];
  else
    -- 'diario' o sin pool: drop especial con tiering de 3 cartas.
    v_player_ids := public.daily_pack_player_ids('special:' || v_drop_id);
  end if;

  insert into public.card_drops (id, kind, label, player_ids, created_by)
  values (v_drop_id, 'special', v_label, v_player_ids, v_uid);

  return query
  select d.id, d.kind, d.label, d.player_ids, d.available_at, d.created_at
  from public.card_drops d
  where d.id = v_drop_id;
end;
$$;

-- 8) Permisos de las funciones nuevas / recreadas.
revoke all on function public.card_pool_pick(text, text, text[]) from public;
revoke all on function public.card_any_pick(text, text[]) from public;
revoke all on function public.daily_pack_player_ids(text) from public;
revoke all on function public.open_themed_card_pack(text, date) from public;
revoke all on function public.admin_create_card_drop(text, text) from public;

grant execute on function public.open_themed_card_pack(text, date) to authenticated;
grant execute on function public.admin_create_card_drop(text, text) to authenticated;
