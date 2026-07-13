"use client";

import { useState } from "react";

import {
  SanFerminModal,
  type SanFerminConfig,
  type SanFerminResult,
} from "@/components/sanfermin-modal";

const DEMO_CONFIG: SanFerminConfig = {
  id: "demo-sanfermin-1",
  title: "SAN FERMIN RUSH",
  goalMeters: 160,
  hurdlesPerReward: 3,
  extraHurdlesPerRun: 3,
  rewards: [
    {
      meters: 40,
      image: "/sobre-defensas.webp",
      title: "Sobre Defensa",
      pool: "defensas",
    },
    {
      meters: 80,
      image: "/sobre-medios.webp",
      title: "Sobre Mediocentro",
      pool: "medios",
    },
    {
      meters: 120,
      image: "/sobre-delanteros.webp",
      title: "Sobre Delantero",
      pool: "delanteros",
    },
    {
      meters: 160,
      image: "/sobre-estrellas.webp",
      title: "Sobre Estrellas",
      pool: "stars",
    },
  ],
};

export default function SanFerminDemoPage() {
  const [open, setOpen] = useState(true);
  const [lastResult, setLastResult] = useState<SanFerminResult | null>(null);

  return (
    <div className="mx-auto flex min-h-[72vh] w-full max-w-md flex-col items-center justify-center px-4 py-10 text-center">
      {open ? (
        <SanFerminModal
          config={DEMO_CONFIG}
          onClose={() => setOpen(false)}
          onCompleted={(result) => setLastResult(result)}
          onOpenPacks={() => setOpen(false)}
        />
      ) : (
        <div className="theme-dark relative w-full overflow-hidden rounded-2xl border border-red-200/20 bg-[#160809] p-6 text-white shadow-2xl shadow-black/50">
          <div
            aria-hidden
            className="absolute inset-x-4 top-4 h-24 rounded-xl border border-white/10 bg-[url('/sanfermin-bg-pixel.png')] bg-cover bg-center opacity-45"
          />
          <p className="relative text-[10px] font-bold uppercase tracking-[0.24em] text-red-100">
            Demo / Encierro pixel
          </p>
          {lastResult ? (
            <p className="relative mt-3 text-sm text-zinc-300">
              Llegaste a{" "}
              <span className="font-bold text-white">
                {lastResult.metersReached} m
              </span>{" "}
              {"->"}{" "}
              <span className="font-bold text-red-100">
                {lastResult.packs}{" "}
                {lastResult.packs === 1 ? "sobre" : "sobres"}
              </span>
            </p>
          ) : (
            <p className="relative mt-3 text-sm text-zinc-400">Demo cerrada.</p>
          )}
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="relative mt-5 w-full rounded-lg bg-gradient-to-r from-red-600 via-white to-red-500 px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-[#210707] transition hover:brightness-110"
          >
            Jugar otra vez
          </button>
        </div>
      )}
    </div>
  );
}
