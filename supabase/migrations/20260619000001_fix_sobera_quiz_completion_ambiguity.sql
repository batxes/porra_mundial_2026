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
    where a.quiz_id = v_quiz.id
      and a.user_id = v_uid;
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
  where sobera_quiz_attempts.quiz_id = v_quiz.id
    and sobera_quiz_attempts.user_id = v_uid;

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
  select s.active_quiz_id into v_quiz_id
  from public.sobera_quiz_settings s
  where s.id = true;

  return query
  select result.quiz_id, result.score, result.awarded_drop_ids
  from public.complete_sobera_quiz(v_quiz_id, p_answers) result;
end;
$$;

revoke all on function public.complete_sobera_quiz(uuid, jsonb) from public;
revoke all on function public.complete_sobera_quiz(jsonb) from public;
grant execute on function public.complete_sobera_quiz(uuid, jsonb) to authenticated;
grant execute on function public.complete_sobera_quiz(jsonb) to authenticated;
