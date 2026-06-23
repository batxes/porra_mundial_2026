"use client";

import { useState } from "react";

import {
  HogueraModal,
  type HogueraConfig,
  type HogueraResult,
} from "@/components/hoguera-modal";

// Config de demo: en prod vendra de Supabase/admin (mismos premios que la
// migracion 20260623000000_hoguera.sql). Aqui es local para validar.
// 100 m, una hoguera cada 5 m, y un sobre bancado cada 25 m (4 en total).
const DEMO_CONFIG: HogueraConfig = {
  id: "demo-hoguera-1",
  title: "SALTA LA HOGUERA",
  goalMeters: 100,
  flameEveryMeters: 5,
  rewards: [
    { meters: 25, image: "/sobre-defensas.webp", title: "Sobre Defensas", pool: "defensas" },
    { meters: 50, image: "/sobre-medios.webp", title: "Sobre Mediocentros", pool: "medios" },
    { meters: 75, image: "/sobre-premier.webp", title: "Sobre Premier", pool: "premier" },
    { meters: 100, image: "/sobre21.webp", title: "Sobre Promesas", pool: "sub21" },
  ],
};

export default function HogueraDemoPage() {
  const [open, setOpen] = useState(true);
  const [lastResult, setLastResult] = useState<HogueraResult | null>(null);

  return (
    <div className="mx-auto flex min-h-[72vh] w-full max-w-md flex-col items-center justify-center px-4 py-10 text-center">
      {open ? (
        <HogueraModal
          config={DEMO_CONFIG}
          onClose={() => setOpen(false)}
          onCompleted={(result) => setLastResult(result)}
          onOpenPacks={() => setOpen(false)}
        />
      ) : (
        <div className="theme-dark relative w-full overflow-hidden rounded-2xl border border-[#f5c518]/20 bg-[#06120b] p-6 text-white shadow-2xl shadow-black/50">
          <div
            aria-hidden
            className="absolute inset-x-4 top-4 h-24 rounded-xl border border-white/10 bg-[repeating-linear-gradient(90deg,rgba(31,134,56,0.38)_0_22px,rgba(14,99,41,0.38)_22px_44px)] opacity-60"
          />
          <div
            aria-hidden
            className="absolute right-5 top-8 h-16 w-16 rounded-full bg-[radial-gradient(circle,rgba(245,197,24,0.42),rgba(255,106,43,0.22)_45%,transparent_72%)]"
          />
          <p className="relative text-[10px] font-bold uppercase tracking-[0.24em] text-[#f5c518]">
            Demo / Campo de fuego
          </p>
          {lastResult ? (
            <p className="relative mt-3 text-sm text-zinc-300">
              Llegaste a{" "}
              <span className="font-bold text-white">{lastResult.metersReached} m</span>{" "}
              {"->"}{" "}
              <span className="font-bold text-[#f5c518]">
                {lastResult.packs} {lastResult.packs === 1 ? "sobre" : "sobres"}
              </span>
            </p>
          ) : (
            <p className="relative mt-3 text-sm text-zinc-400">Demo cerrada.</p>
          )}
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="relative mt-5 w-full rounded-lg bg-gradient-to-r from-[#22c55e] via-[#f5c518] to-[#ff6a2b] px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-[#06120b] transition hover:brightness-110"
          >
            Jugar otra vez
          </button>
        </div>
      )}
    </div>
  );
}
