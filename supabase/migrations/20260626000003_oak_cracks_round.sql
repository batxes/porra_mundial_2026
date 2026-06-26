-- Segunda ronda Oak / Adivina el crack.
-- Se crea pausada y el admin puede activarla desde el panel.

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
        'answerLabel', item->>'answerLabel',
        'aliases',
          case
            when jsonb_typeof(item->'aliases') = 'array' then item->'aliases'
            else '[]'::jsonb
          end
      )
      order by ordinality
    ),
    '[]'::jsonb
  )
  from jsonb_array_elements(p_rounds) with ordinality as r(item, ordinality);
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
    if v_pool not in (
      'defensas',
      'medios',
      'delanteros',
      'stars',
      'madrid',
      'barcelona',
      'sub21',
      'francia',
      'premier'
    ) then
      raise exception 'Sobre de premio no valido';
    end if;
  end loop;
end;
$$;

insert into public.oak_quizzes (
  id,
  title,
  round_time_ms,
  rounds,
  rewards
)
values (
  '00000000-0000-0000-0000-0000000000b1'::uuid,
  'ADIVINA EL CRACK 2',
  10000,
  '[
    {
      "image": "/dembele.webp",
      "answerId": "fra-07",
      "answerLabel": "Dembele",
      "aliases": ["Ousmane Dembele", "Ousmane Dembélé", "Dembélé"]
    },
    {
      "image": "/julian.webp",
      "answerId": "arg-09",
      "answerLabel": "Julian Alvarez",
      "aliases": ["Julian", "Julián", "J. Alvarez", "Julián Alvarez"]
    },
    {
      "image": "/valverde.webp",
      "answerId": "uru-08",
      "answerLabel": "Fede Valverde",
      "aliases": ["Fede", "Federico Valverde", "F. Valverde"]
    },
    {
      "image": "/ferran.webp",
      "answerId": "esp-07",
      "answerLabel": "Ferran Torres",
      "aliases": ["Ferran"]
    }
  ]'::jsonb,
  '[
    { "minScore": 1, "pool": "defensas" },
    { "minScore": 2, "pool": "medios" },
    { "minScore": 4, "pool": "barcelona" }
  ]'::jsonb
)
on conflict (id) do update
set
  title = excluded.title,
  round_time_ms = excluded.round_time_ms,
  rounds = excluded.rounds,
  rewards = excluded.rewards,
  updated_at = now();

create or replace function public.admin_oak_quiz_list()
returns table (
  id uuid,
  title text,
  round_time_ms integer,
  rounds jsonb,
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
    raise exception 'Solo el administrador puede ver los quizzes de Oak';
  end if;

  return query
  select
    q.id,
    q.title,
    q.round_time_ms,
    public.oak_quiz_public_rounds(q.rounds) as rounds,
    public.oak_quiz_public_rewards(q.rewards) as rewards,
    q.created_at,
    q.updated_at,
    (coalesce(s.active, false) and s.active_quiz_id = q.id) as is_active,
    (
      select count(*)
      from public.oak_quiz_attempts a
      where a.quiz_id = q.id
    ) as total_attempts
  from public.oak_quizzes q
  left join public.oak_quiz_settings s on s.id = true
  order by
    (coalesce(s.active, false) and s.active_quiz_id = q.id) desc,
    q.created_at desc,
    q.title asc;
end;
$$;

revoke all on function public.admin_oak_quiz_list() from public;
grant execute on function public.admin_oak_quiz_list() to authenticated;
