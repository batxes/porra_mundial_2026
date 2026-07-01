"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

export type PorteroDirection = "left" | "center" | "right";

export type PorteroPenaltyReward = {
  image: string;
  minSaves: number;
  pool?: string;
  title: string;
};

export type PorteroPenaltyConfig = {
  id: string;
  rewards?: PorteroPenaltyReward[];
  title: string;
  totalShots: number;
};

export type PorteroPenaltyShot = {
  choice: PorteroDirection;
  shot: PorteroDirection;
  saved: boolean;
};

export type PorteroPenaltyResult = {
  configId: string;
  goals: number;
  packs: number;
  rewards: PorteroPenaltyReward[];
  saves: number;
  shots: PorteroPenaltyShot[];
  totalShots: number;
};

export const porteroPenaltyCompletedEventName =
  "triliporra:portero-penalty-completed";

type Phase = "intro" | "playing" | "result";
type RoundState = "aiming" | "shooting" | "outcome";
type KeeperPose =
  | "ready"
  | "crouch"
  | "dive-left-save"
  | "dive-right-save"
  | "center-save"
  | "celebrate";

type SpriteMeta = {
  height: number;
  src: string;
  width: number;
};

const DIRECTIONS: PorteroDirection[] = ["left", "center", "right"];

const DIRECTION_META: Record<
  PorteroDirection,
  { label: string; shortLabel: string; targetX: number; targetY: number }
> = {
  left: { label: "", shortLabel: "IZQ", targetX: 23, targetY: 35.5 },
  center: { label: "", shortLabel: "CTR", targetX: 50, targetY: 44 },
  right: { label: "", shortLabel: "DER", targetX: 77, targetY: 35.5 },
};

const MOVE_BUTTON_ASSETS: Record<PorteroDirection, string> = {
  left: "/portero-button-left.png",
  center: "/portero-button-center.png",
  right: "/portero-button-right.png",
};

const SPRITES: Record<KeeperPose, SpriteMeta> = {
  ready: {
    src: "/portero-marrero-ready.png",
    width: 303,
    height: 418,
  },
  crouch: {
    src: "/portero-marrero-crouch.png",
    width: 301,
    height: 335,
  },
  "dive-left-save": {
    src: "/portero-marrero-dive-right-save.png",
    width: 469,
    height: 259,
  },
  "dive-right-save": {
    src: "/portero-marrero-dive-right-save.png",
    width: 469,
    height: 259,
  },
  "center-save": {
    src: "/portero-marrero-center-save.png",
    width: 216,
    height: 290,
  },
  celebrate: {
    src: "/portero-marrero-celebrate.png",
    width: 266,
    height: 447,
  },
};

const BALL_START = { x: 50, y: 80.5, scale: 1.08 };
const OUTCOME_HOLD_MS = 1800;

const DEFAULT_REWARDS: PorteroPenaltyReward[] = [
  {
    image: "/sobre-porteros.webp",
    minSaves: 1,
    pool: "porteros",
    title: "Sobre Porteros",
  },
  {
    image: "/sobre-porteros.webp",
    minSaves: 2,
    pool: "porteros",
    title: "Sobre Porteros",
  },
  {
    image: "/sobre-porteros.webp",
    minSaves: 4,
    pool: "porteros",
    title: "Sobre Porteros",
  },
];

const CONFETTI = [
  { color: "#7dd3fc", delay: "0ms", left: "22%" },
  { color: "#ffffff", delay: "70ms", left: "35%" },
  { color: "#f5c518", delay: "120ms", left: "49%" },
  { color: "#1d4ed8", delay: "40ms", left: "63%" },
  { color: "#22c55e", delay: "150ms", left: "76%" },
  { color: "#7dd3fc", delay: "95ms", left: "56%" },
  { color: "#ffffff", delay: "180ms", left: "30%" },
  { color: "#f5c518", delay: "30ms", left: "70%" },
];

const OUTCOME_SPARKS = [
  { delay: "0ms", left: "12%", top: "36%" },
  { delay: "35ms", left: "24%", top: "18%" },
  { delay: "70ms", left: "38%", top: "10%" },
  { delay: "20ms", left: "62%", top: "12%" },
  { delay: "55ms", left: "76%", top: "20%" },
  { delay: "90ms", left: "88%", top: "40%" },
  { delay: "110ms", left: "30%", top: "76%" },
  { delay: "80ms", left: "70%", top: "74%" },
];

