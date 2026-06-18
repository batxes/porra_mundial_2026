-- Rondas configurables del quiz Sobera.
-- Mantiene la activacion sencilla: una ronda activa como maximo, un intento por
-- usuario y por ronda, y premios calculados siempre en servidor.

create table if not exists public.sobera_quizzes (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'SOBRE EXTRA',
  question_time_ms integer not null default 10000 check (
    question_time_ms between 5000 and 30000
  ),
  questions jsonb not null,
  rewards jsonb not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sobera_quizzes enable row level security;

drop policy if exists "admin sobera quizzes read" on public.sobera_quizzes;
create policy "admin sobera quizzes read" on public.sobera_quizzes
  for select using (public.is_admin());

grant select on public.sobera_quizzes to authenticated;
revoke insert, update, delete on public.sobera_quizzes from anon, authenticated;

insert into public.sobera_quizzes (
  id,
  title,
  question_time_ms,
  questions,
  rewards
)
values (
  '00000000-0000-0000-0000-000000000001'::uuid,
  'SOBRE EXTRA',
  10000,
  '[
    {
      "question": "¿Quien fue el maximo goleador del Mundial de Francia 98?",
      "options": ["Ronaldo", "Davor Suker", "Christian Vieri", "Batistuta"],
      "correctIndex": 1
    },
    {
      "question": "¿En que año debuto Morata con la seleccion española?",
      "options": ["2012", "2013", "2014", "2015"],
      "correctIndex": 2
    },
    {
      "question": "¿Cuantos equipos ha descendido Lotina?",
      "options": ["3", "4", "5", "6"],
      "correctIndex": 2
    },
    {
      "question": "¿Que seleccion gano el Mundial 2022?",
      "options": ["Francia", "Argentina", "Croacia", "Brasil"],
      "correctIndex": 1
    }
  ]'::jsonb,
  '[
    { "minScore": 1, "pool": "defensas" },
    { "minScore": 2, "pool": "medios" },
    { "minScore": 4, "pool": "delanteros" }
  ]'::jsonb
)
on conflict (id) do nothing;

alter table public.sobera_quiz_settings
  add column if not exists active_quiz_id uuid
  references public.sobera_quizzes(id) on delete set null;

update public.sobera_quiz_settings
set active_quiz_id = '00000000-0000-0000-0000-000000000001'::uuid
where active_quiz_id is null;

alter table public.sobera_quiz_attempts
  add column if not exists quiz_id uuid
  references public.sobera_quizzes(id) on delete cascade;

update public.sobera_quiz_attempts
set quiz_id = '00000000-0000-0000-0000-000000000001'::uuid
where quiz_id is null;

alter table public.sobera_quiz_attempts
  alter column quiz_id set not null;

alter table public.sobera_quiz_attempts
  drop constraint if exists sobera_quiz_attempts_pkey;

alter table public.sobera_quiz_attempts
  add constraint sobera_quiz_attempts_pkey primary key (quiz_id, user_id);

create index if not exists sobera_quiz_attempts_completed_idx
  on public.sobera_quiz_attempts (completed_at desc);

create or replace function public.sobera_pack_label(p_pool text)
returns text
language sql
stable
as $$
  select case p_pool
    when 'stars' then 'Sobre Estrellas'
    when 'madrid' then 'Sobre Madrid'
    when 'sub21' then 'Sobre Promesas'
    when 'francia' then 'Sobre Francia'
    when 'premier' then 'Sobre Premier'
    when 'defensas' then 'Sobre Defensas'
    when 'medios' then 'Sobre Mediocentros'
    when 'delanteros' then 'Sobre Delanteros'
    else 'Sobre especial'
  end;
$$;

create or replace function public.sobera_quiz_validate_questions(p_questions jsonb)
returns void
language plpgsql
stable
as $$
declare
  v_item jsonb;
  v_option jsonb;
  v_options jsonb;
  v_correct integer;
