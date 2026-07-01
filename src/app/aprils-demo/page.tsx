"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useMemo, useState } from "react";

import { Card, SectionHeading } from "@/components/common";
import { PlayerCard } from "@/components/player-card";
import {
  APRILS_CARD_POINTS,
  APRILS_PACK_IMAGE,
  APRILS_PACK_TITLE,
  APRILS_PLAYER_ID,
} from "@/lib/aprils";

const PackOpeningOverlay = dynamic(
  () =>
    import("@/components/pack-opening-overlay").then(
      (mod) => mod.PackOpeningOverlay,
    ),
  { ssr: false },
);

const pack = {
  id: "special-admin-aprils-demo",
  kind: "special" as const,
  playerIds: [APRILS_PLAYER_ID],
  subtitle: "Drop especial",
  title: APRILS_PACK_TITLE,
  image: APRILS_PACK_IMAGE,
  flap: "red" as const,
};

export default function AprilsDemoPage() {
  const [opening, setOpening] = useState(false);
  const [opened, setOpened] = useState(false);
  const packs = useMemo(() => [pack], []);
  const pointsFor = (playerId: string) =>
    playerId === APRILS_PLAYER_ID ? APRILS_CARD_POINTS : 0;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 text-white sm:px-6 lg:px-8">
      <SectionHeading
        eyebrow="Demo"
        title="Sobre Aprils"
        description="Prueba el sobre especial y la carta antes de soltarlo desde admin."
      />

      <section className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-stretch">
        <Card className="relative flex min-h-[460px] flex-col items-center justify-center overflow-hidden p-6 text-center">
          <div
            aria-hidden
            className="absolute inset-0 bg-[radial-gradient(circle_at_50%_16%,rgba(255,78,70,0.24),transparent_42%),linear-gradient(180deg,rgba(255,255,255,0.04),rgba(0,0,0,0.22))]"
          />
          <div className="relative aspect-[818/1206] w-[min(58vw,240px)]">
            <Image
              src={APRILS_PACK_IMAGE}
              alt={APRILS_PACK_TITLE}
              fill
              priority
              sizes="240px"
              className="object-contain drop-shadow-[0_28px_44px_rgba(0,0,0,0.48)]"
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setOpened(false);
              setOpening(true);
            }}
            className="relative mt-6 rounded-full bg-[#ffd252] px-7 py-3 text-sm font-bold uppercase tracking-[0.14em] text-black shadow-2xl shadow-[#ffd252]/20 transition hover:bg-[#ffe286]"
          >
            Abrir sobre
          </button>
          <p className="relative mt-3 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
            {opened ? "Abierto" : "Sin abrir"}
          </p>
        </Card>

        <Card className="flex min-h-[460px] flex-col justify-center p-5 sm:p-6">
          <div className="mx-auto w-full max-w-sm">
            <p className="mb-4 text-center text-xs font-bold uppercase tracking-[0.2em] text-[#a7f600]">
              Carta revelada
            </p>
            <div className="mx-auto w-[min(72vw,280px)]">
              <PlayerCard
                playerId={APRILS_PLAYER_ID}
                points={APRILS_CARD_POINTS}
                featured
              />
            </div>
          </div>
        </Card>
      </section>

      <section className="mt-6">
        <Card className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
                /cofres
              </p>
              <h2 className="mt-1 text-xl font-bold text-white">Tus cartas</h2>
            </div>
            <span className="rounded-full border border-white/10 px-3 py-1 text-xs font-bold text-zinc-300">
              1 sin usar
            </span>
          </div>
          <div
            className="grid max-w-xs grid-cols-2 gap-3 pt-2 sm:grid-cols-3"
            style={{ perspective: "1000px" }}
          >
            <button
              type="button"
              aria-pressed={false}
              className="cofre-card-reveal relative rounded-lg text-left outline-none transition hover:-translate-y-1 focus-visible:ring-2 focus-visible:ring-[#a7f600]/60"
            >
              <PlayerCard
                playerId={APRILS_PLAYER_ID}
                points={APRILS_CARD_POINTS}
              />
            </button>
          </div>
        </Card>
      </section>

      {opening ? (
        <PackOpeningOverlay
          initialPackId={pack.id}
          onAccept={async () => {
            setOpened(true);
            setOpening(false);
          }}
          onClose={() => setOpening(false)}
          packs={packs}
          pointsFor={pointsFor}
        />
      ) : null}
    </main>
  );
}
