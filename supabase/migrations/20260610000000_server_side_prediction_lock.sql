-- Run this file once in the Supabase SQL editor, after the initial schema.
-- Moves prediction lock enforcement to the database so it no longer depends on the client clock.
-- Direct writes to public.predictions are revoked; the only write path is save_prediction(),
-- which freezes locked sections and started-match scores using the database clock (now()).

create table if not exists public.match_kickoffs (
  number integer primary key,
  kickoff timestamptz not null
);

insert into public.match_kickoffs (number, kickoff) values
  (1, '2026-06-11T19:00:00.000Z'),
  (2, '2026-06-12T02:00:00.000Z'),
  (3, '2026-06-12T19:00:00.000Z'),
  (4, '2026-06-13T01:00:00.000Z'),
  (5, '2026-06-14T01:00:00.000Z'),
  (6, '2026-06-14T04:00:00.000Z'),
  (7, '2026-06-13T22:00:00.000Z'),
  (8, '2026-06-13T19:00:00.000Z'),
  (9, '2026-06-14T23:00:00.000Z'),
  (10, '2026-06-14T17:00:00.000Z'),
  (11, '2026-06-14T20:00:00.000Z'),
  (12, '2026-06-15T02:00:00.000Z'),
  (13, '2026-06-15T22:00:00.000Z'),
  (14, '2026-06-15T16:00:00.000Z'),
  (15, '2026-06-16T01:00:00.000Z'),
  (16, '2026-06-15T19:00:00.000Z'),
  (17, '2026-06-16T19:00:00.000Z'),
  (18, '2026-06-16T22:00:00.000Z'),
  (19, '2026-06-17T01:00:00.000Z'),
  (20, '2026-06-17T04:00:00.000Z'),
  (21, '2026-06-17T23:00:00.000Z'),
  (22, '2026-06-17T20:00:00.000Z'),
  (23, '2026-06-17T17:00:00.000Z'),
  (24, '2026-06-18T02:00:00.000Z'),
  (25, '2026-06-18T16:00:00.000Z'),
  (26, '2026-06-18T19:00:00.000Z'),
  (27, '2026-06-18T22:00:00.000Z'),
  (28, '2026-06-19T01:00:00.000Z'),
  (29, '2026-06-20T00:30:00.000Z'),
  (30, '2026-06-19T22:00:00.000Z'),
  (31, '2026-06-20T03:00:00.000Z'),
  (32, '2026-06-19T19:00:00.000Z'),
  (33, '2026-06-20T20:00:00.000Z'),
  (34, '2026-06-21T00:00:00.000Z'),
  (35, '2026-06-20T17:00:00.000Z'),
  (36, '2026-06-21T04:00:00.000Z'),
  (37, '2026-06-21T22:00:00.000Z'),
  (38, '2026-06-21T16:00:00.000Z'),
  (39, '2026-06-21T19:00:00.000Z'),
  (40, '2026-06-22T01:00:00.000Z'),
  (41, '2026-06-23T00:00:00.000Z'),
  (42, '2026-06-22T21:00:00.000Z'),
  (43, '2026-06-22T17:00:00.000Z'),
  (44, '2026-06-23T03:00:00.000Z'),
  (45, '2026-06-23T20:00:00.000Z'),
  (46, '2026-06-23T23:00:00.000Z'),
  (47, '2026-06-23T17:00:00.000Z'),
  (48, '2026-06-24T02:00:00.000Z'),
  (49, '2026-06-24T22:00:00.000Z'),
  (50, '2026-06-24T22:00:00.000Z'),
  (51, '2026-06-24T19:00:00.000Z'),
  (52, '2026-06-24T19:00:00.000Z'),
  (53, '2026-06-25T01:00:00.000Z'),
  (54, '2026-06-25T01:00:00.000Z'),
  (55, '2026-06-25T20:00:00.000Z'),
  (56, '2026-06-25T20:00:00.000Z'),
  (57, '2026-06-25T23:00:00.000Z'),
  (58, '2026-06-25T23:00:00.000Z'),
  (59, '2026-06-26T02:00:00.000Z'),
  (60, '2026-06-26T02:00:00.000Z'),
  (61, '2026-06-26T19:00:00.000Z'),
  (62, '2026-06-26T19:00:00.000Z'),
  (63, '2026-06-27T03:00:00.000Z'),
  (64, '2026-06-27T03:00:00.000Z'),
  (65, '2026-06-27T00:00:00.000Z'),
  (66, '2026-06-27T00:00:00.000Z'),
  (67, '2026-06-27T21:00:00.000Z'),
  (68, '2026-06-27T21:00:00.000Z'),
  (69, '2026-06-28T02:00:00.000Z'),
  (70, '2026-06-28T02:00:00.000Z'),
  (71, '2026-06-27T23:30:00.000Z'),
  (72, '2026-06-27T23:30:00.000Z'),
  (73, '2026-06-28T19:00:00.000Z'),
  (74, '2026-06-29T20:30:00.000Z'),
  (75, '2026-06-30T01:00:00.000Z'),
  (76, '2026-06-29T17:00:00.000Z'),
  (77, '2026-06-30T21:00:00.000Z'),
  (78, '2026-06-30T17:00:00.000Z'),
  (79, '2026-07-01T01:00:00.000Z'),
  (80, '2026-07-01T16:00:00.000Z'),
  (81, '2026-07-02T00:00:00.000Z'),
  (82, '2026-07-01T20:00:00.000Z'),
  (83, '2026-07-02T23:00:00.000Z'),
  (84, '2026-07-02T19:00:00.000Z'),
  (85, '2026-07-03T03:00:00.000Z'),
  (86, '2026-07-03T22:00:00.000Z'),
  (87, '2026-07-04T01:30:00.000Z'),
  (88, '2026-07-03T18:00:00.000Z'),
  (89, '2026-07-04T21:00:00.000Z'),
  (90, '2026-07-04T17:00:00.000Z'),
  (91, '2026-07-05T20:00:00.000Z'),
  (92, '2026-07-06T00:00:00.000Z'),
  (93, '2026-07-06T19:00:00.000Z'),
  (94, '2026-07-07T00:00:00.000Z'),
  (95, '2026-07-07T16:00:00.000Z'),
  (96, '2026-07-07T20:00:00.000Z'),
  (97, '2026-07-09T20:00:00.000Z'),
  (98, '2026-07-10T19:00:00.000Z'),
  (99, '2026-07-11T21:00:00.000Z'),
  (100, '2026-07-12T01:00:00.000Z'),
  (101, '2026-07-14T19:00:00.000Z'),
  (102, '2026-07-15T19:00:00.000Z'),
  (103, '2026-07-18T21:00:00.000Z'),
  (104, '2026-07-19T19:00:00.000Z')