begin
  if jsonb_typeof(p_questions) is distinct from 'array' then
    raise exception 'El quiz debe tener 4 preguntas';
  end if;
  if jsonb_array_length(p_questions) <> 4 then
    raise exception 'El quiz debe tener 4 preguntas';
  end if;

  for v_item in
    select value from jsonb_array_elements(p_questions)
  loop
    if jsonb_typeof(v_item) is distinct from 'object'
      or jsonb_typeof(v_item->'question') is distinct from 'string'
      or length(trim(v_item->>'question')) = 0
    then
      raise exception 'Pregunta invalida';
    end if;

    v_options := v_item->'options';
    if jsonb_typeof(v_options) is distinct from 'array' then
      raise exception 'Cada pregunta debe tener 4 respuestas';
    end if;
    if jsonb_array_length(v_options) <> 4 then
      raise exception 'Cada pregunta debe tener 4 respuestas';
    end if;

    for v_option in
      select value from jsonb_array_elements(v_options)
    loop
      if jsonb_typeof(v_option) is distinct from 'string'
        or length(trim(v_option #>> '{}')) = 0
      then
        raise exception 'Respuesta invalida';
      end if;
    end loop;

    if jsonb_typeof(v_item->'correctIndex') is distinct from 'number' then
      raise exception 'Falta la respuesta correcta';
    end if;
    v_correct := (v_item->>'correctIndex')::integer;
    if v_correct < 0 or v_correct > 3 then
      raise exception 'Respuesta correcta fuera de rango';
    end if;
  end loop;
end;
$$;

create or replace function public.sobera_quiz_validate_rewards(p_rewards jsonb)
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
  if jsonb_array_length(p_rewards) < 1
    or jsonb_array_length(p_rewards) > 6
  then
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
    if v_pool not in (
      'stars',
      'madrid',
      'sub21',
      'francia',
      'premier',
      'defensas',
      'medios',
      'delanteros'
    ) then
      raise exception 'Sobre de premio no valido';
    end if;
  end loop;
end;
$$;

create or replace function public.sobera_quiz_public_questions(p_questions jsonb)
returns jsonb
language sql
stable
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'question', item->>'question',
        'options', item->'options'
      )
      order by ordinality
    ),
    '[]'::jsonb
  )
  from jsonb_array_elements(p_questions) with ordinality as q(item, ordinality);
$$;

create or replace function public.sobera_quiz_public_rewards(p_rewards jsonb)
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

create or replace function public.sobera_quiz_correct_answers(p_questions jsonb)
returns integer[]
language sql
stable
as $$
  select coalesce(
    array_agg((item->>'correctIndex')::integer order by ordinality),
    '{}'::integer[]
  )
  from jsonb_array_elements(p_questions) with ordinality as q(item, ordinality);
$$;

create or replace function public.sobera_pick_reward_player_ids(
  p_pool text,
  p_seed text
)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pid text;
begin
  if p_pool in ('defensas', 'medios', 'delanteros') then
    return public.card_pool_pick_many(p_pool, p_seed, 1);
  end if;

  if p_pool in ('stars', 'madrid', 'sub21', 'francia', 'premier') then
    v_pid := coalesce(
      public.card_pool_pick(p_pool, p_seed),
      public.card_any_pick(p_seed)
    );
    if v_pid is null then
      return '{}'::text[];
    end if;
    return array[v_pid];
  end if;

  raise exception 'Sobre de premio no valido';
end;
$$;

