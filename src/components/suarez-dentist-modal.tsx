"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import suarezBg from "./suarez-bg.webp";

export type SuarezDentistReward = {
  image: string;
  title: string;
  pool?: string;
};

export type SuarezDentistConfig = {
  id: string;
  title: string;
  rewards: SuarezDentistReward[];
};

export type SuarezDentistResult = {
  configId: string;
  packs: number;
  rewards: SuarezDentistReward[];
  busted: boolean;
  cleared: boolean;
  teethRemoved: number;
  trapToothId: string;
  attempts: number[];
  bestAttempt: number;
  livesUsed: number;
};

export const suarezDentistCompletedEventName =
  "triliporra:suarez-dentist-completed";

type Phase = "intro" | "briefing" | "playing" | "result";

type Tooth = {
  id: string;
  label: string;
  left: number;
  top: number;
  width: number;
  rotate: number;
};

export type SuarezDentistTuning = {
  toothY: number;
  toothScale: number;
  gapY: number;
  gapScale: number;
  gapWidth: number;
  spread: number;
};

const SUAREZ_OPEN_SRC = "/suarez-dentist.png";
const SUAREZ_CLOSED_SRC = "/suarez-dentist-2.webp";
const SUAREZ_INTRO_SRC = "/suarez-intro.webp";
const TOOTH_SRC = "/suarez-tooth.png";
const TOOTH_GAP_SRC = "/suarez-tooth-gap.svg";
const MAX_DENTIST_LIVES = 2;

export const DEFAULT_SUAREZ_DENTIST_TUNING: SuarezDentistTuning = {
  toothY: -8,
  toothScale: 0.77,
  gapY: 10,
  gapScale: 1.64,
  gapWidth: 1.29,
  spread: 0.95,
};

const TEETH: Tooth[] = [
  {
    id: "lower-left",
    label: "Diente 1",
    left: 35.8,
    top: 70.9,
    width: 8,
    rotate: -4,
  },
  {
    id: "lower-mid-left",
    label: "Diente 2",
    left: 45.3,
    top: 72.2,
    width: 8,
    rotate: -1,
  },
  {
    id: "lower-mid-right",
    label: "Diente 3",
    left: 54.7,
    top: 72.2,
    width: 8,
    rotate: 1,
  },
  {
    id: "lower-right",
    label: "Diente 4",
    left: 64.2,
    top: 70.9,
    width: 8,
    rotate: 4,
  },
];

const CONFETTI = [
  { color: "#f5c518", delay: "0ms", left: "22%" },
  { color: "#7dd3fc", delay: "70ms", left: "35%" },
  { color: "#ffffff", delay: "120ms", left: "49%" },
  { color: "#22c55e", delay: "40ms", left: "63%" },
  { color: "#ff6a2b", delay: "150ms", left: "76%" },
  { color: "#f5c518", delay: "95ms", left: "56%" },
  { color: "#7dd3fc", delay: "180ms", left: "30%" },
  { color: "#ffffff", delay: "30ms", left: "70%" },
];

function SuarezStage({
  children,
  className,
  sizes,
  priority = false,
}: {
  children: ReactNode;
  className: string;
  sizes: string;
  priority?: boolean;
}) {
  return (
    <div
      className={`relative mx-auto aspect-[1014/760] overflow-hidden rounded-2xl border border-sky-100/18 bg-[#0d6a35] ${className}`}
    >
      <Image
        src={suarezBg}
        alt=""
        fill
        sizes={sizes}
        className="suarez-stage-bg object-cover"
        priority={priority}
        aria-hidden
      />
      <div
        aria-hidden
        className="absolute inset-0 z-[1] bg-[radial-gradient(circle_at_50%_42%,rgba(255,255,255,0.24),transparent_42%),linear-gradient(180deg,rgba(2,132,199,0.08),rgba(6,78,59,0.2))]"
      />
      {children}
    </div>
  );
}

function pickTrapTooth() {
  return TEETH[Math.floor(Math.random() * TEETH.length)].id;
}

function rewardGridStyle(count: number): CSSProperties {
  return {
    gridTemplateColumns: `repeat(${Math.max(1, Math.min(4, count))}, minmax(0, 1fr))`,
  };
}

