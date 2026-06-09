"use client";

import Image from "next/image";
import Link from "next/link";

import { Card, PrimaryLink } from "@/components/common";
import { useAppContext } from "@/lib/app-context";

const scoring = [
  ["Ganador del mundial", "25"],
  ["Equipo mas goleador", "10"],
  ["Equipo mas goleado", "10"],
  ["Equipo con mas rojas", "10"],
  ["Maximo goleador", "20"],
  ["MVP", "20"],
];

export function HomeView() {
  const { completion, leaderboard } = useAppContext();

  return (
    <div className="mx-auto flex min-h-[calc(100vh-132px)] max-w-3xl flex-col justify-center gap-8 py-8">
      <section className="flex flex-col items-center text-center">
        <Image src="/logo.png" alt="" width={96} height={96} className="mb-5 h-24 w-24 object-contain" priority />
        <h1 className="text-5xl font-black tracking-tight text-white sm:text-6xl">Triliporra</h1>
        <p className="mt-4 max-w-xl text-base text-zinc-400 sm:text-lg">Adivina el Mundial 2026 y compite con tus amigos.</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-white">Competiciones</h2>
        <Card className="p-0">
          <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#a7f600] text-lg font-black text-black">26</span>
              <div>
                <h3 className="text-xl font-bold text-white">World Cup 2026</h3>
                <p className="text-sm text-zinc-500">{leaderboard.length} participantes - {completion}% completado</p>
              </div>
            </div>
            <PrimaryLink href="/porra">Jugar</PrimaryLink>
          </div>
        </Card>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <Card className="space-y-4">
          <h2 className="text-lg font-semibold text-white">Como jugar</h2>
          <div className="space-y-3 text-sm text-zinc-400">
            <p>Elige tus favoritos, monta tu once, ordena los grupos y predice marcadores.</p>
            <p>Los resultados se pueden editar hasta que empiece cada partido.</p>
          </div>
          <Link href="/como-funciona" className="inline-flex rounded-lg border border-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10">
            Ver reglas
          </Link>
        </Card>

        <Card className="space-y-4">
          <h2 className="text-lg font-semibold text-white">Tus elecciones</h2>
          <div className="space-y-2">
            {scoring.map(([label, points]) => (
              <div key={label} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-zinc-300">{label}</span>
                <strong className="rounded-md bg-white/10 px-2 py-1 text-xs text-[#a7f600]">{points} pts</strong>
              </div>
            ))}
          </div>
        </Card>
      </section>
    </div>
  );
}
