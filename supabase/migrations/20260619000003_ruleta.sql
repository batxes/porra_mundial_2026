-- Ruleta de sobres: minijuego lanzado por el admin, mismo ciclo que el quiz
-- Sobera (activar -> todos giran una vez -> premio -> pausar/stats). Una ruleta
-- activa como maximo, un giro por usuario y por ruleta, y el premio lo decide
-- SIEMPRE el servidor (random ponderado). Los sobres ganados son drops privados
-- por usuario que aparecen en /cofres como sobres normales sin abrir.

-- 1) Tablas ------------------------------------------------------------------

create table if not exists public.ruletas (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'RULETA DE SOBRES',
  segments jsonb not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ruleta_settings (
  id boolean primary key default true check (id),
  active boolean not null default false,
  active_ruleta_id uuid references public.ruletas(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.ruleta_attempts (
  ruleta_id uuid not null references public.ruletas(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  segment_index integer not null,
  prize_pool text,
  awarded_drop_ids text[] not null default '{}'::text[],
  spun_at timestamptz not null default now(),
  primary key (ruleta_id, user_id)
);

create index if not exists ruleta_attempts_spun_idx
  on public.ruleta_attempts (spun_at desc);

alter table public.ruletas enable row level security;
alter table public.ruleta_settings enable row level security;
alter table public.ruleta_attempts enable row level security;

-- settings es publico (lo lee el gate); el detalle de la ruleta (pesos) solo se
-- expone via RPC sin los pesos. attempts: lectura del propio o admin.
drop policy if exists "public ruleta settings read" on public.ruleta_settings;
create policy "public ruleta settings read" on public.ruleta_settings
  for select using (true);

drop policy if exists "admin ruletas read" on public.ruletas;
create policy "admin ruletas read" on public.ruletas
  for select using (public.is_admin());

drop policy if exists "owner ruleta attempt read" on public.ruleta_attempts;
create policy "owner ruleta attempt read" on public.ruleta_attempts
  for select using (auth.uid() = user_id or public.is_admin());

grant select on public.ruleta_settings to anon, authenticated;
grant select on public.ruletas to authenticated;
grant select on public.ruleta_attempts to authenticated;
revoke insert, update, delete on public.ruletas from anon, authenticated;
revoke insert, update, delete on public.ruleta_settings from anon, authenticated;
revoke insert, update, delete on public.ruleta_attempts from anon, authenticated;

-- 2) Ruleta por defecto + settings -------------------------------------------
-- Pesos: la rareza la dan los pesos, no el angulo (la rueda es de casillas
-- iguales). Estrellas es el premio raro; "Casi" es la unica casilla sin sobre.

insert into public.ruletas (id, title, segments)
values (
  '00000000-0000-0000-0000-0000000000a1'::uuid,
  'RULETA DE SOBRES',
  '[
    { "label": "Defensas",     "pool": "defensas",   "weight": 22 },
    { "label": "Estrellas",    "pool": "stars",      "weight": 8 },
    { "label": "Mediocentros", "pool": "medios",     "weight": 20 },
    { "label": "Casi",         "pool": null,         "weight": 18 },
    { "label": "Delanteros",   "pool": "delanteros", "weight": 18 },
    { "label": "Sobre diario", "pool": "diario",     "weight": 14 }
  ]'::jsonb
)
on conflict (id) do nothing;

insert into public.ruleta_settings (id, active, active_ruleta_id)
values (true, false, '00000000-0000-0000-0000-0000000000a1'::uuid)
on conflict (id) do nothing;

-- 3) Helpers -----------------------------------------------------------------
-- Etiqueta del premio. sobera_pack_label no cubre "diario" (sobre tiered de 3
-- cartas) ni el caso sin premio.
create or replace function public.ruleta_pack_label(p_pool text)
returns text
language sql
stable
as $$
  select case
    when p_pool is null then 'Casi'
    when p_pool = 'diario' then 'Sobre diario'
    else public.sobera_pack_label(p_pool)
  end;
$$;

-- Segmentos publicos: como en el quiz, se quitan los pesos (probabilidades) y se
-- añade el titulo del sobre. El cliente solo dibuja la rueda; quien decide es el
-- servidor.
create or replace function public.ruleta_public_segments(p_segments jsonb)
returns jsonb
language sql
stable
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'label', item->>'label',
        'pool', item->'pool',
        'title', public.ruleta_pack_label(item->>'pool')
      )
      order by ordinality
    ),
    '[]'::jsonb
  )
  from jsonb_array_elements(p_segments) with ordinality as s(item, ordinality);
$$;

-- Elige los jugadores del premio. "diario" = 3 cartas tiered (como el sobre
-- diario); el resto, 1 carta del pool (reusa el picker del quiz).
create or replace function public.ruleta_pick_player_ids(p_pool text, p_seed text)
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
    return public.daily_pack_player_ids(p_seed);
  end if;
  return public.sobera_pick_reward_player_ids(p_pool, p_seed);