export function SuarezDentistModal({
  config,
  allowReplay = true,
  tuning = DEFAULT_SUAREZ_DENTIST_TUNING,
  onClose,
  onCompleted,
  onOpenPacks,
  onTuningChange,
}: {
  config: SuarezDentistConfig;
  allowReplay?: boolean;
  tuning?: SuarezDentistTuning;
  onClose: () => void;
  onCompleted?: (result: SuarezDentistResult) => void;
  onOpenPacks?: () => void;
  onTuningChange?: (tuning: SuarezDentistTuning) => void;
}) {
  const rewards = config.rewards.slice(0, TEETH.length);
  const [phase, setPhase] = useState<Phase>("intro");
  const [trapToothId, setTrapToothId] = useState(() => pickTrapTooth());
  const [removedTeeth, setRemovedTeeth] = useState<string[]>([]);
  const [mouthClosed, setMouthClosed] = useState(false);
  const [lastPickedTooth, setLastPickedTooth] = useState<string | null>(null);
  const [lifeIndex, setLifeIndex] = useState(0);
  const [attemptScores, setAttemptScores] = useState<number[]>([]);
  const [result, setResult] = useState<SuarezDentistResult | null>(null);
  const completedRef = useRef(false);

  // Si el admin cambia el juego activo (nuevo config.id), permite volver a jugar.
  useEffect(() => {
    completedRef.current = false;
  }, [config.id]);

  useEffect(() => {
    const sources = [
      SUAREZ_OPEN_SRC,
      SUAREZ_CLOSED_SRC,
      SUAREZ_INTRO_SRC,
      TOOTH_SRC,
      TOOTH_GAP_SRC,
    ];
    const imgs = sources.map((src) => {
      const img = new window.Image();
      img.src = src;
      void img.decode().catch(() => {});
      return img;
    });
    return () => {
      imgs.forEach((img) => {
        img.onload = null;
      });
    };
  }, []);

  const finishGame = useCallback(
    (scores: number[], trapId: string) => {
      if (completedRef.current) return;
      completedRef.current = true;
      const bestAttempt = Math.max(0, ...scores);
      const earnedRewards = rewards.slice(0, bestAttempt);
      const nextResult: SuarezDentistResult = {
        configId: config.id,
        packs: earnedRewards.length,
        rewards: earnedRewards,
        busted: true,
        cleared: false,
        teethRemoved: bestAttempt,
        trapToothId: trapId,
        attempts: scores,
        bestAttempt,
        livesUsed: scores.length,
      };
      setResult(nextResult);
      setPhase("result");
      onCompleted?.(nextResult);
    },
    [config.id, onCompleted, rewards],
  );

  const startLife = useCallback((nextLifeIndex: number) => {
    setTrapToothId(pickTrapTooth());
    setRemovedTeeth([]);
    setMouthClosed(false);
    setLastPickedTooth(null);
    setLifeIndex(nextLifeIndex);
    setPhase("playing");
  }, []);

  const openBriefing = useCallback(() => {
    setPhase("briefing");
  }, []);

  const start = useCallback(() => {
    completedRef.current = false;
    setAttemptScores([]);
    setResult(null);
    startLife(0);
  }, [startLife]);

  const pickTooth = useCallback(
    (toothId: string) => {
      if (
        phase !== "playing" ||
        mouthClosed ||
        removedTeeth.includes(toothId)
      ) {
        return;
      }

      setLastPickedTooth(toothId);

      if (toothId === trapToothId) {
        setMouthClosed(true);
        return;
      }

      const nextRemovedTeeth = [...removedTeeth, toothId];
      setRemovedTeeth(nextRemovedTeeth);
    },
    [mouthClosed, phase, removedTeeth, trapToothId],
  );

  const continueAfterBite = useCallback(() => {
    if (phase !== "playing" || !mouthClosed) return;
    const nextScores = [...attemptScores, removedTeeth.length];
    if (lifeIndex + 1 < MAX_DENTIST_LIVES) {
      setAttemptScores(nextScores);
      startLife(lifeIndex + 1);
      return;
    }
    setAttemptScores(nextScores);
    finishGame(nextScores, trapToothId);
  }, [
    attemptScores,
    finishGame,
    lifeIndex,
    mouthClosed,
    phase,
    removedTeeth.length,
    startLife,
    trapToothId,
  ]);

  useEffect(() => {
    if (phase !== "playing" || !mouthClosed) return;
    const timer = window.setTimeout(() => {
      continueAfterBite();
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [continueAfterBite, mouthClosed, phase]);

  const liveBest = Math.max(0, ...attemptScores, removedTeeth.length);
  const wonAny = (result?.packs ?? liveBest) > 0;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center overflow-x-hidden overflow-y-auto bg-black/82 px-3 py-3 text-white backdrop-blur-sm sm:px-6 sm:py-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="suarez-dentist-title"
    >
      <div className="theme-dark relative max-h-[calc(100vh-24px)] w-full max-w-xl overflow-x-hidden overflow-y-auto rounded-2xl border border-sky-200/20 bg-[#07131b] text-white shadow-2xl shadow-black/70 motion-safe:animate-[adivina-pop_220ms_cubic-bezier(0.22,1,0.36,1)_both]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(145deg,rgba(14,165,233,0.16),transparent_35%,rgba(245,197,24,0.12)_70%,rgba(34,197,94,0.12))]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-sky-200/80 to-transparent"
        />

        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="hidden"
        >
          X
        </button>

        <SuarezEventHeader phase={phase} />

        {/* Precarga (intro/briefing) las imagenes next/image del juego — el fondo
            y Suarez abierto/cerrado — con los MISMOS sizes que el render real, para
            que no carguen a mitad de partida (el mordisco cambia a la cerrada). Los
            dientes van por CSS background y los precarga el efecto new Image() de
            arriba; estas van por next/image (URL optimizada) y necesitan esto. */}
        {phase !== "playing" ? (
          <div
            aria-hidden
            className="pointer-events-none absolute left-0 top-0 h-0 w-0 overflow-hidden opacity-0"
          >
            {[suarezBg, SUAREZ_OPEN_SRC, SUAREZ_CLOSED_SRC].map(
              (src, index) => (
                <div
                  key={`suarez-preload-${index}`}
                  className="relative h-px w-px"
                >
                  <Image
                    src={src}
                    alt=""
                    fill
                    sizes="(max-width: 640px) 94vw, 560px"
                    loading="eager"
                  />
                </div>
              ),
            )}
          </div>
        ) : null}

        {phase === "intro" ? (
          <IntroPanel rewards={rewards} onStart={openBriefing} />
        ) : phase === "briefing" ? (
          <BriefingPanel rewards={rewards} onStart={start} />
        ) : phase === "playing" ? (
          <PlayingPanel
            rewards={rewards}
            removedTeeth={removedTeeth}
            mouthClosed={mouthClosed}
            lastPickedTooth={lastPickedTooth}
            lifeIndex={lifeIndex}
            maxLives={MAX_DENTIST_LIVES}
            bestScore={liveBest}
            tuning={tuning}
            onTuningChange={onTuningChange}
            onPickTooth={pickTooth}
          />
        ) : (
          <ResultPanel
            result={result}
            rewards={rewards}
            wonAny={wonAny}
            allowReplay={allowReplay}
            onReplay={start}
            onClose={onClose}
            onOpenPacks={onOpenPacks ?? onClose}
          />
        )}
      </div>
    </div>
  );
}

function SuarezEventHeader({ phase }: { phase: Phase }) {
  const compact = phase !== "intro";

  if (!compact) {
    return (
      <aside className="relative flex min-h-[205px] items-center justify-center overflow-hidden border-b border-white/10 bg-[#071008] p-0 sm:min-h-[235px]">
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(circle_at_50%_74%,rgba(245,197,24,0.16),transparent_28%),radial-gradient(circle_at_24%_42%,rgba(14,165,233,0.14),transparent_30%),radial-gradient(circle_at_78%_38%,rgba(34,197,94,0.12),transparent_32%),linear-gradient(180deg,rgba(0,0,0,0.08),rgba(0,0,0,0.42))]"
        />
        <h2 id="suarez-dentist-title" className="sr-only">
          Suarez
        </h2>
        <Image
          src={SUAREZ_INTRO_SRC}
          alt="Suarez"
          width={720}
          height={520}
          priority
          unoptimized
          sizes="(max-width: 640px) 280px, 350px"
          className="relative z-10 h-auto w-[280px] max-w-[88%] object-contain drop-shadow-[0_22px_34px_rgba(0,0,0,0.68)] sm:w-[350px]"
        />
      </aside>
    );
  }

  return (
    <aside className="relative flex min-h-[104px] items-center justify-center overflow-hidden border-b border-white/10 bg-[#071008] px-4 py-4 text-center sm:min-h-[118px]">
      <div
        aria-hidden
        className="absolute inset-0 bg-[linear-gradient(120deg,rgba(245,197,24,0.08),transparent_34%,rgba(14,165,233,0.1)_76%,transparent),radial-gradient(circle_at_50%_100%,rgba(34,197,94,0.08),transparent_46%)]"
      />

      <div className="relative z-10">
        <p className="text-[9px] font-bold uppercase tracking-[0.22em] text-[#f5c518] sm:text-[10px]">
          Suarez al dentista
        </p>
        <h2
          id="suarez-dentist-title"
          className="mt-1 text-xl font-bold uppercase leading-none text-white sm:text-2xl"
        >
          Cuidado que muerde!
        </h2>
        <p className="mt-2 text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-500 sm:text-[10px]">
          1 sobre extra por diente
        </p>
      </div>
    </aside>
  );
}

function IntroPanel({
  rewards,
  onStart,
}: {
  rewards: SuarezDentistReward[];
  onStart: () => void;
}) {
  return (
    <div className="relative z-10 flex flex-col justify-center px-4 pb-5 pt-5 sm:px-5">
      <span className="self-center rounded-full border border-[#f5c518]/30 bg-[#f5c518]/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#f5c518]">
        Suarez al dentista
      </span>
      <h3 className="mt-3 text-2xl font-bold leading-none tracking-tight text-white sm:text-3xl">
        Cuidado que muerde!
      </h3>

      <div className="mt-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-white/10" />
        <p className="text-[10px] font-bold uppercase tracking-[0.26em] text-[#f5c518]">
          Sobres en juego
        </p>
        <span className="h-px flex-1 bg-white/10" />
      </div>
      <div
        className="mt-3 grid gap-2 text-center"
        style={rewardGridStyle(rewards.length)}
      >
        {rewards.map((reward, index) => (
          <div
            key={reward.title}
            className="rounded-lg border border-emerald-100/12 bg-black/24 px-1 py-2"
          >
            <div className="relative mx-auto aspect-[818/1206] w-8">
              <Image
                src={reward.image}
                alt={reward.title}
                fill
                sizes="48px"
                className="object-contain"
              />
            </div>
            <p className="mt-1 text-[9px] font-bold uppercase leading-tight text-white">
              {reward.title.replace(/^Sobre\s+/i, "")}
            </p>
            <p className="mt-0.5 text-[8px] font-bold uppercase tracking-[0.12em] text-[#f5c518]">
              Diente {index + 1}
            </p>
          </div>
        ))}
      </div>

      <div className="flex sm:justify-center">
        <button
          type="button"
          onClick={onStart}
          className="mt-5 w-full rounded-xl bg-gradient-to-r from-[#22c55e] via-[#f5c518] to-[#ff6a2b] px-5 py-3 text-sm font-bold uppercase tracking-[0.14em] text-[#06120b] shadow-lg shadow-[#ff6a2b]/20 transition hover:brightness-110 sm:w-max sm:min-w-56"
        >
          Adelante!
        </button>
      </div>
    </div>
  );
}

function SuarezLivesRow({
  lives,
  maxLives,
}: {
  lives: number;
  maxLives: number;
}) {
  return (
    <div
      className="flex items-center justify-center gap-2"
      aria-label={`Vidas: ${lives} de ${maxLives}`}
    >
      {Array.from({ length: maxLives }).map((_, index) => {
        const filled = index < lives;
        return (
          <svg
            key={`suarez-life-heart-${index}`}
            viewBox="0 0 24 24"
            aria-hidden
            className={`h-5 w-5 transition-transform duration-150 ${
              filled
                ? "scale-100 drop-shadow-[0_0_6px_rgba(255,59,48,0.45)]"
                : "scale-90"
            }`}
          >
            <path
              d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
              fill={filled ? "#ff3b30" : "rgba(255,255,255,0.1)"}
              stroke={
                filled ? "rgba(255,246,205,0.6)" : "rgba(255,255,255,0.28)"
              }
              strokeWidth="1.4"
            />
          </svg>
        );
      })}
    </div>
  );
}

function BriefingPanel({
  rewards,
  onStart,
}: {
  rewards: SuarezDentistReward[];
  onStart: () => void;
}) {
  return (
    <div className="relative z-10 px-4 pb-5 pt-5 sm:px-5">
      <div className="rounded-2xl border border-white/10 bg-black/24 p-4 text-center">
        <SuarezLivesRow
          lives={MAX_DENTIST_LIVES}
          maxLives={MAX_DENTIST_LIVES}
        />
        <h3 className="mt-4 text-lg font-bold leading-tight text-white sm:text-xl">
          Tienes 2 vidas
        </h3>
        <p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-zinc-300 sm:text-sm">
          Juegas dos partidas. En cada una, quita dientes para ganar sobres y
          cuando Suarez muerda se acaba esa vida. Al final cuenta tu mejor
          partida.
        </p>
      </div>

      <div
        className="mt-4 grid gap-2 text-center"
        style={rewardGridStyle(rewards.length)}
      >
        {rewards.map((reward, index) => (
          <div
            key={reward.title}
            className="rounded-lg border border-emerald-100/12 bg-black/24 px-1 py-2"
          >
            <div className="relative mx-auto aspect-[818/1206] w-8">
              <Image
                src={reward.image}
                alt={reward.title}
                fill
                sizes="48px"
                className="object-contain"
              />
            </div>
            <p className="mt-1 text-[9px] font-bold uppercase leading-tight text-white">
              {reward.title.replace(/^Sobre\s+/i, "")}
            </p>
            <p className="mt-0.5 text-[8px] font-bold uppercase tracking-[0.12em] text-[#f5c518]">
              Diente {index + 1}
            </p>
          </div>
        ))}
      </div>

      <div className="flex sm:justify-center">
        <button
          type="button"
          onClick={onStart}
          className="mt-5 w-full rounded-xl bg-gradient-to-r from-[#22c55e] via-[#f5c518] to-[#ff6a2b] px-5 py-3 text-sm font-bold uppercase tracking-[0.14em] text-[#06120b] shadow-lg shadow-[#ff6a2b]/20 transition hover:brightness-110 sm:w-max sm:min-w-56"
        >
          Empezar vida 1
        </button>
      </div>
    </div>
  );
}

function PlayingPanel({
  rewards,
  removedTeeth,
  mouthClosed,
  lastPickedTooth,
  lifeIndex,
  maxLives,
  bestScore,
  tuning,
  onTuningChange,
  onPickTooth,
}: {
  rewards: SuarezDentistReward[];
  removedTeeth: string[];
  mouthClosed: boolean;
  lastPickedTooth: string | null;
  lifeIndex: number;
  maxLives: number;
  bestScore: number;
  tuning: SuarezDentistTuning;
  onTuningChange?: (tuning: SuarezDentistTuning) => void;
  onPickTooth: (toothId: string) => void;
}) {
  const remainingTeeth = TEETH.length - removedTeeth.length;
  const showInitialHint = removedTeeth.length === 0 && !mouthClosed;
  const lastToothStanding = remainingTeeth === 1 && !mouthClosed;
  const livesRemaining = maxLives - lifeIndex;
  const packToastTooth =
    !mouthClosed && lastPickedTooth && removedTeeth.includes(lastPickedTooth)
      ? TEETH.find((tooth) => tooth.id === lastPickedTooth)
      : null;

  return (
    <div className="relative z-10 px-3 pb-5 pt-4 sm:px-5">
      <div className="mb-3 grid grid-cols-2 gap-2 text-center">
        <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
          <p className="text-[8px] font-bold uppercase tracking-[0.16em] text-zinc-500">
            Vidas
          </p>
          <div className="mt-1">
            <SuarezLivesRow lives={livesRemaining} maxLives={maxLives} />
          </div>
        </div>
        <div className="rounded-lg border border-[#f5c518]/20 bg-[#f5c518]/8 px-3 py-2">
          <p className="text-[8px] font-bold uppercase tracking-[0.16em] text-[#f5c518]">
            Mejor intento
          </p>
          <p className="mt-0.5 text-sm font-bold text-white">
            {bestScore}/{rewards.length}
          </p>
        </div>
      </div>
      <SuarezStage
        className={`suarez-stage-playing max-h-[58vh] w-full shadow-[inset_0_0_42px_rgba(2,6,23,0.1),0_18px_42px_rgba(0,0,0,0.36)] ${
          lastToothStanding ? "suarez-stage-danger" : ""
        } ${packToastTooth ? "suarez-stage-feedback" : ""}`}
        sizes="(max-width: 640px) 94vw, 560px"
      >
        <div
          aria-hidden
          className="suarez-stage-sweep absolute inset-0 z-[2]"
        />
        <div
          className={`absolute inset-0 z-10 ${
            mouthClosed ? "" : "suarez-character-idle"
          }`}
        >
          <Image
            src={mouthClosed ? SUAREZ_CLOSED_SRC : SUAREZ_OPEN_SRC}
            alt={
              mouthClosed
                ? "Suarez con la boca cerrada"
                : "Suarez con la boca abierta"
            }
            fill
            sizes="(max-width: 640px) 94vw, 560px"
            className={`object-contain drop-shadow-[0_18px_22px_rgba(0,0,0,0.28)] ${
              mouthClosed ? "suarez-mouth-slam" : ""
            }`}
            priority
          />

          {!mouthClosed
            ? TEETH.map((tooth, index) => {
                const extracted = removedTeeth.includes(tooth.id);
                const picked = lastPickedTooth === tooth.id;
                return (
                  <ToothButton
                    key={tooth.id}
                    tooth={tooth}
                    index={index}
                    extracted={extracted}
                    picked={picked}
                    hint={showInitialHint && !extracted}
                    tense={lastToothStanding && !extracted}
                    tuning={tuning}
                    onPick={() => onPickTooth(tooth.id)}
                  />
                );
              })
            : null}
        </div>
        {packToastTooth ? (
          <PackToast
            key={`pack-toast-${lastPickedTooth}-${removedTeeth.length}`}
            tooth={packToastTooth}
            tuning={tuning}
          />
        ) : null}

        {mouthClosed ? (
          <div aria-hidden className="absolute inset-0 z-40 bg-red-950/18" />
        ) : null}
      </SuarezStage>

      <div
        className="mt-4 grid gap-2 text-center"
        style={rewardGridStyle(rewards.length)}
      >
        {rewards.map((reward, index) => (
          <RewardCard
            key={reward.title}
            reward={reward}
            state={index < removedTeeth.length ? "earned" : "available"}
          />
        ))}
      </div>
      {onTuningChange ? (
        <SuarezTuningPanel tuning={tuning} onChange={onTuningChange} />
      ) : null}
    </div>
  );
}

function PackToast({
  tooth,
  tuning,
}: {
  tooth: Tooth;
  tuning: SuarezDentistTuning;
}) {
  const left = 50 + (tooth.left - 50) * tuning.spread;
  const style = {
    left: `${left}%`,
    top: `${tooth.top + tuning.toothY / 10}%`,
  } as CSSProperties;

  return (
    <span aria-hidden className="suarez-pack-toast" style={style}>
      +1 SOBRE
    </span>
  );
}

function ToothButton({
  tooth,
  index,
  extracted,
  picked,
  hint,
  tense,
  tuning,
  onPick,
}: {
  tooth: Tooth;
  index: number;
  extracted: boolean;
  picked: boolean;
  hint: boolean;
  tense: boolean;
  tuning: SuarezDentistTuning;
  onPick: () => void;
}) {
  const left = 50 + (tooth.left - 50) * tuning.spread;
  const style = {
    left: `${left}%`,
    top: `${tooth.top}%`,
    width: `${tooth.width * tuning.toothScale}%`,
    "--tooth-rotate": `${tooth.rotate}deg`,
    "--tooth-delay": `${index * 85}ms`,
    "--tooth-y-offset": `${tuning.toothY}px`,
    "--gap-y-offset": `${tuning.gapY}px`,
    "--gap-scale": tuning.gapScale,
    "--gap-width-scale": tuning.gapWidth,
  } as CSSProperties;

  return (
    <button
      type="button"
      aria-label={`Quitar ${tooth.label.toLowerCase()}`}
      disabled={extracted}
      onClick={onPick}
      className={`suarez-tooth-button absolute z-30 aspect-[96/126] -translate-x-1/2 -translate-y-1/2 rounded-md outline-none transition focus-visible:ring-2 focus-visible:ring-[#f5c518] ${
        extracted ? "pointer-events-none" : "cursor-pointer"
      } ${picked ? "suarez-tooth-picked" : ""} ${
        hint ? "suarez-tooth-hint" : ""
      } ${tense ? "suarez-tooth-danger" : ""}`}
      style={style}
    >
      <span
        aria-hidden
        className="suarez-tooth-gap absolute inset-[-26%] transition duration-200"
      />
      <span
        aria-hidden
        className={`suarez-tooth-sprite absolute inset-0 transition duration-200 ${
          extracted ? "scale-50 opacity-0" : "opacity-100"
        }`}
      />
    </button>
  );
}

const TUNING_CONTROLS: {
  key: keyof SuarezDentistTuning;
  label: string;
  min: number;
  max: number;
  step: number;
}[] = [
  { key: "toothY", label: "Diente Y", min: -18, max: 12, step: 1 },
  { key: "toothScale", label: "Diente tam.", min: 0.75, max: 1.25, step: 0.01 },
  { key: "gapY", label: "Hueco Y", min: -10, max: 24, step: 1 },
  { key: "gapScale", label: "Hueco tam.", min: 0.7, max: 1.8, step: 0.01 },
  { key: "gapWidth", label: "Hueco ancho", min: 0.7, max: 1.8, step: 0.01 },
  { key: "spread", label: "Separacion", min: 0.75, max: 1.35, step: 0.01 },
];

function SuarezTuningPanel({
  tuning,
  onChange,
}: {
  tuning: SuarezDentistTuning;
  onChange: (tuning: SuarezDentistTuning) => void;
}) {
  return (
    <div className="mt-4 rounded-xl border border-sky-100/15 bg-black/28 p-3 text-left">
      <div className="grid gap-3 sm:grid-cols-2">
        {TUNING_CONTROLS.map((control) => {
          const value = tuning[control.key];
          return (
            <label key={control.key} className="block">
              <span className="mb-1 flex items-center justify-between gap-3 text-[10px] font-bold uppercase tracking-[0.12em] text-sky-100">
                <span>{control.label}</span>
                <span className="font-mono text-[10px] text-[#f5c518]">
                  {Number.isInteger(value) ? value : value.toFixed(2)}
                </span>
              </span>
              <input
                type="range"
                min={control.min}
                max={control.max}
                step={control.step}
                value={value}
                onChange={(event) =>
                  onChange({
                    ...tuning,
                    [control.key]: Number(event.currentTarget.value),
                  })
                }
                className="h-2 w-full accent-[#f5c518]"
              />
            </label>
          );
        })}
      </div>
      <p className="mt-3 break-all rounded-lg border border-white/10 bg-black/24 px-2 py-1.5 font-mono text-[10px] leading-4 text-zinc-300">
        toothY:{tuning.toothY}; toothScale:{tuning.toothScale.toFixed(2)}; gapY:
        {tuning.gapY}; gapScale:{tuning.gapScale.toFixed(2)}; gapWidth:
        {tuning.gapWidth.toFixed(2)}; spread:{tuning.spread.toFixed(2)}
      </p>
    </div>
  );
}

function ResultPanel({
  result,
  rewards,
  wonAny,
  allowReplay,
  onReplay,
  onClose,
  onOpenPacks,
}: {
  result: SuarezDentistResult | null;
  rewards: SuarezDentistReward[];
  wonAny: boolean;
  allowReplay: boolean;
  onReplay: () => void;
  onClose: () => void;
  onOpenPacks: () => void;
}) {
  const banked = result?.packs ?? 0;
  const busted = result?.busted ?? false;
  const attempts = result?.attempts ?? [];
  const packLabel = banked === 1 ? "sobre" : "sobres";
  const savedLabel = banked === 1 ? "Premio ganado" : "Premios ganados";
  const resultMessage = busted
    ? banked > 0
      ? `Mejor partida: conservas ${banked} ${packLabel}.`
      : "Suarez mordio antes de salvar sobres."
    : `Sacaste todos los dientes seguros y bancaste ${banked} ${packLabel}.`;

  return (
    <div className="relative z-10 flex flex-col items-center px-4 pb-5 pt-4 text-center sm:px-5">
      {wonAny ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-40 overflow-hidden">
          <div className="absolute left-1/2 top-4 h-40 w-40 -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(245,197,24,0.36),transparent_68%)] motion-safe:animate-[ruleta-win-burst_750ms_ease-out_both]" />
          {CONFETTI.map((piece, index) => (
            <span
              key={`suarez-confetti-${index}`}
              className="absolute top-6 h-2 w-2 rounded-[1px] motion-safe:animate-[ruleta-confetti_1100ms_ease-out_both]"
              style={{
                left: piece.left,
                backgroundColor: piece.color,
                animationDelay: piece.delay,
              }}
            />
          ))}
        </div>
      ) : null}

      <div className="relative z-10 mx-auto w-full max-w-[300px]">
        <Image
          src={SUAREZ_INTRO_SRC}
          alt="Suarez con un sobre"
          width={720}
          height={520}
          sizes="310px"
          unoptimized
          className="h-auto w-full object-contain drop-shadow-[0_20px_26px_rgba(0,0,0,0.42)]"
        />
      </div>

      <div className="relative z-10 mt-3 flex min-w-[190px] items-center justify-center gap-3 rounded-2xl border border-[#f5c518]/24 bg-black/24 px-4 py-3 shadow-[0_0_28px_rgba(245,197,24,0.1)]">
        <span className="font-[family-name:var(--font-display)] text-5xl leading-none text-white">
          {banked}
        </span>
        <span className="text-left">
          <span className="block text-[9px] font-bold uppercase tracking-[0.18em] text-[#f5c518]">
            {savedLabel}
          </span>
          <span className="mt-0.5 block text-xl font-bold uppercase leading-none text-zinc-200">
            {packLabel}
          </span>
        </span>
      </div>
      <p className="relative z-10 mt-2 max-w-sm text-xs leading-5 text-zinc-300">
        {resultMessage}
      </p>

      {attempts.length > 0 ? (
        <div className="relative z-10 mt-3 flex flex-wrap justify-center gap-2">
          {attempts.map((score, index) => (
            <span
              key={`suarez-result-life-${index}`}
              className={`rounded-full border px-3 py-1 text-[9px] font-bold uppercase tracking-[0.12em] ${
                score === banked
                  ? "border-[#f5c518]/42 bg-[#f5c518]/12 text-[#f5c518]"
                  : "border-white/10 bg-black/18 text-zinc-500"
              }`}
            >
              Vida {index + 1}: {score}
            </span>
          ))}
        </div>
      ) : null}

      <div
        className="relative z-10 mt-4 grid w-full max-w-sm gap-2"
        style={rewardGridStyle(rewards.length)}
      >
        {rewards.map((reward, index) => (
          <RewardCard
            key={reward.title}
            reward={reward}
            state={index < banked ? "earned" : "lost"}
          />
        ))}
      </div>

      <div className="relative z-10 mt-5 flex w-full flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={wonAny ? onOpenPacks : onClose}
          className="rounded-xl bg-gradient-to-r from-sky-300 via-[#f5c518] to-emerald-400 px-5 py-3 text-sm font-bold uppercase tracking-[0.1em] text-[#07131b] shadow-lg shadow-sky-500/18 transition hover:brightness-110"
        >
          {wonAny ? "Abrir en cofres" : "Cerrar"}
        </button>
        {allowReplay ? (
          <button
            type="button"
            onClick={onReplay}
            className="rounded-xl border border-white/12 px-5 py-3 text-sm font-bold uppercase tracking-[0.1em] text-white transition hover:bg-white/10"
          >
            Repetir
          </button>
        ) : null}
      </div>
    </div>
  );
}

