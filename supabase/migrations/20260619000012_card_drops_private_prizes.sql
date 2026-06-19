-- Re-afirma la privacidad de los premios por-usuario en card_drops: los sobres
-- de quiz (special-sobera-%) y ruleta (special-ruleta-%) y los de forja (forge)
-- solo los puede LEER su dueño (created_by = auth.uid()), incluido el admin (el
-- bypass de is_admin() es solo para la disponibilidad, NO para la privacidad).
-- Los drops de admin globales (special-<uuid>) siguen visibles para todos.
-- Idéntica a la de 20260619000008; se re-crea por si en prod quedó una versión
-- anterior más permisiva (síntoma: a un usuario le aparecían premios de otros).
drop policy if exists "available card drops read" on public.card_drops;
create policy "available card drops read" on public.card_drops
  for select using (
    (available_at <= now() or public.is_admin())
    and (kind <> 'forge' or created_by = auth.uid())
    and (
      (id not like 'special-sobera-%' and id not like 'special-ruleta-%')
      or created_by = auth.uid()
    )
  );
