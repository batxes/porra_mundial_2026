"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

export type RonaldaoLimboReward = {
  image: string;
  pool?: string;
  title: string;
};

export type RonaldaoLimboConfig = {
  id: string;
  rewards?: RonaldaoLimboReward[];
  title: string;
};

export type RonaldaoLimboResult = {
  bankedBeforeBust: number;
  bestRound: number;
  busted: boolean;
  cleared: boolean;
  configId: string;
  finalRisk: number;
  packs: number;
  rewards: RonaldaoLimboReward[];
  roundScores: number[];
  stopped: boolean;
};

export const ronaldaoLimboCompletedEventName =
  "triliporra:ronaldao-limbo-completed";

type Phase = "briefing" | "intro" | "playing" | "result" | "roundBreak";
type DropState = "idle" | "dropping" | "feeding" | "exploding";
type RoundSummary = {
  bankedBeforeBust: number;
  busted: boolean;
  cleared: boolean;
  risk: number;
  round: number;
  score: number;
  stopped: boolean;
};

const CHARACTER_SRC = "/ronaldao-sprite.webp";
const BACKGROUND_SRC = "/ronaldao-buffet-field-bg.webp";
const CHARACTER_SPRITES = [
  "/ronaldao-sprite-slim.webp",
  CHARACTER_SRC,
  "/ronaldao-sprite-fat-1.webp",
  "/ronaldao-sprite-fat-1b.webp",
  "/ronaldao-sprite-fat-2.webp",
  "/ronaldao-sprite-fat-2b.webp",
  "/ronaldao-sprite-fat-3.webp",
] as const;
const PRELOAD_ASSETS = [BACKGROUND_SRC, ...CHARACTER_SPRITES] as const;
const MAX_REWARDS = 6;
const MAX_ROUNDS = 3;
const DROP_MS = 860;
const FEED_MS = 520;
const EXPLOSION_MS = 980;
const RISK_STEPS = [8, 14, 23, 35, 49, 66];

const DEFAULT_REWARDS: RonaldaoLimboReward[] = [
  { image: "/sobre-defensas.webp", pool: "defensas", title: "Sobre Defensas" },
  { image: "/sobre-porteros.webp", pool: "porteros", title: "Sobre Porteros" },
  {
    image: "/sobre-delanteros.webp",
    pool: "delanteros",
    title: "Sobre Delanteros",
  },
  { image: "/sobre-medios.webp", pool: "medios", title: "Sobre Mediocentros" },
  { image: "/sobre21.webp", pool: "sub21", title: "Sobre Promesas" },
  { image: "/sobre-estrellas.webp", pool: "stars", title: "Sobre Estrellas" },
];

const CONFETTI = [
  { color: "#f5c518", delay: "0ms", left: "18%" },
  { color: "#7dd3fc", delay: "70ms", left: "30%" },
  { color: "#ffffff", delay: "120ms", left: "42%" },
  { color: "#22c55e", delay: "40ms", left: "55%" },
  { color: "#ff6a2b", delay: "150ms", left: "68%" },
  { color: "#f5c518", delay: "95ms", left: "78%" },
  { color: "#7dd3fc", delay: "180ms", left: "48%" },
  { color: "#ffffff", delay: "30ms", left: "62%" },
];

const EXPLOSION_BITS = [
  { color: "#fff6b0", delay: "0ms", size: "13px", x: "-84px", y: "-34px" },
  { color: "#f5c518", delay: "24ms", size: "15px", x: "-58px", y: "-78px" },
  { color: "#ff8a24", delay: "42ms", size: "12px", x: "14px", y: "-92px" },
  { color: "#f5c518", delay: "12ms", size: "16px", x: "74px", y: "-52px" },
  { color: "#ff4d2e", delay: "52ms", size: "14px", x: "92px", y: "8px" },
  { color: "#fff6b0", delay: "70ms", size: "11px", x: "56px", y: "62px" },
  { color: "#d92d20", delay: "34ms", size: "14px", x: "-28px", y: "78px" },
  { color: "#ff8a24", delay: "62ms", size: "12px", x: "-88px", y: "38px" },
  { color: "#f5c518", delay: "88ms", size: "10px", x: "6px", y: "48px" },
  { color: "#ffffff", delay: "18ms", size: "9px", x: "36px", y: "-28px" },
];

function riskForPacks(packs: number) {
  return (
    RISK_STEPS[Math.min(Math.max(0, packs), RISK_STEPS.length - 1)] ??
    RISK_STEPS[RISK_STEPS.length - 1] ??
    66
  );
}

function preloadRonaldaoAssets() {
  if (typeof window === "undefined") return;

  PRELOAD_ASSETS.forEach((src) => {
    if (!document.head.querySelector(`link[data-ronaldao-preload="${src}"]`)) {
      const link = document.createElement("link");
      link.as = "image";
      link.href = src;
      link.rel = "preload";
      link.type = "image/webp";
      link.setAttribute("data-ronaldao-preload", src);
      document.head.appendChild(link);
    }

    const image = new window.Image();
    image.decoding = "async";
    image.src = src;
  });
}