on conflict (number) do update set kickoff = excluded.kickoff;

alter table public.match_kickoffs enable row level security;
drop policy if exists "public kickoff read" on public.match_kickoffs;
create policy "public kickoff read" on public.match_kickoffs for select using (true);

create or replace function public.save_prediction(
  p_selections jsonb,
  p_completion integer,
  p_is_definitive boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_tournament_id uuid;
  v_lock_at timestamptz;
  v_exists boolean;
  v_old_selections jsonb;
  v_old_definitive boolean;
  v_merged jsonb;
  v_old_mp jsonb;
  v_new_mp jsonb;
  v_section text;
  v_key text;
  v_kick timestamptz;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  select id, predictions_lock_at into v_tournament_id, v_lock_at
  from public.tournaments where slug = 'world-cup-2026';
  if v_tournament_id is null then
    raise exception 'Torneo no encontrado';
  end if;

  select selections, is_definitive into v_old_selections, v_old_definitive
  from public.predictions where user_id = v_uid;
  v_exists := found;

  if coalesce(v_old_definitive, false) then
    raise exception 'La porra definitiva ya no admite cambios';
  end if;

  if not v_exists and now() >= v_lock_at then
    raise exception 'El plazo para crear la porra ya se ha cerrado';
  end if;

  v_old_selections := coalesce(v_old_selections, '{}'::jsonb);
  v_merged := coalesce(p_selections, '{}'::jsonb);

  if now() >= v_lock_at then
    foreach v_section in array array['groups', 'bracket', 'extras', 'xi', 'xiFormation'] loop
      if v_old_selections ? v_section then
        v_merged := jsonb_set(v_merged, array[v_section], v_old_selections -> v_section, true);
      else
        v_merged := v_merged - v_section;
      end if;
    end loop;
  end if;

  v_old_mp := coalesce(v_old_selections -> 'matchPredictions', '{}'::jsonb);
  v_new_mp := coalesce(v_merged -> 'matchPredictions', '{}'::jsonb);
  for v_key in
    select keys.k from (
      select jsonb_object_keys(v_new_mp) as k
      union
      select jsonb_object_keys(v_old_mp) as k
    ) keys
  loop
    if v_key ~ '^[0-9]+$' then
      select kickoff into v_kick from public.match_kickoffs where number = v_key::integer;
      if v_kick is not null and now() >= v_kick then
        if v_old_mp ? v_key then
          v_new_mp := jsonb_set(v_new_mp, array[v_key], v_old_mp -> v_key, true);
        else
          v_new_mp := v_new_mp - v_key;
        end if;
      end if;
    end if;
  end loop;
  v_merged := jsonb_set(v_merged, array['matchPredictions'], v_new_mp, true);

  insert into public.predictions (user_id, tournament_id, selections, completion_percent, is_definitive, updated_at)
  values (
    v_uid,
    v_tournament_id,
    v_merged,
    greatest(0, least(100, coalesce(p_completion, 0))),
    coalesce(p_is_definitive, false),
    now()
  )
  on conflict (user_id) do update set
    selections = excluded.selections,
    completion_percent = excluded.completion_percent,
    is_definitive = excluded.is_definitive,
    updated_at = excluded.updated_at;
end;
$$;

drop policy if exists "owner prediction insert before lock" on public.predictions;
drop policy if exists "owner prediction update before lock" on public.predictions;

revoke insert, update, delete on public.predictions from anon, authenticated;

revoke all on function public.save_prediction(jsonb, integer, boolean) from public;
grant execute on function public.save_prediction(jsonb, integer, boolean) to authenticated;
