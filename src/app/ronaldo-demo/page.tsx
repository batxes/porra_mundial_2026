"use client";

import { useState } from "react";

import {
  RonaldaoLimboModal,
  type RonaldaoLimboConfig,
  type RonaldaoLimboResult,
} from "@/components/ronaldao-limbo-modal";

const DEMO_CONFIG: RonaldaoLimboConfig = {
  id: "demo-ronaldao-limbo-1",
  title: "PATATA CALIENTE",
  rewards: [
    {
      image: "/sobre-defensas.webp",
      pool: "defensas",
      title: "Sobre Defensas",
    },
    {
      image: "/sobre-porteros.webp",
      pool: "porteros",
      title: "Sobre Porteros",
    },
    {
      image: "/sobre-delanteros.webp",
      pool: "delanteros",
      title: "Sobre Delanteros",
    },
    {
      image: "/sobre-medios.webp",
      pool: "medios",
      title: "Sobre Mediocentros",
    },
    {
      image: "/sobre21.webp",
      pool: "sub21",
      title: "Sobre Promesas",
    },
    {
      image: "/sobre-estrellas.webp",
      pool: "stars",
      title: "Sobre Estrellas",
    },
  ],
};

export default function RonaldoDemoPage() {
  const [open, setOpen] = useState(true);
  const [lastResult, setLastResult] = useState<RonaldaoLimboResult | null>(
    null,
  );

  return (
    <div className="mx-auto flex min-h-[72vh] w-full max-w-md flex-col items-center justify-center px-4 py-10 text-center">
      {open ? (
        <RonaldaoLimboModal
          config={DEMO_CONFIG}
          onClose={() => setOpen(false)}
          onCompleted={(result) => setLastResult(result)}
          onOpenPacks={() => setOpen(false)}
        />
      ) : (
        <div className="theme-dark relative w-full overflow-hidden rounded-2xl border border-emerald-200/20 bg-[#07131b] p-6 text-white shadow-2xl shadow-black/50">
          <div
            aria-hidden
            className="absolute inset-x-4 top-4 h-24 rounded-xl border border-white/10 bg-[linear-gradient(90deg,rgba(34,197,94,0.22),rgba(245,197,24,0.16),rgba(255,106,43,0.18))] opacity-70"
          />
          <p className="relative text-[10px] font-bold uppercase tracking-[0.24em] text-[#f5c518]">
            Demo / Ronaldao
          </p>
          {lastResult ? (
            <p className="relative mt-3 text-sm text-zinc-300">
              Mejor vida {"->"}{" "}
              <span className="font-bold text-[#f5c518]">
                {lastResult.packs}{" "}
                {lastResult.packs === 1 ? "sobre" : "sobres"}
              </span>
            </p>
          ) : (
            <p className="relative mt-3 text-sm text-zinc-400">Demo cerrada.</p>
          )}
          <button
            className="relative mt-5 w-full rounded-lg bg-gradient-to-r from-[#22c55e] via-[#f5c518] to-[#ff6a2b] px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-[#06120b] transition hover:brightness-110"
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
