"use client";

import { useState } from "react";

import {
  ScratchCardsModal,
  type ScratchCardsConfig,
  type ScratchCardsResult,
} from "@/components/scratch-cards-modal";

const DEMO_CONFIG: ScratchCardsConfig = {
  cardCount: 5,
  id: "demo-scratch-cards-1",
  rewardSequence: ["defensa", "medio", "portero", "estrellas", "medio"],
  title: "RASCA SOBRES",
  winChance: 0.33,
  rewards: [
    {
      image: "/sobre-defensas.webp",
      pool: "defensas",
      title: "Sobre Defensas",
    },
    {
      image: "/sobre-medios.webp",
      pool: "medios",
      title: "Sobre Mediocentros",
    },
    {
      image: "/sobre-delanteros.webp",
      pool: "delanteros",
      title: "Sobre Delanteros",
    },
    {
      image: "/sobre-porteros.webp",
      pool: "porteros",
      title: "Sobre Porteros",
    },
    {
      image: "/sobre-estrellas.webp",
      pool: "stars",
      title: "Sobre Estrellas",
    },
  ],
};

export default function RascaDemoPage() {
  const [open, setOpen] = useState(true);
  const [lastResult, setLastResult] = useState<ScratchCardsResult | null>(null);

  return (
    <div className="mx-auto flex min-h-[72vh] w-full max-w-md flex-col items-center justify-center px-4 py-10 text-center">
      {open ? (
        <ScratchCardsModal
          config={DEMO_CONFIG}
          onClose={() => setOpen(false)}
          onCompleted={(result) => setLastResult(result)}
          onOpenPacks={() => setOpen(false)}
        />
      ) : (
        <div className="theme-dark relative w-full overflow-hidden rounded-2xl border border-sky-200/20 bg-[#07131b] p-6 text-white shadow-2xl shadow-black/50">
          <div
            aria-hidden
            className="absolute inset-x-4 top-4 h-24 rounded-xl border border-white/10 bg-[linear-gradient(90deg,rgba(125,211,252,0.2),rgba(245,197,24,0.16),rgba(244,114,182,0.18))] opacity-70"
          />
          <p className="relative text-[10px] font-bold uppercase tracking-[0.24em] text-[#7dd3fc]">
            Demo / Rasca
          </p>
          {lastResult ? (
            <p className="relative mt-3 text-sm text-zinc-300">
              Premio {"->"}{" "}
              <span className="font-bold text-[#f5c518]">
                {lastResult.packs}{" "}
                {lastResult.packs === 1 ? "sobre" : "sobres"}
              </span>
            </p>
          ) : (
            <p className="relative mt-3 text-sm text-zinc-400">Demo cerrada.</p>
          )}
          <button
            className="relative mt-5 w-full rounded-lg bg-gradient-to-r from-[#7dd3fc] via-[#f5c518] to-[#f472b6] px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-[#07131b] transition hover:brightness-110"
            onClick={() => setOpen(true)}
            type="button"
          >
            Jugar otra vez
          </button>
        </div>
      )}
    </div>
  );
}