function randomDirection() {
  return DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)] || "center";
}

function rewardsForSaves(
  saves: number,
  rewards: PorteroPenaltyReward[],
): PorteroPenaltyReward[] {
  return rewards.filter((reward) => saves >= reward.minSaves);
}

function keeperSavePose(direction: PorteroDirection): KeeperPose {
  if (direction === "left") return "dive-left-save";
  if (direction === "right") return "dive-right-save";
  return "center-save";
}

function keeperBoxClass(pose: KeeperPose) {
  const base =
    "pointer-events-none absolute z-20 select-none transition-all duration-200 ease-out";
  switch (pose) {
    case "crouch":
      return `${base} left-1/2 top-[34%] h-[26%] w-[19%] -translate-x-1/2`;
    case "dive-left-save":
      return `${base} left-[17%] top-[32%] h-[22%] w-[35%]`;
    case "dive-right-save":
      return `${base} right-[17%] top-[32%] h-[22%] w-[35%]`;
    case "center-save":
      return `${base} left-1/2 top-[34%] h-[28%] w-[20%] -translate-x-1/2`;
    case "celebrate":
      return `${base} left-1/2 top-[24%] h-[34%] w-[21%] -translate-x-1/2`;
    default:
      return `${base} left-1/2 top-[31.5%] h-[30%] w-[18.5%] -translate-x-1/2 sm:top-[29%]`;
  }
}

function keeperShadowClass(pose: KeeperPose) {
  const base =
    "pointer-events-none absolute z-10 rounded-full bg-black/35 transition-all duration-200 ease-out";
  switch (pose) {
    case "dive-left-save":
      return `${base} left-[22%] top-[54%] h-[2.3%] w-[27%]`;
    case "dive-right-save":
      return `${base} right-[22%] top-[54%] h-[2.3%] w-[27%]`;
    case "celebrate":
      return `${base} left-1/2 top-[58%] h-[2.7%] w-[13%] -translate-x-1/2`;
    case "center-save":
      return `${base} left-1/2 top-[58.5%] h-[2.6%] w-[13.5%] -translate-x-1/2`;
    case "crouch":
      return `${base} left-1/2 top-[58%] h-[2.5%] w-[15%] -translate-x-1/2`;
    default:
      return `${base} left-1/2 top-[59%] h-[2.4%] w-[12.5%] -translate-x-1/2 sm:top-[56.5%]`;
  }
}

function rewardGridStyle(count: number): CSSProperties {
  return {
    gridTemplateColumns: `repeat(${Math.max(1, Math.min(4, count))}, minmax(0, 1fr))`,
  };
}

function KeeperSprite({ pose }: { pose: KeeperPose }) {
  const sprite = SPRITES[pose];
  const mirrored = pose.startsWith("dive-left");
  return (
    <>
      <span aria-hidden className={keeperShadowClass(pose)} />
      <div className={keeperBoxClass(pose)}>
        <Image
          alt=""
          className="h-full w-full object-contain [image-rendering:pixelated]"
          height={sprite.height}
          priority
          src={sprite.src}
          style={{ transform: mirrored ? "scaleX(-1)" : undefined }}
          unoptimized
          width={sprite.width}
        />
      </div>
    </>
  );
}

function PixelBall({
  moving,
  scale,
  x,
  y,
}: {
  moving: boolean;
  scale: number;
  x: number;
  y: number;
}) {
  const style: CSSProperties = {
    left: `${x}%`,
    top: `${y}%`,
    transform: `translate(-50%, -50%) scale(${scale})`,
    transition: moving
      ? "left 620ms cubic-bezier(0.16, 1, 0.3, 1), top 620ms cubic-bezier(0.16, 1, 0.3, 1), transform 620ms cubic-bezier(0.16, 1, 0.3, 1)"
      : "none",
  };

  return (
    <span
      aria-hidden
      className="absolute z-30 h-12 w-12 drop-shadow-[0_5px_0_rgba(0,0,0,0.35)]"
      style={style}
    >
      <Image
        alt=""
        className="h-full w-full object-contain [image-rendering:pixelated]"
        height={128}
        priority
        src="/portero-ball.png"
        unoptimized
        width={128}
      />
    </span>
  );
}

