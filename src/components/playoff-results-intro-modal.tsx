"use client";

import Image from "next/image";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

import { TeamFlag } from "@/components/common";
import {
  TrainerFullArtCard,
  trainerDemoCards,
  type TrainerDemoCard,
} from "@/components/trainer-full-art-card";

export const playoffResultsIntroStorageKey =
  "porra26_playoff_results_intro_seen_v2";
const playoffIntroSteps = [
  {
    eyebrow: "1/4 Entrenador",
    title: "Elige un entrenador",
    body: "En cada partido solo puedes quedarte con uno de los dos entrenadores. Elegirlo no da puntos por sí solo: sirve para asociarle una estrategia.",
  },
  {
    eyebrow: "2/4 Estrategias",
    title: "Hay 6 estilos distintos",
    body: "Cada estilo representa una forma de puntuar: goles, portería, primer golpe, balón parado, partido caliente o remontada.",
  },
  {
    eyebrow: "3/4 Arrastrar",
    title: "Asocia el estilo al entrenador",
    body: "Toca una estrategia o arrástrala encima del entrenador elegido. El estilo se queda pegado a ese entrenador.",
  },
  {
    eyebrow: "4/4 Regla final",
    title: "Todo lo demás sigue igual",
    body: "Sigues puntuando por quiniela y resultado exacto como siempre. Ahora, además, puedes sumar el bonus del estilo si la estrategia elegida se cumple.",
  },
] as const;

const playoffIntroSpainTrainer =
  trainerDemoCards.find((card) => card.id === "espana-de-la-fuente") ??
  trainerDemoCards[0];
const playoffIntroBrazilTrainer =
  trainerDemoCards.find((card) => card.id === "brasil-ancelotti") ??
  trainerDemoCards[1] ??
  trainerDemoCards[0];

