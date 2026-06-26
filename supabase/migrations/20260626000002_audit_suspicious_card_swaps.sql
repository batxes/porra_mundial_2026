-- Auditoria admin de swaps hechos durante la ventana peligrosa:
-- desde que empieza un partido del equipo del jugador hasta que se valida.

create or replace function public.admin_suspicious_card_swaps()
returns table (
  swap_id uuid,
  user_id uuid,
  user_name text,
  created_at timestamptz,
  affected_side text,
  player_id text,
  player_name text,
  team_id text,
  match_number integer,
  kickoff timestamptz,
  match_status text,
  validated_at timestamptz,
  in_player_id text,
  in_player_name text,
  out_player_id text,
  out_player_name text,
  points_in integer,
  points_out integer,
  delta integer
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'Solo el admin puede revisar swaps sospechosos';
  end if;

  return query
  with swap_players as (
    select
      s.id as swap_id,
      s.user_id,
      s.created_at,
      s.in_player_id,
      s.out_player_id,
      s.points_in,
      s.points_out,
      s.delta,
      'entra'::text as affected_side,
      p_in.id as player_id,
      p_in.display_name as player_name,
      p_in.team_id
    from public.card_swaps s
    join public.players p_in on p_in.id = s.in_player_id

    union all

    select
      s.id as swap_id,
      s.user_id,
      s.created_at,
      s.in_player_id,
      s.out_player_id,
      s.points_in,
      s.points_out,
      s.delta,
      'sale'::text as affected_side,
      p_out.id as player_id,
      p_out.display_name as player_name,
      p_out.team_id
    from public.card_swaps s
    join public.players p_out on p_out.id = s.out_player_id
  ),
  lock_windows as (
    select
      lt.team_id,
      lt.number as match_number,
      k.kickoff,
      m.status as match_status,
      m.validated_at
    from public.match_lock_teams lt
    join public.match_kickoffs k on k.number = lt.number
    left join public.matches m on m.id = 'wc26-' || lt.number::text

    union all

    select
      p.team_id,
      case
        when replace(m.id, 'wc26-', '') ~ '^[0-9]+$'
          then replace(m.id, 'wc26-', '')::integer
        else null
      end as match_number,
      m.scheduled_at as kickoff,
      m.status as match_status,
      m.validated_at
    from public.matches m
    join public.players p on p.team_id in (m.home_team_id, m.away_team_id)
    where m.id like 'wc26-%'
      and replace(m.id, 'wc26-', '') ~ '^[0-9]+$'
  )
  select distinct
    sp.swap_id,
    sp.user_id,
    coalesce(pr.display_name, 'Jugador') as user_name,
    sp.created_at,
    sp.affected_side,
    sp.player_id,
    sp.player_name,
    sp.team_id,
    lw.match_number,
    lw.kickoff,
    coalesce(lw.match_status, 'sin_resultado') as match_status,
    lw.validated_at,
    sp.in_player_id,
    p_in.display_name as in_player_name,
    sp.out_player_id,
    p_out.display_name as out_player_name,
    sp.points_in,
    sp.points_out,
    sp.delta
  from swap_players sp
  join lock_windows lw on lw.team_id = sp.team_id
  left join public.profiles pr on pr.id = sp.user_id
  join public.players p_in on p_in.id = sp.in_player_id
  join public.players p_out on p_out.id = sp.out_player_id
  where sp.created_at >= lw.kickoff
    and sp.created_at < coalesce(lw.validated_at, 'infinity'::timestamptz)
  order by sp.created_at desc, sp.swap_id, sp.affected_side;
end;
$$;

revoke all on function public.admin_suspicious_card_swaps() from public;
grant execute on function public.admin_suspicious_card_swaps() to authenticated;
