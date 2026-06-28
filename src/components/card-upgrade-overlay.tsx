"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PlayerCard } from "@/components/player-card";
import { playersById, teamsById } from "@/lib/data";

type ForgeInput = { id: string; playerId: string };

type Phase = "charge" | "flash" | "reveal";

type CardUpgradeOverlayProps = {
  inputs: ForgeInput[];
  isPlayerEliminated?: (playerId: string) => boolean;
  resultPlayerId: string;
  pointsFor: (playerId: string) => number;
  onDone: () => void;
};

// Posiciones de partida de las 4 cartas (en diamante alrededor del núcleo).
// Convergen al centro durante la fase "charge".
const SPREAD: { x: number; y: number; r: number }[] = [
  { x: 0, y: -132, r: -8 },
  { x: 124, y: 0, r: 8 },
  { x: 0, y: 132, r: 6 },
  { x: -124, y: 0, r: -6 },
];

// Revelado de la forja: three.js NO interviene (todo HTML/CSS, como el revelado
// del sobre). Las 4 cartas vuelan al centro, se funden en un núcleo de energía
// dorado, un flash y aparece la legendaria con su holo. Tocar acelera al
// revelado. El premio YA está decidido (servidor en prod, cliente en local); la
// animación es puramente visual.
export function CardUpgradeOverlay({
  inputs,
  isPlayerEliminated = () => false,
  resultPlayerId,
  pointsFor,
  onDone,
}: CardUpgradeOverlayProps) {
  const [phase, setPhase] = useState<Phase>("charge");
  const [converged, setConverged] = useState(false);
  const timers = useRef<number[]>([]);
  const player = playersById.get(resultPlayerId);
  const team = player ? teamsById.get(player.team) : null;

  const clearTimers = useCallback(() => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  }, []);

  // Secuencia automática: arranca la convergencia, luego flash, luego revelado.
  useEffect(() => {
    timers.current = [
      window.setTimeout(() => setConverged(true), 240),
      window.setTimeout(() => setPhase("flash"), 1850),
      window.setTimeout(() => setPhase("reveal"), 2320),
    ];
    return clearTimers;
  }, [clearTimers]);

  // Tap/click durante la carga salta directo al revelado.
  const skipToReveal = useCallback(() => {
    if (phase === "reveal") return;
    clearTimers();
    setConverged(true);
    setPhase("flash");
    timers.current = [window.setTimeout(() => setPhase("reveal"), 300)];
  }, [phase, clearTimers]);

  const showStage = phase !== "reveal";

  const cards = useMemo(() => inputs.slice(0, 4), [inputs]);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center overflow-hidden bg-black text-white"
      data-cofres-forge-overlay
      data-forge-phase={phase}
      role="dialog"
      aria-label="Forja de carta legendaria"
      onPointerDown={showStage ? skipToReveal : undefined}
    >
      <span className="sr-only">
        Fusionando cuatro cartas comunes en una carta legendaria.
      </span>

      {/* Fondo: nebulosa dorada en movimiento. */}
      <div className="forge-bg pointer-events-none absolute inset-0" />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 50% 50%, rgba(247,200,74,0.10), transparent 60%)",
        }}
      />

      {showStage ? (
        <div
          className="relative flex h-[360px] w-[360px] items-center justify-center"
          style={{
            animation:
              phase === "flash"
                ? "cofres-epic-shake 480ms ease-out"
                : undefined,
          }}
        >
          {/* Núcleo de energía que crece según se acerca la fusión. */}
          <div
            className="forge-orb pointer-events-none absolute left-1/2 top-1/2"
            data-converged={converged}
          />

          {/* Las 4 cartas de entrada convergen al centro. */}
          {cards.map((card, index) => {
            const slot = SPREAD[index] ?? SPREAD[0];
            return (
              <div
                key={card.id}
                className="absolute left-1/2 top-1/2 w-[88px] sm:w-[104px]"
                style={{
                  transform: converged
                    ? "translate(-50%, -50%) translate(0px, 0px) scale(0.12) rotate(220deg)"
                    : `translate(-50%, -50%) translate(${slot.x}px, ${slot.y}px) scale(1) rotate(${slot.r}deg)`,
                  opacity: converged ? 0 : 1,
                  filter: converged
                    ? "brightness(2.4) saturate(1.4)"
                    : "none",
                  transition:
                    "transform 1.55s cubic-bezier(0.55, 0, 0.25, 1), opacity 1s ease-in 0.55s, filter 1.4s ease-in",
                }}
              >
                <PlayerCard
                  playerId={card.playerId}
                  points={pointsFor(card.playerId)}
                  eliminated={isPlayerEliminated(card.playerId)}
                />
              </div>
            );
          })}
        </div>
      ) : null}

      {/* Flash de fusión. */}
      {phase === "flash" ? (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(60% 50% at 50% 50%, rgba(255,255,255,0.95), rgba(247,200,74,0.55) 35%, transparent 70%)",
            animation: "forge-flash 480ms ease-out forwards",
          }}
        />
      ) : null}

      {/* Revelado de la legendaria. */}
      {phase === "reveal" ? (
        <div className="relative flex flex-col items-center gap-5 px-4">
          <div
            className="text-center"
            style={{ animation: "forge-title-in 600ms ease-out 0.15s both" }}
          >
            <p className="text-xs font-bold uppercase tracking-[0.42em] text-[#f7c84a]">
              ¡Legendaria!
            </p>
          </div>

          <div
            className="forge-reveal-card relative w-[clamp(214px,68vw,290px)]"
            style={{ animation: "forge-reveal-pop 720ms cubic-bezier(0.16,1.1,0.3,1) both" }}
          >
            <PlayerCard
              playerId={resultPlayerId}
              points={pointsFor(resultPlayerId)}
              eliminated={isPlayerEliminated(resultPlayerId)}
              featured
              holoShader
            />
            {/* Barrido de brillo dorado al aparecer. */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg">
              <div
                className="absolute inset-y-[-30%] left-0 w-1/2"
                style={{
                  background:
                    "linear-gradient(100deg, transparent, rgba(255,236,170,0.45), transparent)",
                  animation: "forge-shine 900ms ease-out 0.35s forwards",
                }}
              />
            </div>
          </div>

          <div
            className="text-center"
            style={{ animation: "forge-title-in 600ms ease-out 0.4s both" }}
          >
            <p className="text-lg font-bold text-white sm:text-xl">
              {player?.name ?? "Carta legendaria"}
            </p>
            <p className="text-sm text-zinc-400">{team?.name ?? ""}</p>
          </div>

          <button
            type="button"
            onClick={onDone}
            className="mt-1 w-full max-w-xs rounded-full bg-[#f7c84a] px-6 py-3.5 text-base font-bold text-black shadow-2xl shadow-[#f7c84a]/20 transition hover:bg-[#ffd966]"
            style={{ animation: "forge-title-in 500ms ease-out 0.6s both" }}
          >
            A mi colección
          </button>
        </div>
      ) : null}

      {showStage ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-8 flex justify-center px-4">
          <span className="rounded-full border border-[#f7c84a]/20 bg-black/40 px-5 py-2.5 text-sm font-bold text-[#f7c84a] shadow-2xl shadow-black/40 backdrop-blur">
            Forjando legendaria…
          </span>
        </div>
      ) : null}
    </div>
  );
}
