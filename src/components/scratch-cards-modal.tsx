"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

export type ScratchCardReward = {
  image: string;
  pool?: string;
  title: string;
};

export type ScratchCardsConfig = {
  cardCount?: number;
  id: string;
  rewardSequence?: string[];
  rewards?: ScratchCardReward[];
  title: string;
  winChance?: number;
};

export type ScratchCardPlay = {
  id: string;
  revealed: boolean;
  revealedSlots: boolean[];
  reward: ScratchCardReward | null;
  slots: ScratchCardReward[];
  won: boolean;
};

export type ScratchCardsResult = {
  cardCount: number;
  cards: ScratchCardPlay[];
  configId: string;
  packs: number;
  rewards: ScratchCardReward[];
  winChance: number;
};

export const scratchCardsCompletedEventName =
  "triliporra:scratch-cards-completed";

type Phase = "intro" | "playing" | "result";

const DEFAULT_CARD_COUNT = 5;
const DEFAULT_WIN_CHANCE = 0.33;
const DEFAULT_REWARD_SEQUENCE = [
  "defensas",
  "medios",
  "porteros",
  "stars",
  "medios",
];
const SCRATCH_REVEAL_THRESHOLD = 0.34;
const SCRATCH_ELITE_BACKGROUND_SRC = "/rasca-elite-stadium-bg.png";
const SCRATCH_JUANMA_SRC = "/rasca-juanma.png";
const SCRATCH_TICKET_SRC = "/rasca-ticket-clean.png";

const DEFAULT_REWARDS: ScratchCardReward[] = [
  { image: "/sobre-defensas.webp", pool: "defensas", title: "Sobre Defensas" },
  { image: "/sobre-medios.webp", pool: "medios", title: "Sobre Mediocentros" },
  {
    image: "/sobre-delanteros.webp",
    pool: "delanteros",
    title: "Sobre Delanteros",
  },
  { image: "/sobre-porteros.webp", pool: "porteros", title: "Sobre Porteros" },
  { image: "/sobre-estrellas.webp", pool: "stars", title: "Sobre Estrellas" },
];

const CONFETTI = [
  { color: "#f5c518", delay: "0ms", left: "18%" },
  { color: "#7dd3fc", delay: "70ms", left: "30%" },
  { color: "#ffffff", delay: "120ms", left: "42%" },
  { color: "#22c55e", delay: "40ms", left: "55%" },
  { color: "#f472b6", delay: "150ms", left: "68%" },
  { color: "#f5c518", delay: "95ms", left: "78%" },
  { color: "#7dd3fc", delay: "180ms", left: "48%" },
  { color: "#ffffff", delay: "30ms", left: "62%" },
];

const SCRATCH_REVEAL_SPARKS = [
  { delay: "0ms", left: "13%", top: "18%" },
  { delay: "45ms", left: "28%", top: "8%" },
  { delay: "95ms", left: "72%", top: "10%" },
  { delay: "35ms", left: "86%", top: "24%" },
  { delay: "120ms", left: "18%", top: "78%" },
  { delay: "70ms", left: "78%", top: "76%" },
];

function clampCardCount(value?: number) {
  return Math.max(1, Math.min(10, Math.trunc(value || DEFAULT_CARD_COUNT)));
}

function clampWinChance(value?: number) {
  if (!Number.isFinite(value)) return DEFAULT_WIN_CHANCE;
  return Math.max(0, Math.min(1, Number(value)));
}

function rewardGridStyle(count: number): CSSProperties {
  return {
    gridTemplateColumns: `repeat(${Math.max(1, Math.min(5, count))}, minmax(0, 1fr))`,
  };
}

function pickReward(rewards: ScratchCardReward[]) {
  return rewards[Math.floor(Math.random() * rewards.length)] || rewards[0];
}

function pickDifferentReward(
  rewards: ScratchCardReward[],
  current: ScratchCardReward,
) {
  const alternatives = rewards.filter(
    (reward) =>
      (reward.pool || reward.title) !== (current.pool || current.title),
  );
  return pickReward(alternatives.length ? alternatives : rewards);
}

