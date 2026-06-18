-- Ajuste de balance: los sobres por puesto dan 1 carta.
-- Se deja card_pool_pick_many intacta porque tambien la usan helpers genericos;
-- las funciones publicas de sobres por puesto pasan p_count = 1.

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
    when 'defensas' then 'Sobre Defensas'
    when 'medios' then 'Sobre Mediocentros'
    when 'delanteros' then 'Sobre Delanteros'
    else 'Sobre especial'
  end;
  v_player_ids text[];
  v_pid text;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;
  if p_pool not in (
    'stars',
    'madrid',
    'sub21',
    'francia',
    'premier',
    'defensas',
    'medios',
    'delanteros'
  ) then
    raise exception 'Pool no valido';
  end if;
  v_drop_id := p_pool || '-' || v_day_key || '-' || v_uid::text;

  if p_pool in ('defensas', 'medios', 'delanteros') then
    v_player_ids := public.card_pool_pick_many(p_pool, 'themed:' || v_drop_id, 1);
  else
    v_pid := coalesce(
      public.card_pool_pick(p_pool, 'themed:' || v_drop_id),
      public.card_any_pick('themed:' || v_drop_id)
    );
    v_player_ids := array[v_pid];
  end if;

  if coalesce(array_length(v_player_ids, 1), 0) = 0 then
    raise exception 'No hay jugadores disponibles para el sobre';
  end if;

  insert into public.card_drops (id, kind, label, player_ids, available_at, created_by)
  values (v_drop_id, 'special', v_label, v_player_ids, v_day::timestamptz, v_uid)
  on conflict (id) do nothing;

  return query
  select * from public.open_card_drop(v_drop_id);
end;
$$;

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
#variable_conflict use_column
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

  if p_pool in ('defensas', 'medios', 'delanteros') then
    v_player_ids := public.card_pool_pick_many(p_pool, 'special:' || v_drop_id, 1);
  elsif p_pool in ('stars', 'madrid', 'sub21', 'francia', 'premier') then
    v_pid := coalesce(
      public.card_pool_pick(p_pool, 'special:' || v_drop_id),
      public.card_any_pick('special:' || v_drop_id)
    );
    v_player_ids := array[v_pid];
  else
    v_player_ids := public.daily_pack_player_ids('special:' || v_drop_id);
  end if;

  if coalesce(array_length(v_player_ids, 1), 0) = 0 then
    raise exception 'No hay jugadores disponibles para el sobre';
  end if;

  insert into public.card_drops (id, kind, label, player_ids, created_by)
  values (v_drop_id, 'special', v_label, v_player_ids, v_uid);

  return query
  select d.id, d.kind, d.label, d.player_ids, d.available_at, d.created_at
  from public.card_drops d
  where d.id = v_drop_id;
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

revoke all on function public.open_themed_card_pack(text, date) from public;
revoke all on function public.admin_create_card_drop(text, text) from public;
revoke all on function public.complete_sobera_quiz(jsonb) from public;

grant execute on function public.open_themed_card_pack(text, date) to authenticated;
grant execute on function public.admin_create_card_drop(text, text) to authenticated;
grant execute on function public.complete_sobera_quiz(jsonb) to authenticated;
