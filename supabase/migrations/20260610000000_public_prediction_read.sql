-- Public profiles show participant choices before and after the tournament lock.
drop policy if exists "owner or locked prediction read" on public.predictions;
drop policy if exists "public prediction read" on public.predictions;

create policy "public prediction read" on public.predictions
  for select
  using (true);