function rewardGridStyle(count: number): CSSProperties {
  return {
    gridTemplateColumns: `repeat(${Math.max(1, Math.min(4, count))}, minmax(0, 1fr))`,
  };
}

function rewardRailStyle(count: number): CSSProperties {
  return {
    "--ronaldao-rail-count": Math.max(1, count),
    "--ronaldao-rail-mobile-count": Math.max(1, Math.min(3, count)),
  } as CSSProperties;
}

function safeRewards(rewards?: RonaldaoLimboReward[]) {
  const selected = rewards?.length ? rewards : DEFAULT_REWARDS;
  return selected.slice(0, MAX_REWARDS);
}

function packLabel(count: number) {
  return count === 1 ? "sobre" : "sobres";
}

function characterSpriteForPacks(packs: number) {
  if (packs <= 0) return CHARACTER_SPRITES[0];
  if (packs === 1) return CHARACTER_SPRITES[1];
  if (packs === 2) return CHARACTER_SPRITES[2];
  if (packs === 3) return CHARACTER_SPRITES[3];
  if (packs === 4) return CHARACTER_SPRITES[4];
  if (packs === 5) return CHARACTER_SPRITES[5];
  return CHARACTER_SPRITES[6];
}

function characterScaleForPacks(packs: number) {
  return Math.min(1.12, 1 + Math.max(0, packs) * 0.018);
}

function feedButtonClass(risk: number) {
  const base = "ronaldao-arcade-button ronaldao-arcade-button--feed";
  if (risk >= 66) return `${base} ronaldao-arcade-button--risk-critical`;
  if (risk >= 35) return `${base} ronaldao-arcade-button--risk-high`;
  if (risk >= 14) return `${base} ronaldao-arcade-button--risk-medium`;
  return `${base} ronaldao-arcade-button--risk-low`;
}

function packRailState(index: number, banked: number) {
  if (index < banked) return "earned" as const;
  if (index === banked) return "next" as const;
  return "locked" as const;
}

function riskBadgeClass(risk: number) {
  if (risk >= 66) {
    return "border-rose-200/36 bg-rose-950/76 text-rose-50 shadow-[0_0_24px_rgba(244,63,94,0.28)]";
  }
  if (risk >= 35) {
    return "border-orange-200/34 bg-orange-950/72 text-orange-50 shadow-[0_0_22px_rgba(249,115,22,0.24)]";
  }
  if (risk >= 14) {
    return "border-[#f5c518]/38 bg-[#3a2a05]/72 text-[#fff2a8] shadow-[0_0_18px_rgba(245,197,24,0.18)]";
  }
  return "border-emerald-100/28 bg-emerald-950/64 text-emerald-50 shadow-[0_0_16px_rgba(34,197,94,0.16)]";
}

