-- Ajusta los premios del segundo Oak a Defensas, Mediocentros y Barcelona.

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

update public.oak_quizzes
set
  rewards = '[
    { "minScore": 1, "pool": "defensas" },
    { "minScore": 2, "pool": "medios" },
    { "minScore": 4, "pool": "barcelona" }
  ]'::jsonb,
  updated_at = now()
where id = '00000000-0000-0000-0000-0000000000b1'::uuid;
