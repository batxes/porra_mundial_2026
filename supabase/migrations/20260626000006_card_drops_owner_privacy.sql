-- Re-afirma que los drops por usuario no se leen desde otras cuentas.
-- Los admin siguen pudiendo ver drops publicos de admin (`special-*`), pero no
-- sobres privados creados para otro usuario (`daily-*`, `barcelona-*`, etc.).

drop policy if exists "available card drops read" on public.card_drops;
create policy "available card drops read" on public.card_drops
  for select using (
    (available_at <= now() or public.is_admin())
    and (kind <> 'forge' or created_by = auth.uid())
    and (
      created_by is null
      or created_by = auth.uid()
      or (
        id like 'special-%'
        and id not like 'special-sobera-%'
        and id not like 'special-ruleta-%'
        and id not like 'special-oak-%'
        and id not like 'special-hoguera-%'
        and id not like 'special-suarez-%'
      )
    )
  );
