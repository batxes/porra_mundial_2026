"use client";

import { useEffect, useRef, useState } from "react";

import { CommunitySwapRow } from "@/components/common";
import { getSupabaseBrowserClient } from "@/lib/supabase";

type Fichaje = {
  id: string;
  inPlayerId: string;
  outPlayerId: string;
  pointsIn: number;
  pointsOut: number;
};

type FichajeRow = {
  id: string;
  in_player_id: string;
  out_player_id: string;
  points_in: number;
  points_out: number;
};

// Accordion con los fichajes (swaps) de un usuario, para el resumen del perfil:
// va justo debajo del once, que es a lo que afectan. Lee card_swaps (lectura
// pública en Supabase). En demo / sin Supabase no hay datos → no se muestra.
export function ProfileFichajes({ userId }: { userId: string }) {
  const [fichajes, setFichajes] = useState<Fichaje[]>([]);
  const detailsRef = useRef<HTMLDetailsElement | null>(null);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    let active = true;
    void (async () => {
      const { data: rows, error } = await supabase
        .from("card_swaps")
        .select(
          "id, in_player_id, out_player_id, points_in, points_out, created_at",
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(30);
      if (!active || error || !rows) return;
      setFichajes(
        (rows as FichajeRow[]).map((row) => ({
          id: row.id,
          inPlayerId: row.in_player_id,
          outPlayerId: row.out_player_id,
          pointsIn: Number(row.points_in) || 0,
          pointsOut: Number(row.points_out) || 0,
        })),
      );
    })();
    return () => {
      active = false;
    };
  }, [userId]);

  // Al llegar con #fichajes (desde un swap en la home o en /cofres) abrimos el
  // acordeón y hacemos scroll una vez que hay datos: el <details> solo existe en
  // el DOM cuando fichajes.length > 0, así que esperamos a que carguen.
  useEffect(() => {
    if (fichajes.length === 0) return;
    if (window.location.hash !== "#fichajes") return;
    const details = detailsRef.current;
    if (!details) return;
    details.open = true;
    details.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [fichajes]);

  if (fichajes.length === 0) return null;

  return (
    <details
      ref={detailsRef}
      id="fichajes"
      className="group overflow-hidden rounded-lg border border-white/10 bg-black/20"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-bold tracking-tight text-white">
            Fichajes
          </h3>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-bold text-zinc-300">
            {fichajes.length}
          </span>
        </div>
        <span className="shrink-0 text-xs font-bold text-zinc-500 transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="divide-y divide-white/[0.06] border-t border-white/[0.06] px-4">
        {fichajes.map((fichaje) => (
          // Mismo diseño que el item de cambio de la home / swaps de /cofres,
          // sin userName (es el dueño del perfil) ni enlace (ya estamos aquí).
          <CommunitySwapRow
            key={fichaje.id}
            inPlayerId={fichaje.inPlayerId}
            outPlayerId={fichaje.outPlayerId}
            pointsIn={fichaje.pointsIn}
            pointsOut={fichaje.pointsOut}
          />
        ))}
      </div>
    </details>
  );
}
