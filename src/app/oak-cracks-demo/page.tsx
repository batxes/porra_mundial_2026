"use client";

import { useState } from "react";

import {
  AdivinaModal,
  type AdivinaConfig,
  type AdivinaResult,
} from "@/components/adivina-modal";

const DEMO_CONFIG: AdivinaConfig = {
  id: "demo-oak-cracks-2",
  title: "ADIVINA EL CRACK 2",
  roundTimeMs: 10000,
  rewards: [
    {
      minScore: 1,
      pool: "defensas",
      image: "/sobre-defensas.webp",
      title: "Sobre Defensas",
    },
    {
      minScore: 2,
      pool: "medios",
      image: "/sobre-medios.webp",
      title: "Sobre Mediocentros",
    },
    {
      minScore: 4,
      pool: "barcelona",
      image: "/sobre-barcelona.webp",
      title: "Sobre Barcelona",
    },
  ],
  rounds: [
    {
      image: "/dembele.webp",
      answerId: "fra-07",
      answerLabel: "Dembele",
      aliases: ["Ousmane Dembele", "Ousmane Dembélé", "Dembélé"],
    },
    {
      image: "/julian.webp",
      answerId: "arg-09",
      answerLabel: "Julian Alvarez",
      aliases: ["Julian", "Julián", "J. Alvarez", "Julián Alvarez"],
    },
    {
      image: "/valverde.webp",
      answerId: "uru-08",
      answerLabel: "Fede Valverde",
      aliases: ["Fede", "Federico Valverde", "F. Valverde"],
    },
    {
      image: "/ferran.webp",
      answerId: "esp-07",
      answerLabel: "Ferran Torres",
      aliases: ["Ferran"],
    },
  ],
};

export default function OakCracksDemoPage() {
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
            Demo / Oak 2
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
