-- Fix: "column reference \"ruleta_id\" is ambiguous" al GIRAR la ruleta.
-- En spin_ruleta(uuid), el INSERT en ruleta_attempts y su ON CONFLICT
-- (ruleta_id, user_id) usan ruleta_id, que colisiona con la columna de salida
-- ruleta_id del RETURNS TABLE (en plpgsql las columnas OUT son variables en
-- scope). Recreamos con `#variable_conflict use_column` (resuelve a la COLUMNA).
-- Cuerpo idéntico a 20260619000003; create-or-replace conserva los permisos.
-- Misma clase que 09/10 (quiz/ruleta active).
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
#variable_conflict use_column
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