create or replace function public.sobera_quiz_status()
returns table (
  active boolean,
  completed boolean,
  quiz_id uuid,
  title text,
  question_time_ms integer,
  questions jsonb,
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
    q.question_time_ms,
    public.sobera_quiz_public_questions(q.questions) as questions,
    public.sobera_quiz_public_rewards(q.rewards) as rewards,
    a.score,
    coalesce(a.awarded_drop_ids, '{}'::text[]) as awarded_drop_ids,
    a.completed_at
  from public.sobera_quiz_settings s
  join public.sobera_quizzes q on q.id = s.active_quiz_id
  left join public.sobera_quiz_attempts a
    on a.quiz_id = q.id and a.user_id = v_uid
  where s.id = true;
end;
$$;

create or replace function public.admin_sobera_quiz_status()
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
    raise exception 'Solo el administrador puede ver el estado del quiz';
  end if;

  return query
  select
    s.active,
    s.active_quiz_id,
    q.title as active_quiz_title,
    (
      select count(*)
      from public.sobera_quiz_attempts a
      where a.quiz_id = s.active_quiz_id
    ) as total_attempts,
    s.updated_at
  from public.sobera_quiz_settings s
  left join public.sobera_quizzes q on q.id = s.active_quiz_id
  where s.id = true;
end;
$$;

drop function if exists public.admin_set_sobera_quiz_active(boolean);

create or replace function public.admin_set_sobera_quiz_active(
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
declare
  v_uid uuid := auth.uid();
  v_quiz_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede activar el quiz';
  end if;

  select coalesce(
    p_quiz_id,
    (select active_quiz_id from public.sobera_quiz_settings where id = true),
    (select id from public.sobera_quizzes order by created_at desc limit 1)
  )
  into v_quiz_id;

  if coalesce(p_active, false) and v_quiz_id is null then
    raise exception 'No hay quiz para activar';
  end if;

  if v_quiz_id is not null and not exists (
    select 1 from public.sobera_quizzes q where q.id = v_quiz_id
  ) then
    raise exception 'Quiz no encontrado';
  end if;

  update public.sobera_quiz_settings
  set
    active = coalesce(p_active, false),
    active_quiz_id = coalesce(v_quiz_id, active_quiz_id),
    updated_by = v_uid,
    updated_at = now()
  where id = true;

  return query
  select *
  from public.admin_sobera_quiz_status();
end;
$$;

create or replace function public.admin_sobera_quiz_list()
returns table (
  id uuid,
  title text,
  question_time_ms integer,
  questions jsonb,
  rewards jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  is_active boolean,
  total_attempts bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede ver los quizzes';
  end if;

  return query
  select
    q.id,
    q.title,
    q.question_time_ms,
    q.questions,
    q.rewards,
    q.created_at,
    q.updated_at,
    coalesce(s.active, false) and s.active_quiz_id = q.id as is_active,
    (
      select count(*)
      from public.sobera_quiz_attempts a
      where a.quiz_id = q.id
    ) as total_attempts
  from public.sobera_quizzes q
  cross join public.sobera_quiz_settings s
  where s.id = true
  order by q.created_at desc
  limit 20;
end;
$$;

create or replace function public.admin_save_sobera_quiz(
  p_title text,
  p_questions jsonb,
  p_rewards jsonb,
  p_activate boolean default false
)
returns table (
  id uuid,
  title text,
  question_time_ms integer,
  questions jsonb,
  rewards jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  is_active boolean,
  total_attempts bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_quiz_id uuid;
  v_rewards jsonb := coalesce(
    p_rewards,
    '[
      { "minScore": 1, "pool": "defensas" },
      { "minScore": 2, "pool": "medios" },
      { "minScore": 4, "pool": "delanteros" }
    ]'::jsonb
  );
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede crear quizzes';
  end if;

  perform public.sobera_quiz_validate_questions(p_questions);
  perform public.sobera_quiz_validate_rewards(v_rewards);

  insert into public.sobera_quizzes (
    title,
    question_time_ms,
    questions,
    rewards,
    created_by,
    updated_at
  )
  values (
    coalesce(nullif(trim(p_title), ''), 'SOBRE EXTRA'),
    10000,
    p_questions,
    v_rewards,
    v_uid,
    now()
  )
  returning sobera_quizzes.id into v_quiz_id;

  if coalesce(p_activate, false) then
    update public.sobera_quiz_settings
    set
      active = true,
      active_quiz_id = v_quiz_id,
      updated_by = v_uid,
      updated_at = now()
    where id = true;
  end if;

  return query
  select *
  from public.admin_sobera_quiz_list() q
  where q.id = v_quiz_id;
end;
$$;

drop function if exists public.admin_sobera_quiz_attempts();

create or replace function public.admin_sobera_quiz_attempts(
  p_quiz_id uuid default null
)
returns table (
  quiz_id uuid,
  quiz_title text,
  user_id uuid,
  display_name text,
  score integer,
  answers jsonb,
  correct_answers integer[],
  awarded_drop_ids text[],
  completed_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede ver los intentos del quiz';
  end if;

  return query
  select
    a.quiz_id,
    q.title as quiz_title,
    a.user_id,
    coalesce(p.display_name, 'Usuario') as display_name,
    a.score,
    a.answers,
    public.sobera_quiz_correct_answers(q.questions) as correct_answers,
    a.awarded_drop_ids,
    a.completed_at
  from public.sobera_quiz_attempts a
  join public.sobera_quizzes q on q.id = a.quiz_id
  left join public.profiles p on p.id = a.user_id
  where p_quiz_id is null or a.quiz_id = p_quiz_id
  order by a.completed_at desc
  limit 200;
end;
$$;

create or replace function public.complete_sobera_quiz(
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
declare
  v_uid uuid := auth.uid();
  v_quiz public.sobera_quizzes%rowtype;
  v_correct integer[];
  v_answer_count integer;
  v_score integer := 0;
  v_index integer;
  v_answer jsonb;
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
  from public.sobera_quiz_settings s
  join public.sobera_quizzes q on q.id = s.active_quiz_id
  where s.id = true
    and s.active is true
    and q.id = p_quiz_id;

  if not found then
    raise exception 'El quiz no esta activo';
  end if;

  v_correct := public.sobera_quiz_correct_answers(v_quiz.questions);
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
    if jsonb_typeof(v_answer) = 'number'
      and (v_answer::text)::integer = v_correct[v_index]
    then
      v_score := v_score + 1;
    end if;
  end loop;

  insert into public.sobera_quiz_attempts (
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
    from public.sobera_quiz_attempts a
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
    v_drop_id := 'special-sobera-' || v_pool || '-' || gen_random_uuid()::text;
    v_player_ids := public.sobera_pick_reward_player_ids(
      v_pool,
      'sobera:' || v_quiz.id::text || ':' || v_pool || ':' || v_uid::text || ':' || v_reward_index::text
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
  where quiz_id = v_quiz.id and user_id = v_uid;

  return query
  select v_quiz.id, v_score, v_awards;
end;
$$;

create or replace function public.complete_sobera_quiz(p_answers jsonb)
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
  from public.sobera_quiz_settings
  where id = true;

  return query
  select *
  from public.complete_sobera_quiz(v_quiz_id, p_answers);
end;
$$;

revoke all on function public.sobera_pack_label(text) from public;
revoke all on function public.sobera_quiz_validate_questions(jsonb) from public;
revoke all on function public.sobera_quiz_validate_rewards(jsonb) from public;
revoke all on function public.sobera_quiz_public_questions(jsonb) from public;
revoke all on function public.sobera_quiz_public_rewards(jsonb) from public;
revoke all on function public.sobera_quiz_correct_answers(jsonb) from public;
revoke all on function public.sobera_pick_reward_player_ids(text, text) from public;
revoke all on function public.sobera_quiz_status() from public;
revoke all on function public.admin_sobera_quiz_status() from public;
revoke all on function public.admin_set_sobera_quiz_active(boolean, uuid) from public;
revoke all on function public.admin_sobera_quiz_list() from public;
revoke all on function public.admin_save_sobera_quiz(text, jsonb, jsonb, boolean) from public;
revoke all on function public.admin_sobera_quiz_attempts(uuid) from public;
revoke all on function public.complete_sobera_quiz(uuid, jsonb) from public;
revoke all on function public.complete_sobera_quiz(jsonb) from public;

grant execute on function public.sobera_quiz_status() to authenticated;
grant execute on function public.admin_sobera_quiz_status() to authenticated;
grant execute on function public.admin_set_sobera_quiz_active(boolean, uuid) to authenticated;
grant execute on function public.admin_sobera_quiz_list() to authenticated;
grant execute on function public.admin_save_sobera_quiz(text, jsonb, jsonb, boolean) to authenticated;
grant execute on function public.admin_sobera_quiz_attempts(uuid) to authenticated;
grant execute on function public.complete_sobera_quiz(uuid, jsonb) to authenticated;
grant execute on function public.complete_sobera_quiz(jsonb) to authenticated;
