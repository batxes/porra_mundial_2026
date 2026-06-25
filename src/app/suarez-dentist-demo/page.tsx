"use client";

import { useState } from "react";

import {
  SuarezDentistModal,
  type SuarezDentistConfig,
  type SuarezDentistResult,
} from "@/components/suarez-dentist-modal";

const DEMO_CONFIG: SuarezDentistConfig = {
  id: "demo-suarez-dentist-1",
  title: "DENTISTA SUAREZ",
  rewards: [
    {
      image: "/sobre-defensas.webp",
      title: "Sobre Defensas",
      pool: "defensas",
    },
    {
      image: "/sobre-medios.webp",
      title: "Sobre Mediocentros",
      pool: "medios",
    },
    {
      image: "/sobre-premier.webp",
      title: "Sobre Premier",
      pool: "premier",
    },
  ],
};

export default function SuarezDentistDemoPage() {
  const [open, setOpen] = useState(true);
  const [lastResult, setLastResult] = useState<SuarezDentistResult | null>(null);

  return (
    <div className="mx-auto flex min-h-[72vh] w-full max-w-md flex-col items-center justify-center px-4 py-10 text-center">
      {open ? (
        <SuarezDentistModal
          config={DEMO_CONFIG}
          onClose={() => setOpen(false)}
          onCompleted={(result) => setLastResult(result)}
          onOpenPacks={() => setOpen(false)}
        />
      ) : (
        <div className="theme-dark relative w-full overflow-hidden rounded-2xl border border-sky-200/20 bg-[#07131b] p-6 text-white shadow-2xl shadow-black/50">
          <div
            aria-hidden
            className="absolute inset-x-4 top-4 h-24 rounded-xl border border-white/10 bg-[linear-gradient(90deg,rgba(14,165,233,0.22),rgba(245,197,24,0.16),rgba(34,197,94,0.18))] opacity-70"
          />
          <p className="relative text-[10px] font-bold uppercase tracking-[0.24em] text-sky-200">
            Demo / Dentista Suarez
          </p>
          {lastResult ? (
            <p className="relative mt-3 text-sm text-zinc-300">
              Quitaste{" "}
              <span className="font-bold text-white">
                {lastResult.teethRemoved}
              </span>{" "}
              dientes {"->"}{" "}
              <span className="font-bold text-[#f5c518]">
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
            className="relative mt-5 w-full rounded-lg bg-gradient-to-r from-sky-300 via-[#f5c518] to-emerald-400 px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-[#07131b] transition hover:brightness-110"
          >
            Jugar otra vez
          </button>
        </div>
      )}
    </div>
  );
}