export function PlayoffResultsIntroModal({
  onClose,
  onStartFilling,
}: {
  onClose: () => void;
  onStartFilling: () => void;
}) {
  const [step, setStep] = useState(0);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const isLast = step === playoffIntroSteps.length - 1;
  const content = playoffIntroSteps[step];

  useEffect(() => {
    primaryRef.current?.focus();
  }, [step]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 px-4 py-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="playoff-results-intro-title"
    >
      <div className="relative flex w-full max-w-md flex-col overflow-hidden rounded-2xl border border-[#a7f600]/20 bg-[#121212] text-white shadow-2xl shadow-black/60 motion-safe:animate-[cofre-modal-pop_240ms_cubic-bezier(0.2,0.9,0.3,1)_both]">
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#a7f600]/15 text-base font-semibold text-[#a7f600]"
            >
              ?
            </span>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#a7f600]">
              Playoffs y entrenadores
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-xs font-bold text-zinc-500 transition hover:text-white"
          >
            Saltar
          </button>
        </div>

        <div className="px-5 pt-5">
          <div className="relative mb-4 flex h-48 items-center justify-center overflow-hidden rounded-xl border border-white/[0.07] bg-gradient-to-b from-[#a7f600]/[0.08] to-transparent">
            {step === 0 ? (
              <PlayoffIntroCoachChoiceStage />
            ) : step === 1 ? (
              <PlayoffIntroStrategyDeckStage />
            ) : step === 2 ? (
              <PlayoffIntroDragStage />
            ) : (
              <PlayoffIntroOnePairStage />
            )}
          </div>

          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#a7f600]">
            {content.eyebrow}
          </p>
          <h3
            id="playoff-results-intro-title"
            className="mt-1 text-xl font-bold tracking-tight text-white"
          >
            {content.title}
          </h3>
          <p className="mt-1.5 text-sm leading-6 text-zinc-300">
            {content.body}
          </p>
        </div>

        {step === 2 ? (
          <PlayoffIntroCallout tone="lime">
            El resultado puntúa como siempre. Este estilo es el extra de
            entrenador.
          </PlayoffIntroCallout>
        ) : null}
        {step === 3 ? (
          <PlayoffIntroCallout tone="neutral">
            No tienes que aprender otra porra: solo añade 1 entrenador + 1
            estrategia a tu marcador de siempre.
          </PlayoffIntroCallout>
        ) : null}

        <div className="mt-4 flex items-center justify-between gap-3 px-5 pb-5">
          <div className="flex items-center gap-1.5" aria-hidden>
            {playoffIntroSteps.map((_, index) => (
              <span
                key={index}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  index === step ? "w-5 bg-[#a7f600]" : "w-1.5 bg-white/20"
                }`}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {step > 0 ? (
              <button
                type="button"
                onClick={() => setStep((current) => Math.max(0, current - 1))}
                className="rounded-lg border border-white/10 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-white/10"
              >
                Atrás
              </button>
            ) : null}
            <button
              ref={primaryRef}
              type="button"
              onClick={() => (isLast ? onStartFilling() : setStep((c) => c + 1))}
              className="rounded-lg bg-[#a7f600] px-5 py-2.5 text-sm font-bold text-black shadow-lg shadow-[#a7f600]/10 transition hover:bg-[#c7ff43]"
            >
              {isLast ? "Ir a rellenar" : "Siguiente"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PlayoffIntroCallout({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "lime" | "neutral";
}) {
  const lime = tone === "lime";
  return (
    <div
      className={`mx-5 mt-3 flex items-start gap-2.5 rounded-xl border px-3.5 py-3 ${
        lime
          ? "border-[#a7f600]/25 bg-[#a7f600]/[0.08] text-[#d7ffa8]"
          : "border-white/10 bg-white/[0.05] text-zinc-200"
      }`}
    >
      <span
        aria-hidden
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
          lime ? "bg-[#a7f600] text-black" : "bg-white text-black"
        }`}
      >
        !
      </span>
      <p className="text-[13px] font-semibold leading-5">{children}</p>
    </div>
  );
}

function PlayoffIntroCoachChoiceStage() {
  return (
    <div className="grid h-full w-full grid-cols-[1fr_auto_1fr] items-center gap-2 px-3">
      <PlayoffIntroCoachCard
        trainer={playoffIntroSpainTrainer}
        picked
      />
      <span className="text-lg font-semibold text-zinc-500">VS</span>
      <PlayoffIntroCoachCard trainer={playoffIntroBrazilTrainer} />
    </div>
  );
}

const playoffStrategyChips = [
  {
    id: "over-25",
    title: "Goleador",
    detail: "3+ goles",
    copy: "MARCA 3 GOLES O MAS",
    points: 2,
    color: "#ff3b24",
    icon: "/prediction-icons/over25.png",
  },
  {
    id: "clean-sheet",
    title: "Muro",
    detail: "Portería a 0",
    copy: "No encaja gol.",
    points: 2,
    color: "#69d744",
    icon: "/prediction-icons/clean-sheet.png",
  },
  {
    id: "first-goal",
    title: "Abrelatas",
    detail: "Primer gol",
    copy: "Marca primero.",
    points: 1,
    color: "#d946ef",
    icon: "/prediction-icons/first-goal.png",
  },
  {
    id: "set-piece",
    title: "Estratega",
    detail: "Balón parado",
    copy: "Gol a balón parado.",
    points: 3,
    color: "#38bdf8",
    icon: "/prediction-icons/set-piece.png",
  },
  {
    id: "red-card",
    title: "Carnicero",
    detail: "Roja",
    copy: "Expulsan tu jugador.",
    points: 5,
    color: "#ff4d2d",
    icon: "/prediction-icons/red-card.png",
  },
  {
    id: "comeback",
    title: "Remontada",
    detail: "Remontada",
    copy: "Vas perdiendo y ganas.",
    points: 6,
    color: "#facc15",
    icon: "/prediction-icons/comeback.png",
  },
] as const;

function PlayoffIntroStrategyDeckStage() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-3">
      <div className="playoff-intro-real-chip-grid">
        {playoffStrategyChips.slice(0, 3).map((chip, index) => (
          <PlayoffIntroRealTacticCard
            key={chip.id}
            chip={chip}
            delayIndex={index}
          />
        ))}
      </div>
      <div className="playoff-intro-real-chip-grid playoff-intro-real-chip-grid--two">
        {playoffStrategyChips.slice(3).map((chip, index) => (
          <PlayoffIntroRealTacticCard
            key={chip.id}
            chip={chip}
            delayIndex={index + 3}
          />
        ))}
      </div>
    </div>
  );
}

function PlayoffIntroDragStage() {
  const chip = playoffStrategyChips[1];
  return (
    <div className="relative h-full w-full overflow-hidden px-4 py-3">
      <div className="absolute left-4 right-4 top-3 grid grid-cols-[1fr_auto_1fr] items-start gap-2">
        <PlayoffIntroMiniCoach
          trainer={playoffIntroSpainTrainer}
          target
        />
        <span className="pt-8 text-sm font-semibold text-zinc-500">VS</span>
        <PlayoffIntroMiniCoach trainer={playoffIntroBrazilTrainer} muted />
      </div>

      <div className="playoff-intro-mini-hand absolute bottom-2 left-3 right-3 flex justify-center gap-2">
        {playoffStrategyChips.slice(0, 3).map((item) => (
          <PlayoffIntroRealTacticCard key={item.id} chip={item} mini />
        ))}
      </div>

      <div
        className="playoff-intro-drag-chip absolute left-1/2 top-1/2 z-20"
        style={
          {
            "--chip-color": chip.color,
          } as CSSProperties
        }
      >
        <PlayoffIntroRealTacticCard chip={chip} dragging />
      </div>
      <span className="playoff-intro-drag-hand absolute left-1/2 top-1/2 z-30 flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-white text-xs font-semibold text-black shadow-xl">
        ↗
      </span>
    </div>
  );
}

