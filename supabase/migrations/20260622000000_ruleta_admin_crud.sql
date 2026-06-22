-- Ruleta: crear / listar / editar ruletas desde el admin (como el quiz de Sobera).
-- Probabilidades iguales: el peso de cada casilla es 1 (uniforme), asi la rueda
-- que se dibuja coincide con la probabilidad real. El admin solo elige el sobre
-- de cada casilla; pool null = "Casi" (sin premio).

-- ---- Validacion de casillas -------------------------------------------------
create or replace function public.ruleta_validate_segments(p_segments jsonb)
returns void
language plpgsql
stable
as $$
declare
  v_item jsonb;
  v_pool text;
  v_count integer;
begin
  if jsonb_typeof(p_segments) is distinct from 'array' then
    raise exception 'La ruleta debe tener casillas';
  end if;

  v_count := jsonb_array_length(p_segments);
  if v_count < 2 or v_count > 12 then
    raise exception 'La ruleta debe tener entre 2 y 12 casillas';
  end if;

  for v_item in
    select value from jsonb_array_elements(p_segments)
  loop
    if jsonb_typeof(v_item) is distinct from 'object' then
      raise exception 'Casilla invalida';
    end if;
    if jsonb_typeof(v_item->'pool') not in ('string', 'null') then
      raise exception 'Casilla invalida';
    end if;
    if jsonb_typeof(v_item->'pool') = 'string' then
      v_pool := v_item->>'pool';
      if v_pool not in (
        'defensas', 'medios', 'delanteros',
        'stars', 'madrid', 'sub21', 'francia', 'premier',
        'diario'
      ) then
        raise exception 'Sobre de casilla no valido';
      end if;
    end if;
  end loop;
end;
$$;

-- ---- Normaliza las casillas a {label, pool, weight:1} (peso uniforme) -------
create or replace function public.ruleta_build_segments(p_segments jsonb)
returns jsonb
language sql
stable
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'label', coalesce(
          nullif(trim(item->>'label'), ''),
          public.ruleta_pack_label(item->>'pool')
        ),
        'pool', item->'pool',
        'weight', 1
      )
      order by ordinality
    ),
    '[]'::jsonb
  )
  from jsonb_array_elements(p_segments) with ordinality as s(item, ordinality);
$$;

-- ---- admin_ruleta_list() ----------------------------------------------------
create or replace function public.admin_ruleta_list()
returns table (
  id uuid,
  title text,
  segments jsonb,
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
    raise exception 'Solo el administrador puede ver las ruletas';
  end if;

  return query
  select
    r.id,
    r.title,
    r.segments,
    r.created_at,
    r.updated_at,
    coalesce(s.active, false) and s.active_ruleta_id = r.id as is_active,
    (
      select count(*)
      from public.ruleta_attempts a
      where a.ruleta_id = r.id
    ) as total_attempts
  from public.ruletas r
  cross join public.ruleta_settings s
  where s.id = true
  order by r.created_at desc
  limit 20;
end;
$$;

-- ---- admin_save_ruleta(...) -------------------------------------------------
create or replace function public.admin_save_ruleta(
  p_title text,
  p_segments jsonb,
  p_activate boolean default false
)
returns table (
  id uuid,
  title text,
  segments jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  is_active boolean,
  total_attempts bigint
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_ruleta_id uuid;
  v_segments jsonb;
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede crear ruletas';
  end if;

  perform public.ruleta_validate_segments(p_segments);
  v_segments := public.ruleta_build_segments(p_segments);

  insert into public.ruletas (title, segments, created_by, updated_at)
  values (
    coalesce(nullif(trim(p_title), ''), 'RULETA DE SOBRES'),
    v_segments,
    v_uid,
    now()
  )
  returning ruletas.id into v_ruleta_id;

  if coalesce(p_activate, false) then
    update public.ruleta_settings
    set
      active = true,
      active_ruleta_id = v_ruleta_id,
      updated_by = v_uid,
      updated_at = now()
    where ruleta_settings.id = true;
  end if;

  return query
  select *
  from public.admin_ruleta_list() rl
  where rl.id = v_ruleta_id;
end;
$$;

-- ---- admin_update_ruleta(...) -----------------------------------------------
create or replace function public.admin_update_ruleta(
  p_ruleta_id uuid,
  p_title text,
  p_segments jsonb
)
returns table (
  id uuid,
  title text,
  segments jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  is_active boolean,
  total_attempts bigint
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_segments jsonb;
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede editar ruletas';
  end if;

  if p_ruleta_id is null or not exists (
    select 1 from public.ruletas r where r.id = p_ruleta_id
  ) then
    raise exception 'Ruleta no encontrada';
  end if;

  if exists (
    select 1
    from public.ruleta_settings s
    where s.id = true
      and s.active is true
      and s.active_ruleta_id = p_ruleta_id
  ) then
    raise exception 'Pausa la ruleta antes de editarla';
  end if;

  if exists (
    select 1
    from public.ruleta_attempts a
    where a.ruleta_id = p_ruleta_id
  ) then
    raise exception 'No se puede editar una ruleta con giros';
  end if;

  perform public.ruleta_validate_segments(p_segments);
  v_segments := public.ruleta_build_segments(p_segments);

  update public.ruletas
  set
    title = coalesce(nullif(trim(p_title), ''), 'RULETA DE SOBRES'),
    segments = v_segments,
    created_by = coalesce(created_by, v_uid),
    updated_at = now()
  where ruletas.id = p_ruleta_id;

  return query
  select *
  from public.admin_ruleta_list() rl
  where rl.id = p_ruleta_id;
end;
$$;

-- ---- revoke / grant ---------------------------------------------------------
revoke all on function public.ruleta_validate_segments(jsonb) from public;
revoke all on function public.ruleta_build_segments(jsonb) from public;
revoke all on function public.admin_ruleta_list() from public;
revoke all on function public.admin_save_ruleta(text, jsonb, boolean) from public;
revoke all on function public.admin_update_ruleta(uuid, text, jsonb) from public;

grant execute on function public.admin_ruleta_list() to authenticated;
grant execute on function public.admin_save_ruleta(text, jsonb, boolean) to authenticated;
grant execute on function public.admin_update_ruleta(uuid, text, jsonb) to authenticated;