function rewardKey(reward: ScratchCardReward) {
  return `${reward.pool || ""} ${reward.title}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function findRewardByKey(rewards: ScratchCardReward[], key: string) {
  const normalized = key
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const aliases: Record<string, string[]> = {
    defensa: ["defensa", "defensas"],
    defensas: ["defensa", "defensas"],
    medio: ["medio", "medios", "mediocentro", "mediocentros"],
    medios: ["medio", "medios", "mediocentro", "mediocentros"],
    portero: ["portero", "porteros"],
    porteros: ["portero", "porteros"],
    estrella: ["estrella", "estrellas", "star", "stars"],
    estrellas: ["estrella", "estrellas", "star", "stars"],
    star: ["estrella", "estrellas", "star", "stars"],
    stars: ["estrella", "estrellas", "star", "stars"],
  };
  const candidates = aliases[normalized] || [normalized];
  return rewards.find((reward) => {
    const current = rewardKey(reward);
    return candidates.some((candidate) => current.includes(candidate));
  });
}

function shuffleRewards(slots: ScratchCardReward[]) {
  return [...slots].sort(() => Math.random() - 0.5);
}

function safeRewards(rewards?: ScratchCardReward[]) {
  const selected = rewards?.length ? rewards : DEFAULT_REWARDS;
  return selected.slice(0, 8);
}

function buildScratchCards({
  cardCount,
  rewardSequence = DEFAULT_REWARD_SEQUENCE,
  rewards,
  winChance,
}: {
  cardCount: number;
  rewardSequence?: string[];
  rewards: ScratchCardReward[];
  winChance: number;
}): ScratchCardPlay[] {
  return Array.from({ length: cardCount }, (_, index) => {
    const sequenceKey =
      rewardSequence[index % Math.max(1, rewardSequence.length)] ||
      DEFAULT_REWARD_SEQUENCE[index % DEFAULT_REWARD_SEQUENCE.length];
    const roundReward = findRewardByKey(rewards, sequenceKey) || pickReward(rewards);
    const winning = Math.random() < winChance;
    if (winning) {
      return {
        id: `scratch-${index + 1}-${Math.random().toString(16).slice(2)}`,
        revealed: false,
        revealedSlots: [false, false, false],
        reward: roundReward,
        slots: [roundReward, roundReward, roundReward],
        won: true,
      };
    }

    const slots = shuffleRewards([
      roundReward,
      pickDifferentReward(rewards, roundReward),
      pickReward(rewards),
    ]);
    if (
      slots.every(
        (slot) =>
          (slot.pool || slot.title) === (roundReward.pool || roundReward.title),
      )
    ) {
      slots[1] = pickDifferentReward(rewards, roundReward);
    }

    return {
      id: `scratch-${index + 1}-${Math.random().toString(16).slice(2)}`,
      revealed: false,
      revealedSlots: [false, false, false],
      reward: null,
      slots,
      won: false,
    };
  });
}

function packLabel(count: number) {
  return count === 1 ? "sobre" : "sobres";
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function drawScratchLayer(canvas: HTMLCanvasElement) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, width, height);

  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#f8fafc");
  gradient.addColorStop(0.2, "#a1a1aa");
  gradient.addColorStop(0.5, "#e4e4e7");
  gradient.addColorStop(0.78, "#71717a");
  gradient.addColorStop(1, "#f4f4f5");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.globalAlpha = 0.22;
  for (let i = 0; i < 220; i += 1) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    const size = 1 + Math.random() * 3;
    ctx.fillStyle = i % 2 ? "#ffffff" : "#111827";
    ctx.fillRect(x, y, size, size);
  }
  ctx.globalAlpha = 1;

  ctx.globalAlpha = 0.3;
  ctx.strokeStyle = "#111827";
  ctx.lineWidth = 2;
  for (let x = -height; x < width + height; x += 18) {
    ctx.beginPath();
    ctx.moveTo(x, height);
    ctx.lineTo(x + height, 0);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = "rgba(15,23,42,0.24)";
  ctx.font = `900 ${Math.max(13, Math.min(22, width * 0.17))}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("RASCA", width / 2, height / 2);
}

function scratchProgress(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx || canvas.width <= 0 || canvas.height <= 0) return 0;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let transparent = 0;
  let total = 0;
  for (let index = 3; index < image.data.length; index += 32) {
    total += 1;
    if (image.data[index] < 40) transparent += 1;
  }
  return total ? transparent / total : 0;
}