function PlayoffIntroOnePairStage() {
  const chip = playoffStrategyChips[1];
  return (
    <div className="flex h-full w-full flex-col justify-center gap-3 px-4">
      <div className="grid w-full grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3 text-center">
          <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
            Resultado
          </span>
          <span className="mt-1 block text-3xl font-semibold text-white">2-1</span>
          <span className="mt-1 block text-[10px] font-bold text-zinc-500">
            como siempre
          </span>
        </div>
        <span className="text-xl font-semibold text-zinc-500">+</span>
        <div className="rounded-2xl border border-[#a7f600]/30 bg-[#a7f600]/10 px-3 py-3 text-center">
          <div className="mx-auto flex w-max items-center gap-2">
            <TeamFlag
              teamId={playoffIntroSpainTrainer.teamId}
              className="h-7 w-7 rounded-full object-cover"
            />
            <PlayoffIntroRealTacticCard chip={chip} mini />
          </div>
          <span className="mt-2 block text-[10px] font-semibold uppercase tracking-[0.14em] text-[#d7ffa8]">
            entrenador + estilo
          </span>
        </div>
      </div>
      <div className="rounded-2xl border border-[#a7f600]/30 bg-black/30 px-3 py-2 text-center">
        <span className="text-sm font-semibold text-white">
          Si <span className="text-[#a7f600]">Muro</span> se cumple:
        </span>
        <span className="ml-2 inline-flex rounded-md bg-[#a7f600] px-2 py-1 text-sm font-semibold text-black">
          +2 pts extra
        </span>
      </div>
    </div>
  );
}

function PlayoffIntroRealTacticCard({
  chip,
  delayIndex = 0,
  dragging = false,
  mini = false,
}: {
  chip: (typeof playoffStrategyChips)[number];
  delayIndex?: number;
  dragging?: boolean;
  mini?: boolean;
}) {
  return (
    <span
      className={`playoff-battle-tactic playoff-intro-real-chip ${
        mini ? "playoff-intro-real-chip--mini" : ""
      } ${dragging ? "playoff-battle-tactic--source" : ""}`}
      style={
        {
          "--tactic-color": chip.color,
          "--chip-delay": `${delayIndex * 85}ms`,
        } as CSSProperties
      }
    >
      <span className="playoff-battle-tactic-icon">
        <Image
          src={chip.icon}
          alt=""
          fill
          sizes="72px"
          className="playoff-battle-tactic-icon-img"
          unoptimized
        />
      </span>
      <span className="playoff-intro-chip-points">+{chip.points} pts</span>
    </span>
  );
}

function PlayoffIntroMiniCoach({
  muted = false,
  target = false,
  trainer,
}: {
  muted?: boolean;
  target?: boolean;
  trainer: TrainerDemoCard;
}) {
  return (
    <div
      className={`relative mx-auto w-[74px] ${
        target ? "playoff-intro-coach-target rounded-lg" : ""
      } ${muted ? "opacity-45" : ""}`}
    >
      <TrainerFullArtCard card={trainer} />
      {target ? (
        <span className="absolute -bottom-2 left-1/2 z-40 -translate-x-1/2 rounded-full bg-[#a7f600] px-2 py-0.5 text-[8px] font-semibold uppercase tracking-[0.12em] text-black">
          objetivo
        </span>
      ) : null}
    </div>
  );
}

function PlayoffIntroCoachCard({
  picked = false,
  trainer,
}: {
  picked?: boolean;
  trainer: TrainerDemoCard;
}) {
  return (
    <div
      className={`relative mx-auto w-[92px] rounded-lg ${
        picked
          ? "playoff-intro-coach-target shadow-[0_0_28px_rgba(167,246,0,0.12)]"
          : ""
      }`}
    >
      <TrainerFullArtCard card={trainer} />
      {picked ? (
        <span className="absolute -right-2 -top-2 z-40 flex h-7 w-7 items-center justify-center rounded-full bg-[#a7f600] text-black shadow-lg shadow-[#a7f600]/25">
          <IntroCheckIcon className="h-4 w-4" />
        </span>
      ) : null}
      <span
        className={`absolute -bottom-2 left-1/2 z-40 -translate-x-1/2 rounded-full px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] shadow-lg ${
          picked ? "bg-[#a7f600] text-black" : "bg-white/10 text-zinc-400"
        }`}
      >
        {picked ? "Elegido" : "Tocar"}
      </span>
    </div>
  );
}

function IntroCheckIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2.4"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