end;
$$;

-- 4) Estado para el gate/modal -----------------------------------------------
create or replace function public.ruleta_status()
returns table (
  active boolean,
  completed boolean,
  ruleta_id uuid,
  title text,
  segments jsonb,
  segment_index integer,
  prize_pool text,
  awarded_drop_ids text[],
  spun_at timestamptz
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
    s.active,
    a.user_id is not null as completed,
    r.id as ruleta_id,
    r.title,
    public.ruleta_public_segments(r.segments) as segments,
    a.segment_index,
    a.prize_pool,
    coalesce(a.awarded_drop_ids, '{}'::text[]) as awarded_drop_ids,
    a.spun_at
  from public.ruleta_settings s
  join public.ruletas r on r.id = s.active_ruleta_id
  left join public.ruleta_attempts a
    on a.ruleta_id = r.id and a.user_id = v_uid
  where s.id = true;
end;
$$;

-- 5) Giro: el servidor sortea (random ponderado), reclama el intento (uno por
-- usuario) y crea el sobre privado. Idempotente: si ya habia girado, devuelve el
-- resultado guardado.
create or replace function public.spin_ruleta(p_ruleta_id uuid)
returns table (
  ruleta_id uuid,
  segment_index integer,
  prize_pool text,
  awarded_drop_ids text[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ruleta public.ruletas%rowtype;
  v_total numeric := 0;
  v_roll numeric;
  v_acc numeric := 0;
  v_seg jsonb;
  v_idx integer;
  v_weight numeric;
  v_chosen_index integer := -1;
  v_chosen_pool text;
  v_label text;
  v_drop_id text;
  v_player_ids text[];
  v_awards text[] := '{}'::text[];
  v_inserted boolean := false;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  select r.* into v_ruleta
  from public.ruleta_settings s
  join public.ruletas r on r.id = s.active_ruleta_id
  where s.id = true
    and s.active is true
    and r.id = p_ruleta_id;

  if not found then
    raise exception 'La ruleta no esta activa';
  end if;

  select coalesce(sum(greatest((seg->>'weight')::numeric, 0)), 0)
  into v_total
  from jsonb_array_elements(v_ruleta.segments) as seg;

  if v_total <= 0 then
    raise exception 'Ruleta sin premios configurados';
  end if;

  v_roll := random() * v_total;
  for v_seg, v_idx in
    select value, (ordinality - 1)::integer
    from jsonb_array_elements(v_ruleta.segments) with ordinality
  loop
    v_weight := greatest((v_seg->>'weight')::numeric, 0);
    v_acc := v_acc + v_weight;
    if v_chosen_index < 0 and v_roll < v_acc then
      v_chosen_index := v_idx;
      v_chosen_pool := v_seg->>'pool';
    end if;
  end loop;

  -- Salvaguarda por redondeo: ultima casilla.
  if v_chosen_index < 0 then
    v_chosen_index := jsonb_array_length(v_ruleta.segments) - 1;
    v_chosen_pool := v_ruleta.segments -> v_chosen_index ->> 'pool';
  end if;

  insert into public.ruleta_attempts (
    ruleta_id, user_id, segment_index, prize_pool
  )
  values (
    v_ruleta.id, v_uid, v_chosen_index, v_chosen_pool
  )
  on conflict (ruleta_id, user_id) do nothing
  returning true into v_inserted;

  if not coalesce(v_inserted, false) then
    return query
    select a.ruleta_id, a.segment_index, a.prize_pool, a.awarded_drop_ids
    from public.ruleta_attempts a
    where a.ruleta_id = v_ruleta.id and a.user_id = v_uid;
    return;
  end if;

  if v_chosen_pool is not null then
    v_label := public.ruleta_pack_label(v_chosen_pool);
    v_drop_id := 'special-ruleta-' || v_chosen_pool || '-' || gen_random_uuid()::text;
    v_player_ids := public.ruleta_pick_player_ids(
      v_chosen_pool,
      'ruleta:' || v_ruleta.id::text || ':' || v_chosen_pool || ':' || v_uid::text
    );

    if coalesce(array_length(v_player_ids, 1), 0) >= 1 then
      insert into public.card_drops (
        id, kind, label, player_ids, available_at, created_by
      )
      values (
        v_drop_id, 'special', v_label, v_player_ids, now(), v_uid
      )
      on conflict (id) do nothing;

      v_awards := array_append(v_awards, v_drop_id);

      update public.ruleta_attempts
      set awarded_drop_ids = v_awards
      where ruleta_attempts.ruleta_id = v_ruleta.id
        and ruleta_attempts.user_id = v_uid;
    end if;
  end if;

  return query
  select v_ruleta.id, v_chosen_index, v_chosen_pool, v_awards;
end;
$$;

create or replace function public.spin_ruleta()
returns table (
  ruleta_id uuid,
  segment_index integer,
  prize_pool text,
  awarded_drop_ids text[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ruleta_id uuid;
begin
  select active_ruleta_id into v_ruleta_id
  from public.ruleta_settings
  where id = true;

  return query
  select * from public.spin_ruleta(v_ruleta_id);
end;
$$;

-- 6) Admin: estado, activar/pausar y stats -----------------------------------
create or replace function public.admin_ruleta_status()
returns table (
  active boolean,
  active_ruleta_id uuid,
  active_ruleta_title text,
  total_attempts bigint,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede ver el estado de la ruleta';
  end if;

  return query
  select
    s.active,
    s.active_ruleta_id,
    r.title as active_ruleta_title,
    (
      select count(*)
      from public.ruleta_attempts a
      where a.ruleta_id = s.active_ruleta_id
    ) as total_attempts,
    s.updated_at
  from public.ruleta_settings s
  left join public.ruletas r on r.id = s.active_ruleta_id
  where s.id = true;
end;
$$;

create or replace function public.admin_set_ruleta_active(
  p_active boolean,
  p_ruleta_id uuid default null
)
returns table (
  active boolean,
  active_ruleta_id uuid,
  active_ruleta_title text,
  total_attempts bigint,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ruleta_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede activar la ruleta';
  end if;

  select coalesce(
    p_ruleta_id,
    (select active_ruleta_id from public.ruleta_settings where id = true),
    (select id from public.ruletas order by created_at asc limit 1)
  )
  into v_ruleta_id;

  if coalesce(p_active, false) and v_ruleta_id is null then
    raise exception 'No hay ruleta para activar';
  end if;

  update public.ruleta_settings
  set
    active = coalesce(p_active, false),
    active_ruleta_id = coalesce(v_ruleta_id, active_ruleta_id),
    updated_by = v_uid,
    updated_at = now()
  where id = true;

  return query
  select * from public.admin_ruleta_status();
end;
$$;

create or replace function public.admin_ruleta_attempts(
  p_ruleta_id uuid default null
)
returns table (
  ruleta_id uuid,
  ruleta_title text,
  user_id uuid,
  display_name text,
  segment_index integer,
  prize_pool text,
  prize_label text,
  awarded_drop_ids text[],
  spun_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede ver los giros de la ruleta';
  end if;

  return query
  select
    a.ruleta_id,
    r.title as ruleta_title,
    a.user_id,
    coalesce(p.display_name, 'Usuario') as display_name,
    a.segment_index,
    a.prize_pool,
    public.ruleta_pack_label(a.prize_pool) as prize_label,
    a.awarded_drop_ids,
    a.spun_at
  from public.ruleta_attempts a
  join public.ruletas r on r.id = a.ruleta_id
  left join public.profiles p on p.id = a.user_id
  where p_ruleta_id is null or a.ruleta_id = p_ruleta_id
  order by a.spun_at desc
  limit 200;
end;
$$;

-- 7) Sobres de ruleta privados por usuario -----------------------------------
-- La policy actual solo ocultaba special-sobera-%, asi que un special-ruleta-%
-- seria visible para todos. Se amplia (lectura y apertura) para que el premio
-- sea privado de su dueño, igual que los del quiz.
drop policy if exists "available card drops read" on public.card_drops;
create policy "available card drops read" on public.card_drops
  for select using (
    (available_at <= now() or public.is_admin())
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

  if not found then
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

-- 8) Permisos ----------------------------------------------------------------
revoke all on function public.ruleta_pack_label(text) from public;
revoke all on function public.ruleta_public_segments(jsonb) from public;
revoke all on function public.ruleta_pick_player_ids(text, text) from public;
revoke all on function public.ruleta_status() from public;
revoke all on function public.spin_ruleta(uuid) from public;
revoke all on function public.spin_ruleta() from public;
revoke all on function public.admin_ruleta_status() from public;
revoke all on function public.admin_set_ruleta_active(boolean, uuid) from public;
revoke all on function public.admin_ruleta_attempts(uuid) from public;
revoke all on function public.open_card_drop(text) from public;

grant execute on function public.ruleta_status() to authenticated;
grant execute on function public.spin_ruleta(uuid) to authenticated;
grant execute on function public.spin_ruleta() to authenticated;
grant execute on function public.admin_ruleta_status() to authenticated;
grant execute on function public.admin_set_ruleta_active(boolean, uuid) to authenticated;
grant execute on function public.admin_ruleta_attempts(uuid) to authenticated;
grant execute on function public.open_card_drop(text) to authenticated;