function ScratchSurface({
  disabled,
  label = "Rascar casilla",
  revealed,
  onReveal,
}: {
  disabled?: boolean;
  label?: string;
  revealed: boolean;
  onReveal: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const progressRef = useRef(0);
  const [coin, setCoin] = useState<{ active: boolean; x: number; y: number }>({
    active: false,
    x: 50,
    y: 50,
  });

  useEffect(() => {
    if (revealed) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawScratchLayer(canvas);
    const observer = new ResizeObserver(() => {
      if (!revealed) drawScratchLayer(canvas);
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [revealed]);

  const scratchAt = useCallback(
    (clientX: number, clientY: number) => {
      if (disabled || revealed) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const dpr = window.devicePixelRatio || 1;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = "destination-out";
      ctx.beginPath();
      ctx.arc(x, y, Math.max(24, rect.width * 0.065), 0, Math.PI * 2);
      ctx.fill();

      setCoin({
        active: true,
        x: (x / Math.max(1, rect.width)) * 100,
        y: (y / Math.max(1, rect.height)) * 100,
      });

      progressRef.current = scratchProgress(canvas);
      if (progressRef.current >= SCRATCH_REVEAL_THRESHOLD) {
        onReveal();
      }
    },
    [disabled, onReveal, revealed],
  );

  return (
    <>
      <canvas
        aria-label={label}
        className={`scratch-card-cover absolute inset-0 z-20 h-full w-full select-none touch-none rounded-lg transition-opacity duration-300 ${
          revealed ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onReveal();
          }
        }}
        onPointerCancel={() => {
          drawingRef.current = false;
          setCoin((current) => ({ ...current, active: false }));
        }}
        onPointerDown={(event) => {
          if (disabled || revealed) return;
          event.preventDefault();
          drawingRef.current = true;
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch {
            // Algunos entornos de test disparan PointerEvent sintetico sin captura activa.
          }
          scratchAt(event.clientX, event.clientY);
        }}
        onPointerLeave={() => {
          if (!drawingRef.current) {
            setCoin((current) => ({ ...current, active: false }));
          }
        }}
        onPointerMove={(event) => {
          if (!drawingRef.current) return;
          event.preventDefault();
          scratchAt(event.clientX, event.clientY);
        }}
        onPointerUp={(event) => {
          drawingRef.current = false;
          try {
            event.currentTarget.releasePointerCapture(event.pointerId);
          } catch {
            // Puede no existir captura si el navegador la rechazo en pointerdown.
          }
          setCoin((current) => ({ ...current, active: false }));
        }}
        ref={canvasRef}
        role="button"
        tabIndex={revealed ? -1 : 0}
      />
      {!revealed ? (
        <ScratchCoin active={coin.active} x={coin.x} y={coin.y} />
      ) : null}
    </>
  );
}

function ScratchCoin({
  active,
  x,
  y,
}: {
  active: boolean;
  x: number;
  y: number;
}) {
  return (
    <span
      aria-hidden
      className={`scratch-coin ${active ? "scratch-coin--active" : ""}`}
      style={{ left: `${x}%`, top: `${y}%` }}
    >
      <span className="scratch-coin__shine" />
    </span>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function TicketCard({
  card,
  index,
  totalRounds,
  onRevealSlot,
}: {
  card: ScratchCardPlay;
  index: number;
  totalRounds: number;
  onRevealSlot: (cardId: string, slotIndex: number) => void;
}) {
  const won = card.revealed && card.won;
  const lost = card.revealed && !card.won;
  const revealedSlotCount = card.revealedSlots.filter(Boolean).length;

  return (
    <article
      className={`scratch-ticket scratch-ticket--arcade relative overflow-hidden rounded-xl border-2 p-2 transition ${
        won
          ? "border-[#f5c518] bg-[#17210d]"
          : lost
            ? "border-[#70402a] bg-[#1b1021]"
            : "border-[#f5c518]/80 bg-[#07131b]"
      }`}
    >
      <div className="scratch-ticket__inner scratch-ticket__inner--generated relative overflow-hidden rounded-lg px-3 pb-3 pt-4 sm:px-5 sm:pb-4">
        <Image
          alt=""
          className="scratch-ticket__art-bg"
          fill
          priority
          sizes="(max-width: 768px) 95vw, 640px"
          src={SCRATCH_TICKET_SRC}
        />
        <div aria-hidden className="scratch-ticket__art-shade" />

        <div
          className="scratch-ticket__corner scratch-ticket__corner--label"
          aria-hidden
        >
          RASCA
          <br />Y GANA
        </div>

        <div className="relative z-10 mx-auto flex w-max items-center gap-2">
          <span className="scratch-ticket__star" aria-hidden>
            ★
          </span>
          <span className="scratch-ticket__cup" aria-hidden />
          <span className="scratch-ticket__star" aria-hidden>
            ★
          </span>
        </div>

        <div className="scratch-ticket__title relative z-10 text-center">
          <p className="text-[9px] font-bold uppercase tracking-[0.22em] text-sky-200 sm:text-[10px]">
            Ronda {index + 1} / {totalRounds}
          </p>
          <h3 className="mt-1 font-[family-name:var(--font-display)] text-4xl font-bold uppercase leading-none text-[#f5c518] drop-shadow-[0_4px_0_rgba(0,0,0,0.65)] sm:text-6xl">
            TRILIPORRA
          </h3>
          <div className="scratch-ticket__banner mx-auto mt-1 w-max px-5 py-1 text-xs font-bold uppercase tracking-[0.16em] text-white sm:text-sm">
            Rasca y gana
          </div>
        </div>

        <div className="scratch-ticket__scratch-zone scratch-ticket__scratch-zone--individual relative z-10 mt-4 rounded-xl p-2">
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {card.slots.map((slot, slotIndex) => {
              const slotRevealed =
                card.revealed || Boolean(card.revealedSlots[slotIndex]);
              return (
                <div
                  className={`scratch-slot-box scratch-slot-box--individual relative aspect-[5/4] overflow-hidden rounded-lg p-1.5 sm:p-2 ${
                    slotRevealed ? "scratch-slot-box--revealed" : ""
                  }`}
                  key={`${card.id}-${slotIndex}`}
                >
                  <div className="relative z-10 h-full w-full">
                    <Image
                      alt={slot.title}
                      className={`object-contain drop-shadow-[0_10px_16px_rgba(0,0,0,0.48)] transition duration-300 ${
                        slotRevealed
                          ? "scale-100 opacity-100"
                          : "scale-95 opacity-20"
                      }`}
                      fill
                      sizes="(max-width: 640px) 27vw, 150px"
                      src={slot.image}
                    />
                  </div>
                  <ScratchSurface
                    label={`Rascar casilla ${slotIndex + 1}`}
                    revealed={slotRevealed}
                    onReveal={() => onRevealSlot(card.id, slotIndex)}
                  />
                </div>
              );
            })}
          </div>
        </div>

        <div className=" relative z-10 mx-auto mt-3 px-4 py-2 text-center text-[11px] font-bold uppercase tracking-[0.14em] text-white sm:text-sm">
          3 sobres iguales <span>para ganar</span>
        </div>

        <p
          className={`relative z-10 mt-2 text-center text-[10px] font-bold uppercase tracking-[0.16em] sm:text-xs ${
            won ? "text-[#f5c518]" : lost ? "text-zinc-400" : "text-sky-200"
          }`}
        >
          {won
            ? `${card.reward?.title || "Sobre ganado"}`
            : lost
              ? "No ha salido triple"
              : `${revealedSlotCount}/3 casillas rascadas`}
        </p>
      </div>
    </article>
  );
}

function PrizeTicketCard({
  card,
  onRevealSlot,
}: {
  card: ScratchCardPlay;
  onRevealSlot: (cardId: string, slotIndex: number) => void;
}) {
  const won = card.revealed && card.won;
  const lost = card.revealed && !card.won;
  const resultLabel = won ? "Jackpot!" : "Casi!";
  const resultDetail = won
    ? card.reward?.title || "Sobre ganado"
    : "No ha salido premio";

  return (
    <article
      className={`scratch-ticket scratch-ticket--prize relative overflow-hidden rounded-xl transition ${
        won
          ? "scratch-ticket--prize-win"
          : lost
            ? "scratch-ticket--prize-lost"
            : ""
      }`}
    >
      <div className="relative z-10">
        <div className="scratch-ticket-prize__slots">
          {card.slots.map((slot, slotIndex) => {
            const slotRevealed =
              card.revealed || Boolean(card.revealedSlots[slotIndex]);
            return (
              <div
                className={`scratch-slot-box scratch-slot-box--prize relative aspect-[4/5] overflow-hidden rounded-lg p-2 ${
                  slotRevealed ? "scratch-slot-box--revealed" : ""
                }`}
                key={`${card.id}-${slotIndex}`}
              >
                <div className="relative z-10 h-full w-full">
                  <Image
                    alt={slot.title}
                    className={`object-contain drop-shadow-[0_10px_16px_rgba(0,0,0,0.48)] transition duration-300 ${
                      slotRevealed
                        ? "scale-100 opacity-100"
                        : "scale-95 opacity-20"
                    }`}
                    fill
                    sizes="(max-width: 640px) 27vw, 150px"
                    src={slot.image}
                  />
                </div>
                <ScratchSurface
                  label={`Rascar casilla ${slotIndex + 1}`}
                  revealed={slotRevealed}
                  onReveal={() => onRevealSlot(card.id, slotIndex)}
                />
              </div>
            );
          })}
        </div>

        {card.revealed ? (
          <div
            aria-label={`${resultLabel} ${resultDetail}`}
            aria-live="polite"
            className={`scratch-reveal-feedback ${
              won
                ? "scratch-reveal-feedback--win"
                : "scratch-reveal-feedback--lost"
            }`}
          >
            <span aria-hidden className="scratch-reveal-feedback__sparks">
              {SCRATCH_REVEAL_SPARKS.map((spark, index) => (
                <span
                  key={`scratch-reveal-spark-${index}`}
                  style={
                    {
                      "--scratch-spark-delay": spark.delay,
                      "--scratch-spark-left": spark.left,
                      "--scratch-spark-top": spark.top,
                    } as CSSProperties
                  }
                />
              ))}
            </span>
            <strong>{resultLabel}</strong>
            <span>{resultDetail}</span>
          </div>
        ) : null}

        <div
          className="mt-5 text-center text-xs font-medium uppercase tracking-[0.08em] text-white sm:mt-6 sm:text-sm"
          data-scratch-rule
        >
          3 sobres iguales <span className="text-[#f5c518]">para ganar</span>
        </div>
      </div>
    </article>
  );
}

function ScratchCardsEventHeader({
  cardCount,
  phase,
  title,
  winChance,
}: {
  cardCount: number;
  phase: Phase;
  title: string;
  winChance: number;
}) {
  const compact = phase !== "intro";

  if (!compact) {
    return (
      <aside className="scratch-event-hero relative flex min-h-[205px] items-center justify-center overflow-hidden border-b border-white/10 bg-[#07131b] p-0 sm:min-h-[235px]">
        <Image
          alt=""
          className="scratch-event-hero__bg object-cover"
          fill
          priority
          sizes="(max-width: 768px) 100vw, 672px"
          src={SCRATCH_ELITE_BACKGROUND_SRC}
        />
        <div
          aria-hidden
          className="scratch-event-hero__shade absolute inset-0"
        />
        <h2 id="scratch-cards-title" className="sr-only">
          {title}
        </h2>
        <div className="relative z-10 h-[205px] w-full overflow-hidden sm:h-[235px]">
          <Image
            alt="Juanma Rodriguez celebrando"
            className="scratch-event-hero__juanma object-contain"
            height={520}
            priority
            sizes="(max-width: 640px) 230px, 260px"
            src={SCRATCH_JUANMA_SRC}
            unoptimized
            width={520}
          />
        </div>
      </aside>
    );
  }

  return (
    <aside className="scratch-event-compact relative flex min-h-[104px] items-center justify-center overflow-hidden border-b border-[#f5c518]/18 bg-[#07131b] px-4 py-4 text-center sm:min-h-[118px]">
      <Image
        alt=""
        className="object-cover opacity-45"
        fill
        sizes="(max-width: 768px) 100vw, 672px"
        src={SCRATCH_ELITE_BACKGROUND_SRC}
      />
      <div aria-hidden className="absolute inset-0 bg-[#07131b]/55" />
      <div className="relative z-10">
        <p className="text-[9px] font-bold uppercase tracking-[0.22em] text-[#7dd3fc] sm:text-[10px]">
          Rasca sobres
        </p>
        <h2
          id="scratch-cards-title"
          className="mt-1 text-xl font-bold uppercase leading-none text-white sm:text-2xl"
        >
          {title}
        </h2>
        <p className="mt-2 text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-500 sm:text-[10px]">
          {cardCount} rondas / {percent(winChance)} por rasca
        </p>
      </div>
    </aside>
  );
}

function IntroPanel({
  cardCount,
  rewards,
  title,
  winChance,
  onStart,
}: {
  cardCount: number;
  rewards: ScratchCardReward[];
  title: string;
  winChance: number;
  onStart: () => void;
}) {
  return (
    <div className="relative z-10 flex flex-col justify-center px-4 pb-5 pt-5 sm:px-5">
      <span className="self-center rounded-full border border-[#f5c518]/30 bg-[#f5c518]/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#f5c518]">
        Minijuego / rasca
      </span>
      <h3 className="mt-3 text-center text-2xl font-bold leading-none tracking-tight text-white sm:text-3xl">
        {title}
      </h3>
      <p className="mx-auto mt-2 max-w-xl text-center text-xs leading-5 text-zinc-300 sm:text-sm">
        Te daran un rasca cada vez durante {cardCount} rondas. Si en una tarjeta
        aparecen 3 sobres iguales, te llevas ese sobre.
      </p>

      <div className="mt-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-white/10" />
        <p className="text-[10px] font-bold uppercase tracking-[0.26em] text-[#7dd3fc]">
          Sobres en juego
        </p>
        <span className="h-px flex-1 bg-white/10" />
      </div>
      <div
        className="mt-3 grid gap-2 text-center"
        style={rewardGridStyle(rewards.length)}
      >
        {rewards.map((reward) => (
          <RewardCard
            key={`${reward.pool}-${reward.title}`}
            reward={reward}
            state="available"
          />
        ))}
      </div>

      <div className="mt-4 rounded-2xl border border-white/10 bg-black/24 p-3 text-center">
        <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-[#7dd3fc]">
          {cardCount} rascas / {percent(winChance)} por rasca
        </p>
        <p className="mt-1 text-xs leading-5 text-zinc-400">
          Rasca las 3 casillas. Si salen 3 sobres iguales, ganas ese sobre.
        </p>
      </div>

      <div className="flex sm:justify-center">
        <button
          className="mt-5 w-full rounded-xl bg-gradient-to-r from-[#22c55e] via-[#7dd3fc] to-[#f5c518] px-5 py-3 text-sm font-bold uppercase tracking-[0.14em] text-[#06131f] shadow-lg shadow-sky-500/18 transition hover:brightness-110 sm:w-max sm:min-w-56"
          onClick={onStart}
          type="button"
        >
          Recibir primer rasca
        </button>
      </div>
    </div>
  );
}

function PlayingPanel({
  activeIndex,
  cards,
  onFinish,
  onNext,
  onRevealSlot,
}: {
  activeIndex: number;
  cards: ScratchCardPlay[];
  onFinish: () => void;
  onNext: () => void;
  onRevealSlot: (cardId: string, slotIndex: number) => void;
}) {
  const activeCard =
    cards[Math.min(activeIndex, Math.max(0, cards.length - 1))];
  const revealed = cards.filter((card) => card.revealed).length;
  const wins = cards.filter((card) => card.revealed && card.won).length;
  const isLastRound = activeIndex >= cards.length - 1;

  if (!activeCard) return null;

  return (
    <div className="scratch-playing-stage relative z-10 px-3 pb-5 pt-4 sm:px-5">
      <div className="scratch-elite-stats mb-3 grid grid-cols-3 gap-2 text-center">
        <div className="scratch-elite-stat scratch-elite-stat--round rounded-lg border border-sky-200/16 bg-sky-200/[0.06] px-2 py-2">
          <span className="scratch-elite-stat__icon" aria-hidden />
          <p className="text-[8px] font-bold uppercase tracking-[0.16em] text-sky-200">
            Ronda
          </p>
          <p className="mt-0.5 text-sm font-bold text-white">
            {activeIndex + 1}/{cards.length}
          </p>
        </div>
        <div className="scratch-elite-stat scratch-elite-stat--revealed rounded-lg border border-white/10 bg-black/20 px-3 py-2">
          <span className="scratch-elite-stat__icon" aria-hidden />
          <p className="text-[8px] font-bold uppercase tracking-[0.16em] text-zinc-500">
            Reveladas
          </p>
          <p className="mt-0.5 text-sm font-bold text-white">
            {revealed}/{cards.length}
          </p>
        </div>
        <div className="scratch-elite-stat scratch-elite-stat--prizes rounded-lg border border-[#f5c518]/20 bg-[#f5c518]/8 px-3 py-2">
          <span className="scratch-elite-stat__icon" aria-hidden />
          <p className="text-[8px] font-bold uppercase tracking-[0.16em] text-[#f5c518]">
            Premios
          </p>
          <p className="mt-0.5 text-sm font-bold text-white">
            {wins} {packLabel(wins)}
          </p>
        </div>
      </div>

      <PrizeTicketCard card={activeCard} onRevealSlot={onRevealSlot} />

      {activeCard.revealed ? (
        <div
          className={`scratch-elite-action mt-3 rounded-xl border border-white/10 bg-black/24 px-3 py-2.5 text-center ${
            activeCard.won
              ? "scratch-elite-action--win"
              : "scratch-elite-action--lost"
          }`}
        >
          <p
            className={`text-[10px] font-bold uppercase tracking-[0.1em] ${
              activeCard.won ? "text-[#f5c518]" : "text-zinc-400"
            }`}
          >
            {activeCard.won
              ? `Premio: ${activeCard.reward?.title || "sobre"}`
              : "Esta ronda no tiene premio"}
          </p>
          <button
            className="scratch-elite-action__button mt-2.5 w-full px-4 py-2.5 text-xs font-bold uppercase tracking-[0.09em] transition hover:brightness-110 sm:w-max sm:min-w-48"
            onClick={isLastRound ? onFinish : onNext}
            type="button"
          >
            {isLastRound ? "Ver resultado" : "Siguiente rasca"}
          </button>
        </div>
      ) : null}
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
  result: ScratchCardsResult;
  rewards: ScratchCardReward[];
}) {
  const banked = result.packs;
  const wonAny = banked > 0;
  const label = packLabel(banked);
  const resultMessage = wonAny
    ? `Encontraste ${banked} ${label} con 3 iguales.`
    : "Ninguna tarjeta tenia los 3 sobres iguales.";

  return (
    <div className="relative z-10 flex flex-col items-center px-4 pb-5 pt-4 text-center sm:px-5">
      {wonAny ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-40 overflow-hidden">
          <div className="absolute left-1/2 top-4 h-40 w-40 -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(245,197,24,0.36),transparent_68%)] motion-safe:animate-[ruleta-win-burst_750ms_ease-out_both]" />
          {CONFETTI.map((piece, index) => (
            <span
              className="absolute top-6 h-2 w-2 rounded-[1px] motion-safe:animate-[ruleta-confetti_1100ms_ease-out_both]"
              key={`scratch-confetti-${index}`}
              style={{
                animationDelay: piece.delay,
                backgroundColor: piece.color,
                left: piece.left,
              }}
            />
          ))}
        </div>
      ) : null}

      <div
        className={`scratch-result-character relative z-10 mx-auto h-[280px] w-full max-w-[460px] sm:h-[290px] ${
          wonAny ? "scratch-result-character--win" : ""
        }`}
      >
        <Image
          alt="Juanma Rodriguez celebrando"
          className="scratch-result-character__image"
          height={1122}
          priority
          sizes="(max-width: 640px) 92vw, 460px"
          src={SCRATCH_JUANMA_SRC}
          unoptimized
          width={1402}
        />
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

      <div
        className="relative z-10 mt-4 grid w-full max-w-sm gap-2"
        style={rewardGridStyle(rewards.length)}
      >
        {rewards.map((reward) => {
          const earned = result.rewards.some(
            (wonReward) =>
              (wonReward.pool || wonReward.title) ===
              (reward.pool || reward.title),
          );
          return (
            <RewardCard
              key={`${reward.pool}-${reward.title}`}
              reward={reward}
              state={earned ? "earned" : "lost"}
            />
          );
        })}
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
    </div>
  );
}

function RewardCard({
  reward,
  state,
}: {
  reward: ScratchCardReward;
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
        {earned ? "Ganado" : lost ? "No salio" : "En juego"}
      </p>
    </div>
  );
}

export function ScratchCardsModal({
  allowReplay = true,
  config,
  onClose,
  onCompleted,
  onOpenPacks,
}: {
  allowReplay?: boolean;
  config: ScratchCardsConfig;
  onClose: () => void;
  onCompleted?: (result: ScratchCardsResult) => void;
  onOpenPacks?: () => void;
}) {
  const rewards = useMemo(() => safeRewards(config.rewards), [config.rewards]);
  const cardCount = clampCardCount(config.cardCount);
  const winChance = clampWinChance(config.winChance);
  const [phase, setPhase] = useState<Phase>("intro");
  const [cards, setCards] = useState<ScratchCardPlay[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [result, setResult] = useState<ScratchCardsResult | null>(null);
  const completedRef = useRef(false);

  const finishGame = useCallback(
    (nextCards: ScratchCardPlay[]) => {
      if (completedRef.current) return;
      completedRef.current = true;
      const wonCards = nextCards.filter((card) => card.won);
      const earnedRewards = wonCards
        .map((card) => card.reward)
        .filter((reward): reward is ScratchCardReward => Boolean(reward));
      const nextResult: ScratchCardsResult = {
        cardCount,
        cards: nextCards,
        configId: config.id,
        packs: earnedRewards.length,
        rewards: earnedRewards,
        winChance,
      };
      setResult(nextResult);
      setPhase("result");
      onCompleted?.(nextResult);
    },
    [cardCount, config.id, onCompleted, winChance],
  );

  const startGame = useCallback(() => {
    completedRef.current = false;
    const nextCards = buildScratchCards({
      cardCount,
      rewardSequence: config.rewardSequence,
      rewards,
      winChance,
    });
    setCards(nextCards);
    setActiveIndex(0);
    setResult(null);
    setPhase("playing");
  }, [cardCount, config.rewardSequence, rewards, winChance]);

  const handleRevealSlot = useCallback((cardId: string, slotIndex: number) => {
    setCards((current) => {
      const nextCards = current.map((card) => {
        if (
          card.id !== cardId ||
          card.revealed ||
          card.revealedSlots[slotIndex]
        ) {
          return card;
        }
        const revealedSlots = card.revealedSlots.map((revealed, index) =>
          index === slotIndex ? true : revealed,
        );
        return {
          ...card,
          revealed: revealedSlots.every(Boolean),
          revealedSlots,
        };
      });
      return nextCards;
    });
  }, []);

  const goNextRound = useCallback(() => {
    setActiveIndex((current) => Math.min(current + 1, cards.length - 1));
  }, [cards.length]);

  const showResult = useCallback(() => {
    finishGame(cards);
  }, [cards, finishGame]);

  return (
    <div
      aria-labelledby="scratch-cards-title"
      aria-modal="true"
      className="fixed inset-0 z-[120] flex items-center justify-center overflow-x-hidden overflow-y-auto bg-black/82 px-3 py-3 text-white backdrop-blur-sm sm:px-6 sm:py-4"
      role="dialog"
    >
      <div className="theme-dark relative max-h-[calc(100vh-24px)] w-full max-w-2xl overflow-x-hidden overflow-y-auto rounded-2xl border border-sky-200/20 bg-[#07131b] text-white shadow-2xl shadow-black/70 motion-safe:animate-[adivina-pop_220ms_cubic-bezier(0.22,1,0.36,1)_both]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(145deg,rgba(14,165,233,0.16),transparent_34%,rgba(245,197,24,0.1)_66%,rgba(244,114,182,0.13))]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-sky-200/80 to-transparent"
        />

        <button
          aria-label="Cerrar"
          className="hidden"
          onClick={onClose}
          type="button"
        >
          X
        </button>

        <ScratchCardsEventHeader
          cardCount={cardCount}
          phase={phase}
          title={config.title}
          winChance={winChance}
        />

        {phase === "intro" ? (
          <IntroPanel
            cardCount={cardCount}
            rewards={rewards}
            title={config.title}
            winChance={winChance}
            onStart={startGame}
          />
        ) : null}

        {phase === "playing" ? (
          <PlayingPanel
            activeIndex={activeIndex}
            cards={cards}
            onRevealSlot={handleRevealSlot}
            onNext={goNextRound}
            onFinish={showResult}
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
