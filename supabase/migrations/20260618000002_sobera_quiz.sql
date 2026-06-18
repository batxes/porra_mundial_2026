-- Quiz Sobera: activacion admin, intento unico por usuario y premios en sobres.
-- El cliente solo envia respuestas; el servidor recalcula la puntuacion y crea
-- drops privados sin abrir para que aparezcan en /cofres como sobres normales.

create table if not exists public.sobera_quiz_settings (
  id boolean primary key default true check (id),
  active boolean not null default false,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.sobera_quiz_settings (id, active)
values (true, false)
on conflict (id) do nothing;

create table if not exists public.sobera_quiz_attempts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  score integer not null check (score between 0 and 4),
  answers jsonb not null,
  awarded_drop_ids text[] not null default '{}'::text[],
  completed_at timestamptz not null default now()
);

alter table public.sobera_quiz_settings enable row level security;
alter table public.sobera_quiz_attempts enable row level security;

drop policy if exists "public sobera quiz settings read" on public.sobera_quiz_settings;
create policy "public sobera quiz settings read" on public.sobera_quiz_settings
  for select using (true);

drop policy if exists "owner sobera quiz attempt read" on public.sobera_quiz_attempts;
create policy "owner sobera quiz attempt read" on public.sobera_quiz_attempts
  for select using (auth.uid() = user_id or public.is_admin());

grant select on public.sobera_quiz_settings to anon, authenticated;
grant select on public.sobera_quiz_attempts to authenticated;
revoke insert, update, delete on public.sobera_quiz_settings from anon, authenticated;
revoke insert, update, delete on public.sobera_quiz_attempts from anon, authenticated;

-- Los drops del quiz son privados por usuario. Conservamos el comportamiento
-- actual del resto de drops, pero ocultamos special-sobera-* salvo a su owner.
drop policy if exists "available card drops read" on public.card_drops;
create policy "available card drops read" on public.card_drops
  for select using (
    (available_at <= now() or public.is_admin())
    and (
      id not like 'special-sobera-%'
      or created_by = auth.uid()
      or public.is_admin()
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
    or (v_drop.created_by is not null and v_drop.id not like 'special-%')
  ) and v_drop.created_by <> v_uid then
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

create or replace function public.sobera_quiz_status()
returns table (
  active boolean,
  completed boolean,
  score integer,
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
    s.active,
    a.user_id is not null as completed,
    a.score,
    coalesce(a.awarded_drop_ids, '{}'::text[]) as awarded_drop_ids,
    a.completed_at
  from public.sobera_quiz_settings s
  left join public.sobera_quiz_attempts a on a.user_id = v_uid
  where s.id = true;
end;
$$;

create or replace function public.admin_sobera_quiz_status()
returns table (
  active boolean,
  total_attempts bigint,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede ver el estado del quiz';
  end if;

  return query
  select
    s.active,
    (select count(*) from public.sobera_quiz_attempts) as total_attempts,
    s.updated_at
  from public.sobera_quiz_settings s
  where s.id = true;
end;
$$;

create or replace function public.admin_set_sobera_quiz_active(p_active boolean)
returns table (
  active boolean,
  total_attempts bigint,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede activar el quiz';
  end if;

  update public.sobera_quiz_settings
  set
    active = coalesce(p_active, false),
    updated_by = v_uid,
    updated_at = now()
  where id = true;

  return query
  select *
  from public.admin_sobera_quiz_status();
end;
$$;

create or replace function public.complete_sobera_quiz(p_answers jsonb)
returns table (
  score integer,
  awarded_drop_ids text[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_active boolean;
  v_correct integer[] := array[1, 2, 2, 1];
  v_score integer := 0;
  v_index integer;
  v_answer jsonb;
  v_pool text;
  v_label text;
  v_drop_id text;
  v_player_ids text[];
  v_reward_pools text[] := '{}'::text[];
  v_awards text[] := '{}'::text[];
  v_inserted boolean := false;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  select active into v_active
  from public.sobera_quiz_settings
  where id = true;

  if coalesce(v_active, false) is not true then
    raise exception 'El quiz no esta activo';
  end if;

  if p_answers is null
    or jsonb_typeof(p_answers) <> 'array'
    or jsonb_array_length(p_answers) <> 4
  then
    raise exception 'Respuestas invalidas';
  end if;

  for v_index, v_answer in
    select ordinality::integer, value
    from jsonb_array_elements(p_answers) with ordinality
  loop
    if jsonb_typeof(v_answer) = 'number'
      and (v_answer::text)::integer = v_correct[v_index]
    then
      v_score := v_score + 1;
    end if;
  end loop;

  insert into public.sobera_quiz_attempts (user_id, score, answers)
  values (v_uid, v_score, p_answers)
  on conflict (user_id) do nothing
  returning true into v_inserted;

  if not coalesce(v_inserted, false) then
    return query
    select a.score, a.awarded_drop_ids
    from public.sobera_quiz_attempts a
    where a.user_id = v_uid;
    return;
  end if;

  v_reward_pools := case
    when v_score >= 4 then array['defensas', 'medios', 'delanteros']::text[]
    when v_score >= 2 then array['defensas', 'medios']::text[]
    when v_score >= 1 then array['defensas']::text[]
    else '{}'::text[]
  end;

  foreach v_pool in array v_reward_pools
  loop
    v_label := case v_pool
      when 'defensas' then 'Sobre Defensas'
      when 'medios' then 'Sobre Mediocentros'
      when 'delanteros' then 'Sobre Delanteros'
      else 'Sobre especial'
    end;
    v_drop_id := 'special-sobera-' || v_pool || '-' || gen_random_uuid()::text;
    v_player_ids := public.card_pool_pick_many(
      v_pool,
      'sobera:' || v_pool || ':' || v_uid::text,
      1
    );

    if coalesce(array_length(v_player_ids, 1), 0) <> 1 then
      raise exception 'No hay jugadores suficientes para el premio %', v_label;
    end if;

    insert into public.card_drops (
      id,
      kind,
      label,
      player_ids,
      available_at,
      created_by
    )
    values (
      v_drop_id,
      'special',
      v_label,
      v_player_ids,
      now(),
      v_uid
    )
    on conflict (id) do nothing;

    v_awards := array_append(v_awards, v_drop_id);
  end loop;

  update public.sobera_quiz_attempts
  set awarded_drop_ids = v_awards
  where user_id = v_uid;

  return query
  select v_score, v_awards;
end;
$$;

revoke all on function public.sobera_quiz_status() from public;
revoke all on function public.admin_sobera_quiz_status() from public;
revoke all on function public.admin_set_sobera_quiz_active(boolean) from public;
revoke all on function public.complete_sobera_quiz(jsonb) from public;
revoke all on function public.open_card_drop(text) from public;

grant execute on function public.sobera_quiz_status() to authenticated;
grant execute on function public.admin_sobera_quiz_status() to authenticated;
grant execute on function public.admin_set_sobera_quiz_active(boolean) to authenticated;
grant execute on function public.complete_sobera_quiz(jsonb) to authenticated;
grant execute on function public.open_card_drop(text) to authenticated;