function ShootoutTrack({
  activeIndex,
  shots,
  total,
}: {
  activeIndex: number;
  shots: PorteroPenaltyShot[];
  total: number;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/28 px-3 py-3">
      <div className="flex items-center justify-center gap-2">
        {Array.from({ length: total }, (_, index) => {
          const shot = shots[index];
          const active = !shot && index === activeIndex;
          return (
            <span
              aria-label={
                shot
                  ? shot.saved
                    ? `Penalti ${index + 1}: parada`
                    : `Penalti ${index + 1}: gol`
                  : `Penalti ${index + 1}: pendiente`
              }
              className={`grid h-8 w-12 place-items-center rounded-md border text-[12px] font-bold transition ${
                shot
                  ? shot.saved
                    ? "border-emerald-300/60 bg-emerald-300/12 text-emerald-100"
                    : "border-rose-300/65 bg-rose-500/12 text-rose-100"
                  : active
                    ? "border-dashed border-[#f5c518]/90 bg-[#f5c518]/10 text-[#f5c518] motion-safe:animate-pulse"
                    : "border-dashed border-white/35 bg-white/[0.045] text-white/38"
              }`}
              key={index}
            >
              {shot ? (
                <span
                  aria-hidden
                  className="text-base leading-none [text-shadow:0_1px_0_rgba(0,0,0,0.55)]"
                >
                  {shot.saved ? "✔️" : "❌"}
                </span>
              ) : (
                <span
                  className={`rounded-full bg-current ${
                    active ? "h-1.5 w-5 opacity-80" : "h-1.5 w-1.5 opacity-70"
                  }`}
                />
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function DirectionButton({
  direction,
  disabled,
  onClick,
}: {
  direction: PorteroDirection;
  disabled: boolean;
  onClick: (direction: PorteroDirection) => void;
}) {
  const meta = DIRECTION_META[direction];
  const action =
    direction === "center"
      ? "Aguantar"
      : direction === "left"
        ? "Tirarse izq."
        : "Tirarse der.";

  return (
    <button
      aria-label={action}
      className="group flex min-h-[96px] flex-1 flex-col items-center justify-center rounded-2xl border border-emerald-100/12 bg-emerald-950/26 px-2.5 py-3 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] transition enabled:hover:-translate-y-0.5 enabled:hover:border-[#7dd3fc]/60 enabled:hover:bg-emerald-800/24 disabled:cursor-not-allowed disabled:opacity-45"
      disabled={disabled}
      onClick={() => onClick(direction)}
      type="button"
    >
      <span className="relative h-12 w-12 transition-transform duration-150 group-enabled:group-hover:scale-105">
        <Image
          alt=""
          className="object-contain [image-rendering:pixelated]"
          fill
          sizes="48px"
          src={MOVE_BUTTON_ASSETS[direction]}
          unoptimized
        />
      </span>
      <span className="mt-2 text-sm font-bold text-white">{meta.label}</span>
      <span className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-emerald-100/42">
        {action}
      </span>
    </button>
  );
}

function PorteroEventHeader({
  phase,
  title,
  totalRewards,
  totalShots,
}: {
  phase: Phase;
  title: string;
  totalRewards: number;
  totalShots: number;
}) {
  const compact = phase !== "intro";

  if (!compact) {
    return (
      <aside className="relative flex min-h-[205px] items-center justify-center overflow-hidden border-b border-white/10 bg-[#07131b] p-0 sm:min-h-[235px]">
        <Image
          alt=""
          className="absolute inset-0 h-full w-full object-cover object-[50%_28%] opacity-35 blur-[1px] [image-rendering:pixelated]"
          fill
          priority
          sizes="(max-width: 640px) 94vw, 560px"
          src="/portero-penalty-stadium.webp"
          unoptimized
        />
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(circle_at_50%_58%,rgba(125,211,252,0.2),transparent_28%),radial-gradient(circle_at_24%_42%,rgba(245,197,24,0.1),transparent_30%),radial-gradient(circle_at_78%_38%,rgba(34,197,94,0.1),transparent_32%),linear-gradient(180deg,rgba(4,18,27,0.18),rgba(4,12,18,0.74))]"
        />
        <h2 id="portero-penalty-title" className="sr-only">
          {title}
        </h2>
        <div className="relative z-10 h-[205px] w-full overflow-hidden sm:h-[235px]">
          <Image
            alt="Marrero celebrando"
            className="absolute left-1/2 top-0 h-[380px] w-auto max-w-none -translate-x-1/2 object-contain drop-shadow-[0_22px_34px_rgba(0,0,0,0.68)] sm:h-[430px]"
            height={SPRITES.celebrate.height}
            priority
            sizes="(max-width: 640px) 230px, 260px"
            src={SPRITES.celebrate.src}
            unoptimized
            width={SPRITES.celebrate.width}
          />
        </div>
      </aside>
    );
  }

  return (
    <aside className="relative flex min-h-[104px] items-center justify-center overflow-hidden border-b border-white/10 bg-[#07131b] px-4 py-4 text-center sm:min-h-[118px]">
      <div
        aria-hidden
        className="absolute inset-0 bg-[linear-gradient(120deg,rgba(125,211,252,0.1),transparent_34%,rgba(245,197,24,0.09)_76%,transparent),radial-gradient(circle_at_50%_100%,rgba(34,197,94,0.09),transparent_46%)]"
      />

      <div className="relative z-10">
        <p className="text-[9px] font-bold uppercase tracking-[0.22em] text-[#7dd3fc] sm:text-[10px]">
          Porteros / Tanda
        </p>
        <h2
          id="portero-penalty-title"
          className="mt-1 text-xl font-bold uppercase leading-none text-white sm:text-2xl"
        >
          {title}
        </h2>
        <p className="mt-2 text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-500 sm:text-[10px]">
          {totalShots} penaltis / {totalRewards} sobres en juego
        </p>
      </div>
    </aside>
  );
}

function PenaltyStage({
  ballMoving,
  ballScale,
  ballX,
  ballY,
  keeperPose,
  lastShot,
  roundState,
}: {
  ballMoving: boolean;
  ballScale: number;
  ballX: number;
  ballY: number;
  keeperPose: KeeperPose;
  lastShot: PorteroPenaltyShot | null;
  roundState: RoundState;
}) {
  return (
    <div className="relative aspect-[10/7] max-h-[54vh] w-full overflow-hidden rounded-2xl border border-sky-200/18 bg-[#062d3e] shadow-[inset_0_0_42px_rgba(2,6,23,0.32),0_18px_42px_rgba(0,0,0,0.36)]">
      <Image
        alt=""
        className="absolute inset-0 h-full w-full object-cover object-top [image-rendering:pixelated]"
        fill
        priority
        sizes="(max-width: 640px) 94vw, 560px"
        src="/portero-penalty-stadium.webp"
        unoptimized
      />
      <div aria-hidden className="portero-stadium-lights" />
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(circle_at_50%_44%,transparent_0_44%,rgba(0,0,0,0.2)_100%)]"
      />
      <div aria-hidden className="portero-broadcast-vignette" />

      <KeeperSprite pose={keeperPose} />
      <PixelBall moving={ballMoving} scale={ballScale} x={ballX} y={ballY} />

      {roundState === "outcome" && lastShot ? (
        <>
          <div
            aria-hidden
            className={`portero-outcome-flash ${
              lastShot.saved
                ? "portero-outcome-flash--save"
                : "portero-outcome-flash--goal"
            }`}
          />
          <div className="absolute inset-x-4 top-4 z-40 flex justify-center">
            <div
              className={`portero-outcome-card ${
                lastShot.saved
                  ? "portero-outcome-card--save"
                  : "portero-outcome-card--goal"
              }`}
            >
              <span aria-hidden className="portero-outcome-ring" />
              <span aria-hidden className="portero-outcome-shine" />
              <span aria-hidden className="portero-outcome-sparks">
                {OUTCOME_SPARKS.map((spark, index) => (
                  <span
                    className="portero-outcome-spark"
                    key={`portero-spark-${index}`}
                    style={{
                      animationDelay: spark.delay,
                      left: spark.left,
                      top: spark.top,
                    }}
                  />
                ))}
              </span>
              <p className="relative z-10 flex items-center justify-center gap-2 font-[var(--font-pixel)] text-base leading-none sm:text-lg">
                <span aria-hidden className="text-lg leading-none sm:text-xl">
                  {lastShot.saved ? "✔️" : "❌"}
                </span>
                {lastShot.saved ? "PARADON" : "GOL"}
              </p>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function IntroPanel({
  rewards,
  title,
  totalShots,
  onStart,
}: {
  rewards: PorteroPenaltyReward[];
  title: string;
  totalShots: number;
  onStart: () => void;
}) {
  return (
    <div className="relative z-10 flex flex-col justify-center px-4 pb-5 pt-5 sm:px-5">
      <span className="self-center rounded-full border border-[#f5c518]/30 bg-[#f5c518]/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#f5c518]">
        Minijuego / porteros
      </span>
      <h3 className="mt-3 text-center text-2xl font-bold leading-none tracking-tight text-white sm:text-3xl">
        {title}
      </h3>
      <p className="mx-auto mt-2 max-w-xl text-center text-xs leading-5 text-zinc-300 sm:text-sm">
        Elige izquierda, centro o derecha. Marrero se tira antes del disparo:
        cada parada acerca un sobre de portero.
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
        {rewards.map((reward) => (
          <RewardCard
            key={`${reward.minSaves}-${reward.title}`}
            reward={reward}
            state="available"
          />
        ))}
      </div>

      <div className="mt-4 rounded-2xl border border-white/10 bg-black/24 p-3 text-center">
        <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-[#7dd3fc]">
          Tanda de {totalShots} penaltis
        </p>
        <p className="mt-1 text-xs leading-5 text-zinc-400">
          Si adivinas el lado del tiro, cuenta como parada.
        </p>
      </div>

      <div className="flex sm:justify-center">
        <button
          className="mt-5 w-full rounded-xl bg-gradient-to-r from-[#22c55e] via-[#7dd3fc] to-[#f5c518] px-5 py-3 text-sm font-bold uppercase tracking-[0.14em] text-[#06131f] shadow-lg shadow-sky-500/18 transition hover:brightness-110 sm:w-max sm:min-w-56"
          onClick={onStart}
          type="button"
        >
          Ponerme bajo palos
        </button>
      </div>
    </div>
  );
}

function PlayingPanel({
  ballMoving,
  ballScale,
  ballX,
  ballY,
  buttonsDisabled,
  keeperPose,
  lastShot,
  roundIndex,
  roundState,
  shots,
  totalShots,
  onChoose,
}: {
  ballMoving: boolean;
  ballScale: number;
  ballX: number;
  ballY: number;
  buttonsDisabled: boolean;
  keeperPose: KeeperPose;
  lastShot: PorteroPenaltyShot | null;
  roundIndex: number;
  roundState: RoundState;
  shots: PorteroPenaltyShot[];
  totalShots: number;
  onChoose: (direction: PorteroDirection) => void;
}) {
  return (
    <div className="relative z-10 px-3 pb-5 pt-4 sm:px-5">
      <PenaltyStage
        ballMoving={ballMoving}
        ballScale={ballScale}
        ballX={ballX}
        ballY={ballY}
        keeperPose={keeperPose}
        lastShot={lastShot}
        roundState={roundState}
      />

      <div className="mt-3 overflow-hidden rounded-2xl border border-emerald-100/10 bg-[#061109]/82 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        <ShootoutTrack
          activeIndex={Math.min(roundIndex, totalShots - 1)}
          shots={shots}
          total={totalShots}
        />

        <div className="mt-4 grid grid-cols-3 gap-3">
          {DIRECTIONS.map((direction) => (
            <DirectionButton
              direction={direction}
              disabled={buttonsDisabled}
              key={direction}
              onClick={onChoose}
            />
          ))}
        </div>
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
  wonAny,
}: {
  allowReplay: boolean;
  onClose: () => void;
  onOpenPacks: () => void;
  onReplay: () => void;
  result: PorteroPenaltyResult | null;
  rewards: PorteroPenaltyReward[];
  wonAny: boolean;
}) {
  const banked = result?.packs ?? 0;
  const saves = result?.saves ?? 0;
  const totalShots = result?.totalShots ?? 0;
  const packLabel = banked === 1 ? "sobre" : "sobres";
  const savedLabel = banked === 1 ? "Premio ganado" : "Premios ganados";
  const resultMessage =
    banked > 0
      ? `Paraste ${saves}/${totalShots} y te llevas ${banked} ${packLabel} de portero.`
      : `Paraste ${saves}/${totalShots}. Esta tanda se ha escapado, pero Marrero pide revancha.`;

  return (
    <div className="relative z-10 flex flex-col items-center px-4 pb-5 pt-4 text-center sm:px-5">
      {wonAny ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-40 overflow-hidden">
          <div className="absolute left-1/2 top-4 h-40 w-40 -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(245,197,24,0.36),transparent_68%)] motion-safe:animate-[ruleta-win-burst_750ms_ease-out_both]" />
          {CONFETTI.map((piece, index) => (
            <span
              className="absolute top-6 h-2 w-2 rounded-[1px] motion-safe:animate-[ruleta-confetti_1100ms_ease-out_both]"
              key={`portero-confetti-${index}`}
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
        <Image
          alt="Marrero celebrando"
          className="absolute left-1/2 top-0 h-[430px] w-auto max-w-none -translate-x-1/2 object-contain drop-shadow-[0_20px_26px_rgba(0,0,0,0.42)] sm:h-[470px]"
          height={SPRITES.celebrate.height}
          priority
          sizes="310px"
          src={SPRITES.celebrate.src}
          unoptimized
          width={SPRITES.celebrate.width}
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

      <div
        className="relative z-10 mt-4 grid w-full max-w-sm gap-2"
        style={rewardGridStyle(rewards.length)}
      >
        {rewards.map((reward) => (
          <RewardCard
            key={`${reward.minSaves}-${reward.title}`}
            reward={reward}
            state={saves >= reward.minSaves ? "earned" : "lost"}
          />
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
    </div>
  );
}

function RewardCard({
  reward,
  state,
}: {
  reward: PorteroPenaltyReward;
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
        {earned ? "Ganado" : lost ? "Perdido" : `${reward.minSaves}+ paradas`}
      </p>
    </div>
  );
}

export function PorteroPenaltyModal({
  allowReplay = true,
  config,
  onClose,
  onCompleted,
  onOpenPacks,
}: {
  allowReplay?: boolean;
  config: PorteroPenaltyConfig;
  onClose: () => void;
  onCompleted?: (result: PorteroPenaltyResult) => void;
  onOpenPacks?: () => void;
}) {
  const rewards = useMemo(
    () => (config.rewards?.length ? config.rewards : DEFAULT_REWARDS),
    [config.rewards],
  );
  const totalShots = Math.max(
    1,
    Math.min(7, Math.trunc(config.totalShots || 5)),
  );
  const [phase, setPhase] = useState<Phase>("intro");
  const [roundState, setRoundState] = useState<RoundState>("aiming");
  const [roundIndex, setRoundIndex] = useState(0);
  const [keeperPose, setKeeperPose] = useState<KeeperPose>("ready");
  const [ballPoint, setBallPoint] = useState(BALL_START);
  const [ballMoving, setBallMoving] = useState(false);
  const [shots, setShots] = useState<PorteroPenaltyShot[]>([]);
  const [completedResult, setCompletedResult] =
    useState<PorteroPenaltyResult | null>(null);

  const shotsRef = useRef<PorteroPenaltyShot[]>([]);
  const timersRef = useRef<number[]>([]);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current = [];
  }, []);

  const queueTimer = useCallback((callback: () => void, delay: number) => {
    const timer = window.setTimeout(callback, delay);
    timersRef.current.push(timer);
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const finishGame = useCallback(
    (nextShots: PorteroPenaltyShot[]) => {
      const saves = nextShots.filter((shot) => shot.saved).length;
      const earnedRewards = rewardsForSaves(saves, rewards);
      const result: PorteroPenaltyResult = {
        configId: config.id,
        goals: nextShots.length - saves,
        packs: earnedRewards.length,
        rewards: earnedRewards,
        saves,
        shots: nextShots,
        totalShots,
      };
      setCompletedResult(result);
      setKeeperPose(saves >= 3 ? "celebrate" : "ready");
      setPhase("result");
      onCompleted?.(result);
    },
    [config.id, onCompleted, rewards, totalShots],
  );

  const startGame = useCallback(() => {
    clearTimers();
    shotsRef.current = [];
    setShots([]);
    setCompletedResult(null);
    setRoundIndex(0);
    setRoundState("aiming");
    setKeeperPose("ready");
    setBallMoving(false);
    setBallPoint(BALL_START);
    setPhase("playing");
  }, [clearTimers]);

  const handleChoose = useCallback(
    (nextChoice: PorteroDirection) => {
      if (phase !== "playing" || roundState !== "aiming") return;

      const shot = randomDirection();
      const saved = shot === nextChoice;
      const meta = DIRECTION_META[shot];
      const attempt: PorteroPenaltyShot = {
        choice: nextChoice,
        shot,
        saved,
      };

      clearTimers();
      setRoundState("shooting");
      setKeeperPose("crouch");
      setBallMoving(false);
      setBallPoint(BALL_START);

      queueTimer(() => {
        setBallMoving(true);
        setBallPoint({
          x: meta.targetX,
          y: meta.targetY,
          scale: shot === "center" ? 0.48 : 0.42,
        });
      }, 50);

      queueTimer(() => {
        setKeeperPose(keeperSavePose(nextChoice));
      }, 190);

      queueTimer(() => {
        const nextShots = [...shotsRef.current, attempt];
        shotsRef.current = nextShots;
        setShots(nextShots);
        setRoundState("outcome");
        setKeeperPose(keeperSavePose(nextChoice));

        if (nextShots.length >= totalShots) {
          queueTimer(() => finishGame(nextShots), OUTCOME_HOLD_MS);
          return;
        }

        queueTimer(() => {
          setRoundIndex((current) => current + 1);
          setRoundState("aiming");
          setKeeperPose("ready");
          setBallMoving(false);
          setBallPoint(BALL_START);
        }, OUTCOME_HOLD_MS);
      }, 740);
    },
    [clearTimers, finishGame, phase, queueTimer, roundState, totalShots],
  );

  const lastShot = shots[shots.length - 1] || null;
  const buttonsDisabled = phase !== "playing" || roundState !== "aiming";
  const ballScale = ballPoint.scale;
  const wonAny = (completedResult?.packs ?? 0) > 0;

  return (
    <div
      aria-labelledby="portero-penalty-title"
      aria-modal="true"
      className="fixed inset-0 z-[120] flex items-center justify-center overflow-x-hidden overflow-y-auto bg-black/82 px-3 py-3 text-white backdrop-blur-sm sm:px-6 sm:py-4"
      role="dialog"
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

        <PorteroEventHeader
          phase={phase}
          title={config.title}
          totalRewards={rewards.length}
          totalShots={totalShots}
        />

        {phase === "intro" ? (
          <IntroPanel
            rewards={rewards}
            title={config.title}
            totalShots={totalShots}
            onStart={startGame}
          />
        ) : null}

        {phase === "playing" ? (
          <PlayingPanel
            ballMoving={ballMoving}
            ballScale={ballScale}
            ballX={ballPoint.x}
            ballY={ballPoint.y}
            buttonsDisabled={buttonsDisabled}
            keeperPose={keeperPose}
            lastShot={lastShot}
            roundIndex={roundIndex}
            roundState={roundState}
            shots={shots}
            totalShots={totalShots}
            onChoose={handleChoose}
          />
        ) : null}

        {phase === "result" && completedResult ? (
          <ResultPanel
            allowReplay={allowReplay}
            result={completedResult}
            rewards={rewards}
            wonAny={wonAny}
            onReplay={startGame}
            onClose={onClose}
            onOpenPacks={onOpenPacks ?? onClose}
          />
        ) : null}
      </div>
    </div>
  );
}