function RewardCard({
  reward,
  state,
}: {
  reward: SuarezDentistReward;
  state: "available" | "earned" | "lost";
}) {
  const earned = state === "earned";
  const lost = state === "lost";

  return (
    <div
      className={`rounded-lg border p-1.5 transition ${
        earned
          ? "border-[#f5c518]/35 bg-emerald-400/[0.07]"
          : lost
            ? "border-white/8 bg-white/[0.015]"
            : "border-sky-100/12 bg-black/24"
      }`}
    >
      <div
        className={`relative mx-auto aspect-[818/1206] w-8 ${
          earned
            ? "drop-shadow-[0_8px_18px_rgba(0,0,0,0.55)]"
            : lost
              ? "opacity-35 grayscale"
              : ""
        }`}
      >
        <Image
          src={reward.image}
          alt={reward.title}
          fill
          sizes="48px"
          className="object-contain"
        />
      </div>
      <p
        className={`mt-1 text-[9px] font-bold uppercase leading-tight ${
          lost ? "text-zinc-500" : "text-white"
        }`}
      >
        {reward.title.replace(/^Sobre\s+/i, "")}
      </p>
      <p
        className={`mt-0.5 text-[8px] font-bold uppercase tracking-[0.1em] ${
          earned ? "text-[#f5c518]" : lost ? "text-zinc-600" : "text-sky-200"
        }`}
      >
        {earned ? "Ganado" : lost ? "Perdido" : "En juego"}
      </p>
    </div>
  );
}
