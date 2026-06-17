"use client";

import { useEffect, useState } from "react";

import { PlayerAvatar } from "@/components/common";
import { playersById } from "@/lib/data";
import { getSupabaseBrowserClient } from "@/lib/supabase";

type Fichaje = {
  id: string;
  inPlayerId: string;
  outPlayerId: string;
};

type FichajeRow = {
  id: string;
  in_player_id: string;
  out_player_id: string;
};

// Accordion con los fichajes (swaps) de un usuario, para el resumen del perfil:
// va justo debajo del once, que es a lo que afectan. Lee card_swaps (lectura
// pública en Supabase). En demo / sin Supabase no hay datos → no se muestra.
export function ProfileFichajes({ userId }: { userId: string }) {
  const [fichajes, setFichajes] = useState<Fichaje[]>([]);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    let active = true;
    void (async () => {
      const { data: rows, error } = await supabase
        .from("card_swaps")
        .select("id, in_player_id, out_player_id, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(30);
      if (!active || error || !rows) return;
      setFichajes(
        (rows as FichajeRow[]).map((row) => ({
          id: row.id,
          inPlayerId: row.in_player_id,
          outPlayerId: row.out_player_id,
        })),
      );
    })();
    return () => {
      active = false;
    };
  }, [userId]);

  if (fichajes.length === 0) return null;

  return (
    <details className="group overflow-hidden rounded-lg border border-white/10 bg-black/20">
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
        {fichajes.map((fichaje) => {
          const inPlayer = playersById.get(fichaje.inPlayerId);
          const outPlayer = playersById.get(fichaje.outPlayerId);
          return (
            <div key={fichaje.id} className="flex items-center gap-3 py-2.5">
              {inPlayer ? (
                <PlayerAvatar
                  player={inPlayer}
                  className="size-8! text-[10px]"
                />
              ) : (
                <span className="size-8 shrink-0 rounded-full bg-white/5" />
              )}
              <span className="flex min-w-0 flex-col">
                <strong className="truncate text-sm font-semibold text-white">
                  {inPlayer?.name || "Jugador"}
                </strong>
                <span className="truncate text-xs text-zinc-500">
                  por {outPlayer?.name || "Jugador"}
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </details>
  );
}