function RonaldaoLivesRow({
  lives,
  maxLives,
}: {
  lives: number;
  maxLives: number;
}) {
  return (
    <div
      aria-label={`Vidas disponibles: ${lives} de ${maxLives}`}
      className="flex items-center justify-center gap-2"
    >
      {Array.from({ length: maxLives }).map((_, index) => {
        const filled = index < lives;
        return (
          <svg
            aria-hidden
            className={`h-5 w-5 transition-transform duration-150 ${
              filled
                ? "scale-100 drop-shadow-[0_0_6px_rgba(255,59,48,0.45)]"
                : "scale-90"
            }`}
            key={`ronaldao-life-${index}`}
            viewBox="0 0 24 24"
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

function bestScore(scores: number[]) {
  return scores.length ? Math.max(...scores) : 0;
}

function RonaldaoEventHeader({
  phase,
  rewardCount,
  title,
}: {
  phase: Phase;
  rewardCount: number;
  title: string;
}) {
  const compact = phase !== "intro";

  if (!compact) {
    return (
      <aside className="relative flex min-h-[205px] items-center justify-center overflow-hidden border-b border-white/10 bg-[#07131b] p-0 sm:min-h-[235px]">
        <Image
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover object-center opacity-55 [image-rendering:pixelated]"
          fill
          priority
          sizes="(max-width: 640px) 94vw, 560px"
          src={BACKGROUND_SRC}
        />
        <div
          aria-hidden
          className="absolute inset-0 bg-[linear-gradient(180deg,rgba(2,6,23,0.04),rgba(6,19,27,0.64))]"
        />
        <h2 id="ronaldao-limbo-title" className="sr-only">
          {title}
        </h2>
        <div className="relative z-10 h-[205px] w-full overflow-hidden sm:h-[235px]">
          <Image
            alt="Ronaldao"
            className="absolute left-1/2 top-2 h-[285px] w-auto max-w-none -translate-x-1/2 object-contain drop-shadow-[0_24px_34px_rgba(0,0,0,0.62)] [image-rendering:pixelated] sm:h-[325px]"
            height={1254}
            priority
            sizes="(max-width: 640px) 235px, 270px"
            src={CHARACTER_SPRITES[0]}
            unoptimized
            width={1254}
          />
        </div>
      </aside>
    );
  }

  return (
    <aside className="relative flex min-h-[104px] items-center justify-center overflow-hidden border-b border-white/10 bg-[#07131b] px-4 py-4 text-center sm:min-h-[118px]">
      <div
        aria-hidden
        className="absolute inset-0 bg-[linear-gradient(120deg,rgba(34,197,94,0.12),transparent_34%,rgba(245,197,24,0.1)_76%,transparent),linear-gradient(180deg,#08231d,#07131b)]"
      />

      <div className="relative z-10">
        <p className="text-[9px] font-bold uppercase tracking-[0.22em] text-[#f5c518] sm:text-[10px]">
          Ronaldo el de verdad
        </p>
        <h2
          id="ronaldao-limbo-title"
          className="mt-1 text-xl font-bold uppercase leading-none text-white sm:text-2xl"
        >
          {title}
        </h2>
        <p className="mt-2 text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-500 sm:text-[10px]">
          {MAX_ROUNDS} vidas / mejor intento / hasta {rewardCount} sobres
        </p>
      </div>
    </aside>
  );
}

function IntroPanel({
  rewards,
  title,
  onStart,
}: {
  rewards: RonaldaoLimboReward[];
  title: string;
  onStart: () => void;
}) {
  return (
    <div className="relative z-10 flex flex-col justify-center px-4 pb-5 pt-5 sm:px-5">
      <span className="self-center rounded-full border border-[#f5c518]/30 bg-[#f5c518]/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#f5c518]">
        Minijuego / sobres
      </span>
      <h3 className="mt-3 text-center text-2xl font-bold leading-none tracking-tight text-white sm:text-3xl">
        {title}
      </h3>
      <p className="mx-auto mt-2 max-w-xl text-center text-xs leading-5 text-zinc-300 sm:text-sm">
        Tienes 3 vidas. Dale sobres hasta que explote: al final cuenta la vida
        en la que hayas llegado mas lejos.
      </p>

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
          <RewardCard
            key={`${reward.title}-${index}`}
            reward={reward}
            state="available"
            caption={`Sobre ${index + 1}`}
          />
        ))}
      </div>

      <div className="flex sm:justify-center">
        <button
          className="mt-5 w-full rounded-xl bg-gradient-to-r from-[#22c55e] via-[#f5c518] to-[#ff6a2b] px-5 py-3 text-sm font-bold uppercase tracking-[0.14em] text-[#06120b] shadow-lg shadow-[#f5c518]/18 transition hover:brightness-110 sm:w-max sm:min-w-56"
          onClick={onStart}
          type="button"
        >
          Ver reglas
        </button>
      </div>
    </div>
  );
}

function BriefingPanel({
  firstReward,
  maxRounds,
  onStart,
}: {
  firstReward: RonaldaoLimboReward;
  maxRounds: number;
  onStart: () => void;
}) {
  return (
    <div className="relative z-10 px-4 pb-5 pt-5 sm:px-5">
      <div className="rounded-2xl border border-white/10 bg-black/24 p-4 text-center">
        <RonaldaoLivesRow lives={maxRounds} maxLives={maxRounds} />

        <p className="mt-4 text-[10px] font-bold uppercase tracking-[0.24em] text-[#f5c518]">
          Mejor de {maxRounds} vidas
        </p>
        <h3 className="mt-2 text-2xl font-bold uppercase leading-none tracking-tight text-white sm:text-3xl">
          Llega lo mas lejos
        </h3>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-emerald-200/18 bg-emerald-950/24 p-3">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-sky-200">
              Aciertas
            </p>
            <p className="mt-2 font-[family-name:var(--font-display)] text-4xl leading-none text-[#f5c518]">
              +1
            </p>
            <p className="mt-2 text-xs font-bold uppercase tracking-[0.08em] text-emerald-100/82">
              Sube tu marca
            </p>
          </div>

          <div className="rounded-xl border border-rose-200/22 bg-rose-950/28 p-3">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-rose-200">
              Explotar
            </p>
            <p className="mt-2 font-[family-name:var(--font-display)] text-4xl leading-none text-[#ff6a2b]">
              Fin
            </p>
            <p className="mt-2 text-xs font-black uppercase tracking-[0.08em] text-rose-100">
              Pierdes esa vida
            </p>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-center gap-3 rounded-xl border border-emerald-200/12 bg-emerald-950/28 px-3 py-3">
          <div className="relative aspect-[818/1206] w-9 shrink-0">
            <Image
              alt=""
              className="object-contain"
              fill
              sizes="48px"
              src={firstReward.image}
            />
          </div>
          <p className="text-left text-xs font-bold leading-5 text-zinc-300">
            Cada vida empieza de cero. El premio final es tu mejor intento.
          </p>
        </div>
      </div>

      <div className="flex sm:justify-center">
        <button
          className="mt-5 w-full rounded-xl bg-gradient-to-r from-[#22c55e] via-[#f5c518] to-[#ff6a2b] px-5 py-3 text-sm font-bold uppercase tracking-[0.14em] text-[#06120b] shadow-lg shadow-[#f5c518]/18 transition hover:brightness-110 sm:w-max sm:min-w-64"
          onClick={onStart}
          type="button"
        >
          Jugar con {maxRounds} vidas
        </button>
      </div>
    </div>
  );
}

function RonaldaoStage({
  banked,
  currentReward,
  dropKey,
  dropState,
  risk,
}: {
  banked: number;
  currentReward: RonaldaoLimboReward;
  dropKey: number;
  dropState: DropState;
  risk: number;
}) {
  const scale = characterScaleForPacks(banked);
  const sprite = characterSpriteForPacks(banked);
  const danger = risk >= 49 && dropState === "idle";
  const exploding = dropState === "exploding";
  const characterStyle = {
    "--ronaldao-scale": scale,
  } as CSSProperties;

  return (
    <div
      className={`relative aspect-[10/7] max-h-[46vh] w-full overflow-hidden rounded-lg border border-emerald-100/18 bg-[#0d5d38] shadow-[inset_0_0_42px_rgba(2,6,23,0.34),0_18px_42px_rgba(0,0,0,0.36)] ${
        exploding ? "ronaldao-stage-bust" : ""
      }`}
    >
      <Image
        alt=""
        aria-hidden
        className="absolute inset-0 h-full w-full object-cover object-center [image-rendering:pixelated]"
        fill
        priority
        sizes="(max-width: 640px) 94vw, 560px"
        src={BACKGROUND_SRC}
      />
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(circle_at_50%_58%,transparent_0_28%,rgba(0,0,0,0.08)_62%,rgba(0,0,0,0.28)_100%),linear-gradient(180deg,rgba(255,255,255,0.03),transparent_26%,rgba(0,0,0,0.18)_100%)]"
      />

      <div className="absolute left-3 top-3 z-20 rounded-lg border border-black/20 bg-black/28 px-2.5 py-1.5">
        <p className="text-[8px] font-bold uppercase tracking-[0.16em] text-emerald-100/68">
          Volumen
        </p>
        <p className="mt-0.5 text-sm font-black leading-none text-white">
          x{scale.toFixed(2)}
        </p>
      </div>
      <div
        className={`absolute right-3 top-3 z-20 min-w-[96px] rounded-lg border px-2.5 py-2 text-center backdrop-blur-[1px] ${riskBadgeClass(
          risk,
        )}`}
      >
        <p className="text-[8px] font-black uppercase tracking-[0.16em] opacity-80">
          Explota
        </p>
        <p className="mt-0.5 font-[family-name:var(--font-display)] text-3xl leading-none">
          {risk}%
        </p>
      </div>

      {dropState === "dropping" ? (
        <div className="ronaldao-falling-pack" key={dropKey}>
          <Image
            alt=""
            className="h-full w-full object-contain drop-shadow-[0_10px_10px_rgba(0,0,0,0.45)]"
            fill
            sizes="80px"
            src={currentReward.image}
          />
        </div>
      ) : null}

      <span
        aria-hidden
        className="absolute bottom-[5.5%] left-1/2 z-10 h-[5%] w-[28%] -translate-x-1/2 rounded-full bg-black/36 blur-[1px]"
      />
      <div
        className={`ronaldao-character-wrap ${
          dropState === "feeding" ? "ronaldao-character-feed" : ""
        } ${exploding ? "ronaldao-character-bust" : ""}`}
        style={characterStyle}
      >
        <Image
          alt="Ronaldao"
          className={`h-full w-full object-contain [image-rendering:pixelated] ${
            danger ? "ronaldao-character-img-danger" : ""
          }`}
          height={1254}
          priority
          sizes="(max-width: 640px) 250px, 280px"
          src={sprite}
          unoptimized
          width={1254}
        />
      </div>

      {dropState === "feeding" ? (
        <div className="pointer-events-none absolute inset-x-0 top-[29%] z-40 flex justify-center">
          <span className="ronaldao-pack-toast">+1 sobre</span>
        </div>
      ) : null}

      {exploding ? (
        <div aria-hidden className="ronaldao-explosion">
          <span className="ronaldao-explosion-flash" />
          <span className="ronaldao-explosion-smoke ronaldao-explosion-smoke--a" />
          <span className="ronaldao-explosion-smoke ronaldao-explosion-smoke--b" />
          <span className="ronaldao-explosion-smoke ronaldao-explosion-smoke--c" />
          <div className="ronaldao-explosion-burst">
            <span className="ronaldao-explosion-pop">BOOM!</span>
            <span className="ronaldao-explosion-spark ronaldao-explosion-spark--a" />
            <span className="ronaldao-explosion-spark ronaldao-explosion-spark--b" />
          </div>
          {EXPLOSION_BITS.map((bit, index) => (
            <span
              className="ronaldao-explosion-bit"
              key={`ronaldao-bit-${index}`}
              style={
                {
                  "--boom-color": bit.color,
                  "--boom-size": bit.size,
                  "--boom-x": bit.x,
                  "--boom-y": bit.y,
                  animationDelay: bit.delay,
                } as CSSProperties
              }
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function RonaldaoRoundStatus({
  best,
  maxRounds,
  roundIndex,
}: {
  best: number;
  maxRounds: number;
  roundIndex: number;
}) {
  const lives = Math.max(0, maxRounds - roundIndex);

  return (
    <div className="mb-2 flex items-center justify-between gap-3 px-1">
      <div>
        <p className="text-[9px] font-black uppercase tracking-[0.18em] text-[#f5c518]">
          Vida {roundIndex + 1}/{maxRounds}
        </p>
        <p className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-zinc-500">
          Mejor {best} {packLabel(best)}
        </p>
      </div>
      <RonaldaoLivesRow lives={lives} maxLives={maxRounds} />
    </div>
  );
}

function PlayingPanel({
  banked,
  currentReward,
  dropKey,
  dropState,
  maxRounds,
  roundIndex,
  roundScores,
  rewards,
  risk,
  onFeed,
}: {
  banked: number;
  currentReward: RonaldaoLimboReward;
  dropKey: number;
  dropState: DropState;
  maxRounds: number;
  roundIndex: number;
  roundScores: number[];
  rewards: RonaldaoLimboReward[];
  risk: number;
  onFeed: () => void;
}) {
  const resolving = dropState !== "idle";
  const maxed = banked >= rewards.length;

  return (
    <div className="relative z-10 px-3 pb-5 pt-4 sm:px-5">
      <RonaldaoRoundStatus
        best={Math.max(bestScore(roundScores), banked)}
        maxRounds={maxRounds}
        roundIndex={roundIndex}
      />
      <div>
        <RonaldaoStage
          banked={banked}
          currentReward={currentReward}
          dropKey={dropKey}
          dropState={dropState}
          risk={risk}
        />
      </div>

      <div className="ronaldao-play-console">
        <div className="ronaldao-action-row">
          <button
            className={feedButtonClass(risk)}
            disabled={resolving || maxed}
            onClick={onFeed}
            type="button"
          >
            <span className="ronaldao-arcade-button__label">
              {resolving ? "Cayendo..." : "Darle sobre"}
            </span>
          </button>
        </div>

        <div
          className="ronaldao-pack-rail"
          style={rewardRailStyle(rewards.length)}
        >
          {rewards.map((reward, index) => (
            <RewardRailCard
              caption={
                index < banked
                  ? "OK"
                  : index === banked
                    ? "Sigue"
                    : `#${index + 1}`
              }
              index={index}
              key={`${reward.title}-${index}`}
              reward={reward}
              state={packRailState(index, banked)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function RoundBreakPanel({
  maxRounds,
  roundScores,
  summary,
  onNext,
}: {
  maxRounds: number;
  roundScores: number[];
  summary: RoundSummary;
  onNext: () => void;
}) {
  const lives = Math.max(0, maxRounds - summary.round);
  const best = bestScore(roundScores);
  const title = summary.busted
    ? "Vida terminada"
    : summary.cleared
      ? "Vida perfecta"
      : "Marca registrada";
  const bustMessage =
    summary.score > 0
      ? `Has llegado a ${summary.score} ${packLabel(
          summary.score,
        )} antes de explotar. Esa marca se queda.`
      : "Exploto al primer sobre. Esta vida se queda en cero.";

  return (
    <div className="relative z-10 px-4 pb-5 pt-5 text-center sm:px-5">
      <div className="rounded-2xl border border-white/10 bg-black/24 p-4">
        <RonaldaoLivesRow lives={lives} maxLives={maxRounds} />
        <p className="mt-4 text-[10px] font-bold uppercase tracking-[0.24em] text-[#f5c518]">
          Vida {summary.round}/{maxRounds}
        </p>
        <h3 className="mt-2 text-2xl font-bold uppercase leading-none text-white sm:text-3xl">
          {title}
        </h3>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-sky-200/12 bg-sky-950/18 p-3">
            <p className="text-[9px] font-black uppercase tracking-[0.18em] text-sky-200">
              Esta vida
            </p>
            <p className="mt-2 font-[family-name:var(--font-display)] text-5xl leading-none text-white">
              {summary.score}
            </p>
            <p className="mt-1 text-[9px] font-bold uppercase tracking-[0.1em] text-zinc-400">
              {packLabel(summary.score)}
            </p>
          </div>
          <div className="rounded-xl border border-[#f5c518]/18 bg-[#3a2a05]/20 p-3">
            <p className="text-[9px] font-black uppercase tracking-[0.18em] text-[#f5c518]">
              Mejor
            </p>
            <p className="mt-2 font-[family-name:var(--font-display)] text-5xl leading-none text-[#f5c518]">
              {best}
            </p>
            <p className="mt-1 text-[9px] font-bold uppercase tracking-[0.1em] text-zinc-400">
              {packLabel(best)}
            </p>
          </div>
        </div>
        <p className="mx-auto mt-4 max-w-sm text-xs font-bold leading-5 text-zinc-300">
          {summary.busted
            ? bustMessage
            : "Marca maxima. Has llegado hasta el final de la cadena."}
        </p>
      </div>

      <div className="flex sm:justify-center">
        <button
          className="mt-5 w-full rounded-xl bg-gradient-to-r from-[#22c55e] via-[#f5c518] to-[#ff6a2b] px-5 py-3 text-sm font-bold uppercase tracking-[0.14em] text-[#06120b] shadow-lg shadow-[#f5c518]/18 transition hover:brightness-110 sm:w-max sm:min-w-64"
          onClick={onNext}
          type="button"
        >
          Siguiente vida
        </button>
      </div>
    </div>
  );
}

function ResultPanel({
  allowReplay,
  onClose,
  onOpenPacks,
  onReplay,
  result,
  rewards,
}: {
  allowReplay: boolean;
  onClose: () => void;
  onOpenPacks: () => void;
  onReplay: () => void;
  result: RonaldaoLimboResult;
  rewards: RonaldaoLimboReward[];
}) {
  const banked = result.packs;
  const wonAny = banked > 0;
  const label = packLabel(banked);
  const resultMessage = wonAny
    ? result.cleared
      ? `Vida perfecta: aguantaste todos los sobres. Te llevas ${banked} ${label}.`
      : `Tu mejor vida fue la ${result.bestRound}: te llevas ${banked} ${label}.`
    : "No pasaste del primer sobre en ninguna vida. Esta vez no hay premio.";

  const characterStyle = {
    "--ronaldao-scale": characterScaleForPacks(banked),
  } as CSSProperties;
  const sprite = characterSpriteForPacks(banked);

  return (
    <div className="relative z-10 flex flex-col items-center px-4 pb-5 pt-4 text-center sm:px-5">
      {wonAny ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-40 overflow-hidden">
          <div className="absolute left-1/2 top-4 h-40 w-40 -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(245,197,24,0.36),transparent_68%)] motion-safe:animate-[ruleta-win-burst_750ms_ease-out_both]" />
          {CONFETTI.map((piece, index) => (
            <span
              className="absolute top-6 h-2 w-2 rounded-[1px] motion-safe:animate-[ruleta-confetti_1100ms_ease-out_both]"
              key={`ronaldao-confetti-${index}`}
              style={{
                animationDelay: piece.delay,
                backgroundColor: piece.color,
                left: piece.left,
              }}
            />
          ))}
        </div>
      ) : null}

      <div className="relative z-10 mx-auto h-[220px] w-full max-w-[320px] overflow-hidden sm:h-[238px]">
        {result.busted ? (
          <div className="absolute inset-x-0 top-8 mx-auto flex h-44 w-44 items-center justify-center rounded-full border border-rose-300/20 bg-[radial-gradient(circle,#ffcf5a_0%,#ff6a2b_34%,rgba(127,29,29,0.86)_62%,transparent_72%)] shadow-[0_0_40px_rgba(255,106,43,0.28)]">
            <span className="font-[family-name:var(--font-display)] text-4xl leading-none text-white drop-shadow-[0_3px_0_rgba(0,0,0,0.45)]">
              BOOM
            </span>
          </div>
        ) : (
          <div className="ronaldao-result-character" style={characterStyle}>
            <Image
              alt="Ronaldao"
              className="h-full w-full object-contain [image-rendering:pixelated]"
              height={1254}
              priority
              sizes="310px"
              src={sprite}
              unoptimized
              width={1254}
            />
          </div>
        )}
      </div>

      <div className="relative z-10 mt-3 flex min-w-[190px] items-center justify-center gap-3 rounded-2xl border border-[#f5c518]/24 bg-black/24 px-4 py-3 shadow-[0_0_28px_rgba(245,197,24,0.1)]">
        <span className="font-[family-name:var(--font-display)] text-5xl leading-none text-white">
          {banked}
        </span>
        <span className="text-left">
          <span className="block text-[9px] font-bold uppercase tracking-[0.18em] text-[#f5c518]">
            {banked === 1 ? "Premio ganado" : "Premios ganados"}
          </span>
          <span className="mt-0.5 block text-xl font-bold uppercase leading-none text-zinc-200">
            {label}
          </span>
        </span>
      </div>
      <p className="relative z-10 mt-2 max-w-sm text-xs leading-5 text-zinc-300">
        {resultMessage}
      </p>
      <div className="relative z-10 mt-3 flex justify-center gap-2">
        {result.roundScores.map((score, index) => (
          <span
            className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-black uppercase tracking-[0.08em] ${
              index + 1 === result.bestRound
                ? "border-[#f5c518]/55 bg-[#f5c518]/12 text-[#f5c518]"
                : "border-white/10 bg-white/[0.03] text-zinc-400"
            }`}
            key={`ronaldao-final-round-${index}`}
          >
            V{index + 1}: {score}
          </span>
        ))}
      </div>

      <div className="relative z-10 mt-5 flex w-full flex-wrap justify-center gap-2">
        <button
          className="rounded-xl bg-gradient-to-r from-sky-300 via-[#f5c518] to-emerald-400 px-5 py-3 text-sm font-bold uppercase tracking-[0.1em] text-[#07131b] shadow-lg shadow-sky-500/18 transition hover:brightness-110"
          onClick={wonAny ? onOpenPacks : onClose}
          type="button"
        >
          {wonAny ? "Abrir en cofres" : "Cerrar"}
        </button>
        {allowReplay ? (
          <button
            className="rounded-xl border border-white/12 px-5 py-3 text-sm font-bold uppercase tracking-[0.1em] text-white transition hover:bg-white/10"
            onClick={onReplay}
            type="button"
          >
            Repetir
          </button>
        ) : null}
      </div>

      <div
        className="relative z-10 mt-4 grid w-full max-w-sm gap-2"
        style={rewardGridStyle(rewards.length)}
      >
        {rewards.map((reward, index) => (
          <RewardCard
            key={`${reward.title}-${index}`}
            reward={reward}
            state={wonAny && index < banked ? "earned" : "lost"}
            caption={wonAny && index < banked ? "Ganado" : "Perdido"}
          />
        ))}
      </div>
    </div>
  );
}

function RewardRailCard({
  caption,
  index,
  reward,
  state,
}: {
  caption: string;
  index: number;
  reward: RonaldaoLimboReward;
  state: "earned" | "locked" | "next";
}) {
  return (
    <div
      aria-label={`${reward.title}: ${caption}`}
      className={`ronaldao-pack-token ronaldao-pack-token--${state}`}
    >
      <span className="ronaldao-pack-token__step">{index + 1}</span>
      <span className="ronaldao-pack-token__art">
        <Image
          alt=""
          className="object-contain"
          fill
          sizes="44px"
          src={reward.image}
        />
      </span>
      <span className="ronaldao-pack-token__caption">{caption}</span>
    </div>
  );
}

function RewardCard({
  caption,
  reward,
  state,
}: {
  caption: string;
  reward: RonaldaoLimboReward;
  state: "available" | "earned" | "lost";
}) {
  const earned = state === "earned";
  const lost = state === "lost";

  return (
    <div
      className={`rounded-lg border p-1.5 text-center transition ${
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
          alt={reward.title}
          className="object-contain"
          fill
          sizes="48px"
          src={reward.image}
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
        {caption}
      </p>
    </div>
  );
}

export function RonaldaoLimboModal({
  allowReplay = true,
  config,
  onClose,
  onCompleted,
  onOpenPacks,
}: {
  allowReplay?: boolean;
  config: RonaldaoLimboConfig;
  onClose: () => void;
  onCompleted?: (result: RonaldaoLimboResult) => void;
  onOpenPacks?: () => void;
}) {
  const rewards = useMemo(() => safeRewards(config.rewards), [config.rewards]);
  const [phase, setPhase] = useState<Phase>("intro");
  const [banked, setBanked] = useState(0);
  const [dropState, setDropState] = useState<DropState>("idle");
  const [dropKey, setDropKey] = useState(0);
  const [lastRisk, setLastRisk] = useState(riskForPacks(0));
  const [lastRound, setLastRound] = useState<RoundSummary | null>(null);
  const [result, setResult] = useState<RonaldaoLimboResult | null>(null);
  const [roundIndex, setRoundIndex] = useState(0);
  const [roundScores, setRoundScores] = useState<number[]>([]);
  const completedRef = useRef(false);
  const timersRef = useRef<number[]>([]);

  useEffect(() => {
    preloadRonaldaoAssets();
  }, []);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current = [];
  }, []);

  const queueTimer = useCallback((callback: () => void, delay: number) => {
    const timer = window.setTimeout(callback, delay);
    timersRef.current.push(timer);
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const finishMatch = useCallback(
    ({ scores, summary }: { scores: number[]; summary: RoundSummary }) => {
      if (completedRef.current) return;
      completedRef.current = true;
      const earnedCount = bestScore(scores);
      const earnedRewards = rewards.slice(0, earnedCount);
      const bestIndex = Math.max(0, scores.indexOf(earnedCount));
      const nextResult: RonaldaoLimboResult = {
        bankedBeforeBust: summary.bankedBeforeBust,
        bestRound: bestIndex + 1,
        busted: earnedCount === 0,
        cleared: earnedCount >= rewards.length,
        configId: config.id,
        finalRisk: summary.risk,
        packs: earnedRewards.length,
        rewards: earnedRewards,
        roundScores: scores,
        stopped: summary.stopped,
      };
      setResult(nextResult);
      setDropState("idle");
      setPhase("result");
      onCompleted?.(nextResult);
    },
    [config.id, onCompleted, rewards],
  );

  const completeRound = useCallback(
    (summary: RoundSummary) => {
      const nextScores = [...roundScores, summary.score];
      setRoundScores(nextScores);
      setLastRound(summary);
      setDropState("idle");

      if (
        nextScores.length >= MAX_ROUNDS ||
        bestScore(nextScores) >= rewards.length
      ) {
        finishMatch({ scores: nextScores, summary });
        return;
      }

      setPhase("roundBreak");
    },
    [finishMatch, rewards.length, roundScores],
  );

  const startGame = useCallback(() => {
    clearTimers();
    completedRef.current = false;
    setBanked(0);
    setDropState("idle");
    setDropKey(0);
    setLastRisk(riskForPacks(0));
    setLastRound(null);
    setResult(null);
    setRoundIndex(0);
    setRoundScores([]);
    setPhase("playing");
  }, [clearTimers]);

  const showBriefing = useCallback(() => {
    clearTimers();
    setPhase("briefing");
  }, [clearTimers]);

  const startNextRound = useCallback(() => {
    clearTimers();
    setBanked(0);
    setDropState("idle");
    setDropKey(0);
    setLastRisk(riskForPacks(0));
    setRoundIndex(roundScores.length);
    setPhase("playing");
  }, [clearTimers, roundScores.length]);

  const handleFeed = useCallback(() => {
    if (
      phase !== "playing" ||
      dropState !== "idle" ||
      banked >= rewards.length
    ) {
      return;
    }

    const risk = riskForPacks(banked);
    const busted = Math.random() * 100 < risk;
    const nextBanked = banked + 1;
    setLastRisk(risk);
    setDropState("dropping");
    setDropKey((current) => current + 1);

    queueTimer(() => {
      if (busted) {
        setDropState("exploding");
        queueTimer(() => {
          completeRound({
            bankedBeforeBust: banked,
            busted: true,
            cleared: false,
            risk,
            round: roundIndex + 1,
            score: banked,
            stopped: false,
          });
        }, EXPLOSION_MS);
        return;
      }

      setBanked(nextBanked);
      setDropState("feeding");

      if (nextBanked >= rewards.length) {
        queueTimer(() => {
          completeRound({
            bankedBeforeBust: nextBanked,
            busted: false,
            cleared: true,
            risk,
            round: roundIndex + 1,
            score: nextBanked,
            stopped: false,
          });
        }, FEED_MS + 250);
        return;
      }

      queueTimer(() => {
        setDropState("idle");
      }, FEED_MS);
    }, DROP_MS);
  }, [
    banked,
    completeRound,
    dropState,
    phase,
    queueTimer,
    rewards.length,
    roundIndex,
  ]);

  const risk = riskForPacks(banked);
  const currentReward =
    rewards[Math.min(banked, rewards.length - 1)] ?? rewards[0];

  return (
    <div
      aria-labelledby="ronaldao-limbo-title"
      aria-modal="true"
      className="fixed inset-0 z-[120] flex items-center justify-center overflow-x-hidden overflow-y-auto bg-black/82 px-3 py-3 text-white backdrop-blur-sm sm:px-6 sm:py-4"
      role="dialog"
    >
      <div className="theme-dark relative max-h-[calc(100vh-24px)] w-full max-w-xl overflow-x-hidden overflow-y-auto rounded-2xl border border-emerald-200/20 bg-[#07131b] text-white shadow-2xl shadow-black/70 motion-safe:animate-[adivina-pop_220ms_cubic-bezier(0.22,1,0.36,1)_both]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(145deg,rgba(34,197,94,0.16),transparent_35%,rgba(245,197,24,0.12)_70%,rgba(255,106,43,0.13))]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-200/80 to-transparent"
        />

        <button
          aria-label="Cerrar"
          className="hidden"
          onClick={onClose}
          type="button"
        >
          X
        </button>

        <RonaldaoEventHeader
          phase={phase}
          rewardCount={rewards.length}
          title={config.title}
        />

        {phase === "intro" ? (
          <IntroPanel
            rewards={rewards}
            title={config.title}
            onStart={showBriefing}
          />
        ) : null}

        {phase === "briefing" && currentReward ? (
          <BriefingPanel
            firstReward={currentReward}
            maxRounds={MAX_ROUNDS}
            onStart={startGame}
          />
        ) : null}

        {phase === "playing" && currentReward ? (
          <PlayingPanel
            banked={banked}
            currentReward={currentReward}
            dropKey={dropKey}
            dropState={dropState}
            maxRounds={MAX_ROUNDS}
            roundIndex={roundIndex}
            roundScores={roundScores}
            rewards={rewards}
            risk={
              dropState === "dropping" || dropState === "exploding"
                ? lastRisk
                : risk
            }
            onFeed={handleFeed}
          />
        ) : null}

        {phase === "roundBreak" && lastRound ? (
          <RoundBreakPanel
            maxRounds={MAX_ROUNDS}
            roundScores={roundScores}
            summary={lastRound}
            onNext={startNextRound}
          />
        ) : null}

        {phase === "result" && result ? (
          <ResultPanel
            allowReplay={allowReplay}
            result={result}
            rewards={rewards}
            onReplay={startGame}
            onClose={onClose}
            onOpenPacks={onOpenPacks ?? onClose}
          />
        ) : null}
      </div>
    </div>
  );
}
