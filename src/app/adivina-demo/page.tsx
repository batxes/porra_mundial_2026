"use client";

import { useState } from "react";

import {
  AdivinaModal,
  type AdivinaConfig,
  type AdivinaResult,
} from "@/components/adivina-modal";

// Config de demo: las 4 caricaturas que estan en /public + su jugador real.
// En prod esto vendra de Supabase/admin; aqui es local para validar.
const DEMO_CONFIG: AdivinaConfig = {
  id: "demo-adivina-1",
  title: "ADIVINA EL CRACK",
  roundTimeMs: 10000,
  // Sobres reales segun aciertos. La escalera 1/2/2/3 sale de los minScore 1, 2 y 4
  // (a 3 aciertos sigues con 2 sobres; el tercero llega al acertar los 4).
  rewards: [
    {
      minScore: 1,
      pool: "delanteros",
      image: "/sobre-delanteros.webp",
      title: "Sobre Delanteros",
    },
    {
      minScore: 2,
      pool: "defensas",
      image: "/sobre-defensas.webp",
      title: "Sobre Defensas",
    },
    {
      minScore: 4,
      pool: "sub21",
      image: "/sobre21.webp",
      title: "Sobre Promesas",
    },
  ],
  rounds: [
    { image: "/messi.webp", answerId: "arg-10", answerLabel: "Messi" },
    { image: "/mbappe.webp", answerId: "fra-10", answerLabel: "Mbappe" },
    { image: "/halland.webp", answerId: "nor-09", answerLabel: "Haaland" },
    { image: "/courtois.webp", answerId: "bel-01", answerLabel: "Courtois" },
  ],
};

export default function AdivinaDemoPage() {
  const [open, setOpen] = useState(true);
  const [lastResult, setLastResult] = useState<AdivinaResult | null>(null);

  return (
    <div className="mx-auto flex min-h-[72vh] w-full max-w-md flex-col items-center justify-center px-4 py-10 text-center">
      {open ? (
        <AdivinaModal
          config={DEMO_CONFIG}
          onClose={() => setOpen(false)}
          onCompleted={(result) => setLastResult(result)}
          onOpenPacks={() => setOpen(false)}
        />
      ) : (
        <div className="theme-dark w-full rounded-2xl border border-white/10 bg-[#151515] p-6 text-white shadow-2xl shadow-black/50">
          <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-[#a7f600]">
            Demo / Adivina el crack
          </p>
          {lastResult ? (
            <p className="mt-3 text-sm text-zinc-300">
              Has acertado{" "}
              <span className="font-bold text-white">
                {lastResult.correct}/{lastResult.total}
              </span>{" "}
              {"->"}{" "}
              <span className="font-bold text-[#a7f600]">
                {lastResult.packs} {lastResult.packs === 1 ? "sobre" : "sobres"}
              </span>
            </p>
          ) : (
            <p className="mt-3 text-sm text-zinc-400">Demo cerrada.</p>
          )}
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="mt-5 w-full rounded-lg bg-[#a7f600] px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-black transition hover:bg-[#c7ff43]"
          >
            Jugar otra vez
          </button>
        </div>
      )}
    </div>
  );
}
