"use client";

import { useState } from "react";

import {
  PorteroPenaltyModal,
  type PorteroPenaltyConfig,
  type PorteroPenaltyResult,
} from "@/components/portero-penalty-modal";

const DEMO_CONFIG: PorteroPenaltyConfig = {
  id: "demo-portero-marrero-1",
  title: "MARRERO BAJO PALOS",
  totalShots: 5,
  rewards: [
    {
      image: "/sobre-porteros.webp",
      minSaves: 1,
      pool: "porteros",
      title: "Sobre Porteros",
    },
    {
      image: "/sobre-porteros.webp",
      minSaves: 2,
      pool: "porteros",
      title: "Sobre Porteros",
    },
    {
      image: "/sobre-porteros.webp",
      minSaves: 4,
      pool: "porteros",
      title: "Sobre Porteros",
    },
  ],
};

export default function PorteroDemoPage() {
  const [open, setOpen] = useState(true);
  const [lastResult, setLastResult] = useState<PorteroPenaltyResult | null>(
    null,
  );

  return (
    <div className="mx-auto flex min-h-[72vh] w-full max-w-md flex-col items-center justify-center px-4 py-10 text-center">
      {open ? (
        <PorteroPenaltyModal
          config={DEMO_CONFIG}
          onClose={() => setOpen(false)}
          onCompleted={(result) => setLastResult(result)}
          onOpenPacks={() => setOpen(false)}
        />
      ) : (
        <div className="theme-dark relative w-full overflow-hidden rounded-2xl border border-[#7dd3fc]/25 bg-[#07131f] p-6 text-white shadow-2xl shadow-black/50">
          <div
            aria-hidden
            className="absolute inset-x-4 top-4 h-24 rounded-xl border border-white/10 bg-[linear-gradient(180deg,#123e68,#0d3d22)] opacity-60"
          />
          <p className="relative text-[10px] font-bold uppercase tracking-[0.24em] text-[#7dd3fc]">
            Demo / Porteros
          </p>
          {lastResult ? (
            <p className="relative mt-3 text-sm text-zinc-300">
              Has parado{" "}
              <span className="font-bold text-white">
                {lastResult.saves}/{lastResult.totalShots}
              </span>{" "}
              {"->"}{" "}
              <span className="font-bold text-[#7dd3fc]">
                {lastResult.packs} {lastResult.packs === 1 ? "sobre" : "sobres"}
              </span>
            </p>
          ) : (
            <p className="relative mt-3 text-sm text-zinc-400">Demo cerrada.</p>
          )}
          <button
            className="relative mt-5 w-full rounded-lg bg-[#7dd3fc] px-5 py-3 text-sm font-bold uppercase tracking-[0.14em] text-[#06131f] transition hover:bg-white"
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
