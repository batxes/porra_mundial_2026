create or replace function public.admin_update_sobera_quiz(
  p_quiz_id uuid,
  p_title text,
  p_questions jsonb,
  p_rewards jsonb
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
    raise exception 'Solo el administrador puede editar quizzes';
  end if;

  if p_quiz_id is null or not exists (
    select 1 from public.sobera_quizzes q where q.id = p_quiz_id
  ) then
    raise exception 'Ronda no encontrada';
  end if;

  if exists (
    select 1
    from public.sobera_quiz_settings s
    where s.id = true
      and s.active is true
      and s.active_quiz_id = p_quiz_id
  ) then
    raise exception 'Pausa la ronda antes de editarla';
  end if;

  if exists (
    select 1
    from public.sobera_quiz_attempts a
    where a.quiz_id = p_quiz_id
  ) then
    raise exception 'No se puede editar una ronda con intentos';
  end if;

  perform public.sobera_quiz_validate_questions(p_questions);
  perform public.sobera_quiz_validate_rewards(v_rewards);

  update public.sobera_quizzes
  set
    title = coalesce(nullif(trim(p_title), ''), 'SOBRE EXTRA'),
    questions = p_questions,
    rewards = v_rewards,
    created_by = coalesce(created_by, v_uid),
    updated_at = now()
  where sobera_quizzes.id = p_quiz_id;

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
  where q.id = p_quiz_id
    and s.id = true;
end;
$$;

revoke all on function public.admin_update_sobera_quiz(uuid, text, jsonb, jsonb) from public;
grant execute on function public.admin_update_sobera_quiz(uuid, text, jsonb, jsonb) to authenticated;

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
  v_current_active_quiz_id uuid;
  v_current_active_title text;
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

  if coalesce(p_active, false) then
    select s.active_quiz_id, q.title
    into v_current_active_quiz_id, v_current_active_title
    from public.sobera_quiz_settings s
    left join public.sobera_quizzes q on q.id = s.active_quiz_id
    where s.id = true
      and s.active is true
      and s.active_quiz_id is not null;

    if v_current_active_quiz_id is not null
      and v_current_active_quiz_id <> v_quiz_id then
      raise exception 'Ya hay una ronda activa (%). Pausala antes de activar otra',
        coalesce(v_current_active_title, 'otra ronda');
    end if;
  end if;

  update public.sobera_quiz_settings
  set
    active = coalesce(p_active, false),
    active_quiz_id = coalesce(v_quiz_id, sobera_quiz_settings.active_quiz_id),
    updated_by = v_uid,
    updated_at = now()
  where id = true;

  return query
  select *
  from public.admin_sobera_quiz_status();
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
  v_active_title text;
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

  if coalesce(p_activate, false) and exists (
    select 1
    from public.sobera_quiz_settings s
    where s.id = true
      and s.active is true
      and s.active_quiz_id is not null
  ) then
    select q.title
    into v_active_title
    from public.sobera_quiz_settings s
    left join public.sobera_quizzes q on q.id = s.active_quiz_id
    where s.id = true
      and s.active is true
      and s.active_quiz_id is not null;

    raise exception 'Ya hay una ronda activa (%). Pausala antes de activar otra',
      coalesce(v_active_title, 'otra ronda');
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

revoke all on function public.admin_set_sobera_quiz_active(boolean, uuid) from public;
revoke all on function public.admin_save_sobera_quiz(text, jsonb, jsonb, boolean) from public;
grant execute on function public.admin_set_sobera_quiz_active(boolean, uuid) to authenticated;
grant execute on function public.admin_save_sobera_quiz(text, jsonb, jsonb, boolean) to authenticated;
