-- Limpieza de los sobres por puesto que estuvieron visibles por error como
-- automaticos. Los que no se han abierto se borran; los ya abiertos se respetan
-- para no eliminar cartas de usuarios.

delete from public.card_drops d
where d.kind = 'special'
  and (
    d.id like 'defensas-%'
    or d.id like 'medios-%'
    or d.id like 'delanteros-%'
  )
  and d.created_by is not null
  and not exists (
    select 1
    from public.user_cards uc
    where uc.drop_id = d.id
  );

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
    else 'Sobre especial'
  end;
  v_pid text;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  if p_pool in ('defensas', 'medios', 'delanteros') then
    raise exception 'Los sobres por puesto solo se abren como drops';
  end if;

  if p_pool not in ('stars', 'madrid', 'sub21', 'francia', 'premier') then
    raise exception 'Pool no valido';
  end if;

  v_drop_id := p_pool || '-' || v_day_key || '-' || v_uid::text;

  v_pid := coalesce(
    public.card_pool_pick(p_pool, 'themed:' || v_drop_id),
    public.card_any_pick('themed:' || v_drop_id)
  );

  if v_pid is null then
    raise exception 'No hay jugadores disponibles para el sobre';
  end if;

  insert into public.card_drops (id, kind, label, player_ids, available_at, created_by)
  values (v_drop_id, 'special', v_label, array[v_pid], v_day::timestamptz, v_uid)
  on conflict (id) do nothing;

  return query
  select * from public.open_card_drop(v_drop_id);
end;
$$;

revoke all on function public.open_themed_card_pack(text, date) from public;
grant execute on function public.open_themed_card_pack(text, date) to authenticated;
