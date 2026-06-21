-- Oak / Adivina el crack: activacion admin, intento unico por usuario y
-- premios privados segun aciertos.
--
-- Premios por umbral:
--   1 acierto  -> Sobre Delanteros
--   2 aciertos -> Sobre Defensas
--   4 aciertos -> Sobre Promesas

create table if not exists public.oak_quizzes (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'ADIVINA EL CRACK',
  round_time_ms integer not null default 10000 check (
    round_time_ms between 5000 and 30000
  ),
  rounds jsonb not null,
  rewards jsonb not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.oak_quiz_settings (
  id boolean primary key default true check (id),
  active boolean not null default false,
  active_quiz_id uuid references public.oak_quizzes(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.oak_quiz_attempts (
  quiz_id uuid not null references public.oak_quizzes(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  score integer not null check (score between 0 and 4),
  answers jsonb not null,
  awarded_drop_ids text[] not null default '{}'::text[],
  completed_at timestamptz not null default now(),
  primary key (quiz_id, user_id)
);

create index if not exists oak_quiz_attempts_completed_idx
  on public.oak_quiz_attempts (completed_at desc);

alter table public.oak_quizzes enable row level security;
alter table public.oak_quiz_settings enable row level security;
alter table public.oak_quiz_attempts enable row level security;

drop policy if exists "public oak quiz settings read" on public.oak_quiz_settings;
create policy "public oak quiz settings read" on public.oak_quiz_settings
  for select using (true);

drop policy if exists "admin oak quizzes read" on public.oak_quizzes;
create policy "admin oak quizzes read" on public.oak_quizzes
  for select using (public.is_admin());

drop policy if exists "owner oak quiz attempt read" on public.oak_quiz_attempts;
create policy "owner oak quiz attempt read" on public.oak_quiz_attempts
  for select using (auth.uid() = user_id or public.is_admin());

grant select on public.oak_quiz_settings to anon, authenticated;
grant select on public.oak_quizzes to authenticated;
grant select on public.oak_quiz_attempts to authenticated;
revoke insert, update, delete on public.oak_quizzes from anon, authenticated;
revoke insert, update, delete on public.oak_quiz_settings from anon, authenticated;
revoke insert, update, delete on public.oak_quiz_attempts from anon, authenticated;

insert into public.oak_quizzes (
  id,
  title,
  round_time_ms,
  rounds,
  rewards
)
values (
  '00000000-0000-0000-0000-0000000000a2'::uuid,
  'ADIVINA EL CRACK',
  10000,
  '[
    { "image": "/messi.webp",   "answerId": "arg-10", "answerLabel": "Messi" },
    { "image": "/mbappe.webp",  "answerId": "fra-10", "answerLabel": "Mbappe" },
    { "image": "/halland.webp", "answerId": "nor-09", "answerLabel": "Haaland" },
    { "image": "/courtois.webp","answerId": "bel-01", "answerLabel": "Courtois" }
  ]'::jsonb,
  '[
    { "minScore": 1, "pool": "delanteros" },
    { "minScore": 2, "pool": "defensas" },
    { "minScore": 4, "pool": "sub21" }
  ]'::jsonb
)
on conflict (id) do nothing;

insert into public.oak_quiz_settings (id, active, active_quiz_id)
values (true, false, '00000000-0000-0000-0000-0000000000a2'::uuid)
on conflict (id) do nothing;

create or replace function public.oak_quiz_validate_rounds(p_rounds jsonb)
returns void
language plpgsql
stable
as $$
declare
  v_item jsonb;
begin
  if jsonb_typeof(p_rounds) is distinct from 'array' then
    raise exception 'Oak debe tener 4 rondas';
  end if;
  if jsonb_array_length(p_rounds) <> 4 then
    raise exception 'Oak debe tener 4 rondas';
  end if;

  for v_item in
    select value from jsonb_array_elements(p_rounds)
  loop
    if jsonb_typeof(v_item) is distinct from 'object'
      or jsonb_typeof(v_item->'image') is distinct from 'string'
      or jsonb_typeof(v_item->'answerId') is distinct from 'string'
      or length(trim(v_item->>'image')) = 0
      or length(trim(v_item->>'answerId')) = 0
    then
      raise exception 'Ronda de Oak invalida';
    end if;
  end loop;
end;
$$;

create or replace function public.oak_quiz_validate_rewards(p_rewards jsonb)
returns void
language plpgsql
stable
as $$
declare
  v_reward jsonb;
  v_min_score integer;
  v_pool text;
begin
  if jsonb_typeof(p_rewards) is distinct from 'array' then
    raise exception 'Premios invalidos';
  end if;
  if jsonb_array_length(p_rewards) < 1 or jsonb_array_length(p_rewards) > 6 then
    raise exception 'Premios invalidos';
  end if;

  for v_reward in
    select value from jsonb_array_elements(p_rewards)
  loop
    if jsonb_typeof(v_reward) is distinct from 'object'
      or jsonb_typeof(v_reward->'minScore') is distinct from 'number'
      or jsonb_typeof(v_reward->'pool') is distinct from 'string'
    then
      raise exception 'Premio invalido';
    end if;

    v_min_score := (v_reward->>'minScore')::integer;
    v_pool := v_reward->>'pool';

    if v_min_score < 1 or v_min_score > 4 then
      raise exception 'Aciertos de premio fuera de rango';
    end if;
    if v_pool not in ('delanteros', 'defensas', 'sub21') then
      raise exception 'Sobre de premio no valido';
    end if;
  end loop;
end;
$$;

create or replace function public.oak_quiz_public_rounds(p_rounds jsonb)
returns jsonb
language sql
stable
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'image', item->>'image',
        'answerId', item->>'answerId',
        'answerLabel', item->>'answerLabel'
      )
      order by ordinality
    ),
    '[]'::jsonb
  )
  from jsonb_array_elements(p_rounds) with ordinality as r(item, ordinality);
$$;

create or replace function public.oak_quiz_public_rewards(p_rewards jsonb)
returns jsonb
language sql
stable
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'minScore', (item->>'minScore')::integer,
        'pool', item->>'pool',
        'title', public.sobera_pack_label(item->>'pool')
      )
      order by ordinality
    ),
    '[]'::jsonb
  )
  from jsonb_array_elements(p_rewards) with ordinality as r(item, ordinality);
$$;

create or replace function public.oak_quiz_correct_answers(p_rounds jsonb)
returns text[]
language sql
stable
as $$
  select coalesce(
    array_agg(item->>'answerId' order by ordinality),
    '{}'::text[]
  )
  from jsonb_array_elements(p_rounds) with ordinality as r(item, ordinality);
$$;

create or replace function public.oak_quiz_status()
returns table (
  active boolean,
  completed boolean,
  quiz_id uuid,
  title text,
  round_time_ms integer,
  rounds jsonb,
  rewards jsonb,
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
    q.id as quiz_id,
    q.title,
    q.round_time_ms,
    public.oak_quiz_public_rounds(q.rounds) as rounds,
    public.oak_quiz_public_rewards(q.rewards) as rewards,
    a.score,
    coalesce(a.awarded_drop_ids, '{}'::text[]) as awarded_drop_ids,
    a.completed_at
  from public.oak_quiz_settings s
  join public.oak_quizzes q on q.id = s.active_quiz_id
  left join public.oak_quiz_attempts a
    on a.quiz_id = q.id and a.user_id = v_uid
  where s.id = true;
end;
$$;

create or replace function public.admin_oak_quiz_status()
returns table (
  active boolean,
  active_quiz_id uuid,
  active_quiz_title text,
  total_attempts bigint,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede ver el estado de Oak';
  end if;

  return query
  select
    s.active,
    s.active_quiz_id,
    q.title as active_quiz_title,
    (
      select count(*)
      from public.oak_quiz_attempts a
      where a.quiz_id = s.active_quiz_id
    ) as total_attempts,
    s.updated_at
  from public.oak_quiz_settings s
  left join public.oak_quizzes q on q.id = s.active_quiz_id
  where s.id = true;
end;
$$;

create or replace function public.admin_set_oak_quiz_active(
  p_active boolean,
  p_quiz_id uuid default null
)
returns table (
  active boolean,
  active_quiz_id uuid,
  active_quiz_title text,
  total_attempts bigint,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_quiz_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede activar Oak';
  end if;

  select coalesce(
    p_quiz_id,
    (select active_quiz_id from public.oak_quiz_settings where id = true),
    (select id from public.oak_quizzes order by created_at asc limit 1)
  )
  into v_quiz_id;

  if coalesce(p_active, false) and v_quiz_id is null then
    raise exception 'No hay quiz de Oak para activar';
  end if;

  if v_quiz_id is not null and not exists (
    select 1 from public.oak_quizzes q where q.id = v_quiz_id
  ) then
    raise exception 'Quiz de Oak no encontrado';
  end if;

  update public.oak_quiz_settings
  set
    active = coalesce(p_active, false),
    active_quiz_id = coalesce(v_quiz_id, oak_quiz_settings.active_quiz_id),
    updated_by = v_uid,
    updated_at = now()
  where id = true;

  return query
  select * from public.admin_oak_quiz_status();
end;
$$;

create or replace function public.admin_oak_quiz_attempts(
  p_quiz_id uuid default null
)
returns table (
  quiz_id uuid,
  quiz_title text,
  user_id uuid,
  display_name text,
  score integer,
  answers jsonb,
  correct_answers text[],
  awarded_drop_ids text[],
  completed_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede ver los intentos de Oak';
  end if;

  return query
  select
    a.quiz_id,
    q.title as quiz_title,
    a.user_id,
    coalesce(p.display_name, 'Usuario') as display_name,
    a.score,
    a.answers,
    public.oak_quiz_correct_answers(q.rounds) as correct_answers,
    a.awarded_drop_ids,
    a.completed_at
  from public.oak_quiz_attempts a
  join public.oak_quizzes q on q.id = a.quiz_id
  left join public.profiles p on p.id = a.user_id
  where p_quiz_id is null or a.quiz_id = p_quiz_id
  order by a.completed_at desc
  limit 200;
end;
$$;

create or replace function public.complete_oak_quiz(
  p_quiz_id uuid,
  p_answers jsonb
)
returns table (
  quiz_id uuid,
  score integer,
  awarded_drop_ids text[]
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_quiz public.oak_quizzes%rowtype;
  v_correct text[];
  v_answer_count integer;
  v_score integer := 0;
  v_index integer;
  v_answer jsonb;
  v_answer_id text;
  v_reward jsonb;
  v_reward_index integer;
  v_min_score integer;
  v_pool text;
  v_label text;
  v_drop_id text;
  v_player_ids text[];
  v_awards text[] := '{}'::text[];
  v_inserted boolean := false;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  select q.* into v_quiz
  from public.oak_quiz_settings s
  join public.oak_quizzes q on q.id = s.active_quiz_id
  where s.id = true
    and s.active is true
    and q.id = p_quiz_id;

  if not found then
    raise exception 'Oak no esta activo';
  end if;

  perform public.oak_quiz_validate_rounds(v_quiz.rounds);
  perform public.oak_quiz_validate_rewards(v_quiz.rewards);

  v_correct := public.oak_quiz_correct_answers(v_quiz.rounds);
  v_answer_count := coalesce(array_length(v_correct, 1), 0);

  if p_answers is null
    or jsonb_typeof(p_answers) <> 'array'
    or jsonb_array_length(p_answers) <> v_answer_count
  then
    raise exception 'Respuestas invalidas';
  end if;

  for v_index, v_answer in
    select ordinality::integer, value
    from jsonb_array_elements(p_answers) with ordinality
  loop
    v_answer_id := null;
    if jsonb_typeof(v_answer) = 'string' then
      v_answer_id := v_answer #>> '{}';
    end if;
    if v_answer_id = v_correct[v_index] then
      v_score := v_score + 1;
    end if;
  end loop;

  insert into public.oak_quiz_attempts (
    quiz_id,
    user_id,
    score,
    answers
  )
  values (
    v_quiz.id,
    v_uid,
    v_score,
    p_answers
  )
  on conflict (quiz_id, user_id) do nothing
  returning true into v_inserted;

  if not coalesce(v_inserted, false) then
    return query
    select a.quiz_id, a.score, a.awarded_drop_ids
    from public.oak_quiz_attempts a
    where a.quiz_id = v_quiz.id and a.user_id = v_uid;
    return;
  end if;

  for v_reward, v_reward_index in
    select value, ordinality::integer
    from jsonb_array_elements(v_quiz.rewards) with ordinality
  loop
    v_min_score := (v_reward->>'minScore')::integer;
    v_pool := v_reward->>'pool';

    if v_score < v_min_score then
      continue;
    end if;

    v_label := public.sobera_pack_label(v_pool);
    v_drop_id := 'special-oak-' || v_pool || '-' || gen_random_uuid()::text;
    v_player_ids := public.sobera_pick_reward_player_ids(
      v_pool,
      'oak:' || v_quiz.id::text || ':' || v_pool || ':' || v_uid::text || ':' || v_reward_index::text
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

  update public.oak_quiz_attempts
  set awarded_drop_ids = v_awards
  where oak_quiz_attempts.quiz_id = v_quiz.id
    and oak_quiz_attempts.user_id = v_uid;

  return query
  select v_quiz.id, v_score, v_awards;
end;
$$;

create or replace function public.complete_oak_quiz(p_answers jsonb)
returns table (
  quiz_id uuid,
  score integer,
  awarded_drop_ids text[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quiz_id uuid;
begin
  select active_quiz_id into v_quiz_id
  from public.oak_quiz_settings
  where id = true;

  return query
  select * from public.complete_oak_quiz(v_quiz_id, p_answers);
end;
$$;

drop policy if exists "available card drops read" on public.card_drops;
create policy "available card drops read" on public.card_drops
  for select using (
    (available_at <= now() or public.is_admin())
    and (kind <> 'forge' or created_by = auth.uid())
    and (
      (
        id not like 'special-sobera-%'
        and id not like 'special-ruleta-%'
        and id not like 'special-oak-%'
      )
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
    or v_drop.id like 'special-oak-%'
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

revoke all on function public.oak_quiz_validate_rounds(jsonb) from public;
revoke all on function public.oak_quiz_validate_rewards(jsonb) from public;
revoke all on function public.oak_quiz_public_rounds(jsonb) from public;
revoke all on function public.oak_quiz_public_rewards(jsonb) from public;
revoke all on function public.oak_quiz_correct_answers(jsonb) from public;
revoke all on function public.oak_quiz_status() from public;
revoke all on function public.admin_oak_quiz_status() from public;
revoke all on function public.admin_set_oak_quiz_active(boolean, uuid) from public;
revoke all on function public.admin_oak_quiz_attempts(uuid) from public;
revoke all on function public.complete_oak_quiz(uuid, jsonb) from public;
revoke all on function public.complete_oak_quiz(jsonb) from public;
revoke all on function public.open_card_drop(text) from public;

grant execute on function public.oak_quiz_status() to authenticated;
grant execute on function public.admin_oak_quiz_status() to authenticated;
grant execute on function public.admin_set_oak_quiz_active(boolean, uuid) to authenticated;
grant execute on function public.admin_oak_quiz_attempts(uuid) to authenticated;
grant execute on function public.complete_oak_quiz(uuid, jsonb) to authenticated;
grant execute on function public.complete_oak_quiz(jsonb) to authenticated;
grant execute on function public.open_card_drop(text) to authenticated;
