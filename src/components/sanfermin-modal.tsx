"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

export type SanFerminReward = {
  image: string;
  meters: number;
  title: string;
  pool?: string;
};

export type SanFerminConfig = {
  id: string;
  title: string;
  goalMeters: number;
  hurdlesPerReward: number;
  extraHurdlesPerRun: number;
  rewards: SanFerminReward[];
};

export type SanFerminResult = {
  configId: string;
  metersReached: number;
  goalMeters: number;
  reachedGoal: boolean;
  packs: number;
  rewards: SanFerminReward[];
};

type Phase = "intro" | "briefing" | "playing" | "result";

type LiveStats = {
  meters: number;
  banked: number;
  lives: number;
  bestMeters: number;
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
};

type Game = {
  W: number;
  H: number;
  groundY: number;
  runnerX: number;
  pxPerMeter: number;
  distance: number;
  visualDistance: number;
  speed: number;
  feetY: number;
  vy: number;
  grounded: boolean;
  hurdles: number[];
  banked: number;
  bankFlashUntil: number;
  lives: number;
  bestDistance: number;
  bestBanked: number;
  bestReachedGoal: boolean;
  startT: number;
  runStartT: number;
  lastT: number;
  jumpBufferedUntil: number;
  ended: boolean;
  endType: "win" | "crash" | null;
  endT: number;
  transitioned: boolean;
  shake: number;
  deathRot: number;
  deathVy: number;
  particles: Particle[];
};

const JOKER_RUNNER_SRC = "/joker-runner-single.png";
const JOKER_FRONT_SRC = "/sanfermin-joker-hero.png";
const BULL_SRC = "/sanfermin-bull.png";
const BACKGROUND_SRC = "/sanfermin-bg-pixel.png";

const CONFETTI = [
  { color: "#ef4444", delay: "0ms", left: "18%" },
  { color: "#ffffff", delay: "70ms", left: "34%" },
  { color: "#f97316", delay: "120ms", left: "48%" },
  { color: "#ef4444", delay: "40ms", left: "62%" },
  { color: "#f8fafc", delay: "160ms", left: "78%" },
  { color: "#facc15", delay: "95ms", left: "55%" },
  { color: "#ef4444", delay: "185ms", left: "27%" },
  { color: "#ffffff", delay: "115ms", left: "71%" },
];

const METERS_PER_SCREEN = 11.5;
const RUNNER_X_FRAC = 0.36;
const GROUND_FRAC = 0.8;
const RUNNER_H_FRAC = 0.36;
const BULL_H_FRAC = 0.34;
const HURDLE_H_FRAC = 0.15;
const GRAVITY_FRAC = 3.9;
const JUMP_V_FRAC = -1.25;
const MOTION_SPEED_MULTIPLIER = 1.3;
const BASE_SPEED = 4.45 * MOTION_SPEED_MULTIPLIER;
const MAX_SPEED = 6.35 * MOTION_SPEED_MULTIPLIER;
const STARTUP_MS = 480;
const MAX_LIVES = 3;
const LIFE_RESTART_MS = 850;
const COUNTDOWN_NUMBER_MS = 620;
const COUNTDOWN_READY_MS = COUNTDOWN_NUMBER_MS * 3;
const COUNTDOWN_GO_MS = 520;
const COUNTDOWN_TOTAL_MS = COUNTDOWN_READY_MS + COUNTDOWN_GO_MS;
const JUMP_BUFFER_MS = 135;
const END_FREEZE_MS = 720;
const MIN_HURDLE_GAP = 7;

function buildHurdles(config: SanFerminConfig) {
  const hurdles: number[] = [];
  const hurdlesPerReward = Math.max(1, Math.floor(config.hurdlesPerReward));
  const checkpoints = [...config.rewards]
    .map((reward) => reward.meters)
    .filter((meters) => meters > 0 && meters <= config.goalMeters)
    .sort((a, b) => a - b);
  const extraBySegment = checkpoints.map(() => 0);
  const availableSegments = checkpoints.map((_, index) => index);
  const extraHurdles = Math.max(0, Math.floor(config.extraHurdlesPerRun));

  for (
    let extra = 0;
    extra < extraHurdles && availableSegments.length;
    extra += 1
  ) {
    const choice = Math.floor(Math.random() * availableSegments.length);
    const segmentIndex = availableSegments.splice(choice, 1)[0]!;
    extraBySegment[segmentIndex] += 1;
  }

  let segmentStart = 0;

  for (const [segmentIndex, checkpoint] of checkpoints.entries()) {
    const segmentLength = checkpoint - segmentStart;
    if (segmentLength <= 0) continue;
    const hurdleCount = hurdlesPerReward + extraBySegment[segmentIndex]!;
    const evenSpacing = segmentLength / (hurdleCount + 1);
    const maxJitter = Math.max(
      0,
      Math.min(evenSpacing * 0.1, (evenSpacing - MIN_HURDLE_GAP) / 2),
    );
    for (let hurdle = 1; hurdle <= hurdleCount; hurdle += 1) {
      hurdles.push(
        segmentStart +
          evenSpacing * hurdle +
          (Math.random() * 2 - 1) * maxJitter,
      );
    }
    segmentStart = checkpoint;
  }

  return hurdles.sort((a, b) => a - b);
}

function easeOut(t: number) {
  return 1 - (1 - t) * (1 - t);
}

function getCountdownState(g: Game, t: number) {
  const elapsed = Math.max(0, t - g.startT);
  const active = elapsed >= COUNTDOWN_READY_MS;
  let label: "3" | "2" | "1" | "YA!" | null = null;
  let phaseProgress = 1;

  if (elapsed < COUNTDOWN_NUMBER_MS) {
    label = "3";
    phaseProgress = elapsed / COUNTDOWN_NUMBER_MS;
  } else if (elapsed < COUNTDOWN_NUMBER_MS * 2) {
    label = "2";
    phaseProgress = (elapsed - COUNTDOWN_NUMBER_MS) / COUNTDOWN_NUMBER_MS;
  } else if (elapsed < COUNTDOWN_READY_MS) {
    label = "1";
    phaseProgress = (elapsed - COUNTDOWN_NUMBER_MS * 2) / COUNTDOWN_NUMBER_MS;
  } else if (elapsed < COUNTDOWN_TOTAL_MS) {
    label = "YA!";
    phaseProgress = (elapsed - COUNTDOWN_READY_MS) / COUNTDOWN_GO_MS;
  }

  return {
    active,
    label,
    phaseProgress: Math.max(0, Math.min(1, phaseProgress)),
    showObstacles: active,
  };
}

export function SanFerminModal({
  config,
  allowReplay = true,
  onClose,
  onCompleted,
  onOpenPacks,
}: {
  config: SanFerminConfig;
  allowReplay?: boolean;
  onClose: () => void;
  onCompleted?: (result: SanFerminResult) => void;
  onOpenPacks?: () => void;
}) {
  const rewards = [...config.rewards].sort((a, b) => a.meters - b.meters);
  const [phase, setPhase] = useState<Phase>("intro");
  const [result, setResult] = useState<SanFerminResult | null>(null);
  const [hintGone, setHintGone] = useState(false);
  const [liveStats, setLiveStats] = useState<LiveStats>({
    meters: 0,
    banked: 0,
    lives: MAX_LIVES,
    bestMeters: 0,
  });

  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gameRef = useRef<Game | null>(null);
  const jumpRef = useRef<(() => void) | null>(null);
  const liveSyncRef = useRef(0);
  const completedRef = useRef(false);

  const openBriefing = useCallback(() => {
    if (completedRef.current && !allowReplay) return;
    setPhase("briefing");
  }, [allowReplay]);

  const start = useCallback(() => {
    if (completedRef.current && !allowReplay) return;
    completedRef.current = false;
    setResult(null);
    setHintGone(false);
    setLiveStats({
      meters: 0,
      banked: 0,
      lives: MAX_LIVES,
      bestMeters: 0,
    });
    liveSyncRef.current = 0;
    setPhase("playing");
  }, [allowReplay]);

  useEffect(() => {
    completedRef.current = false;
  }, [config.id]);

  useEffect(() => {
    const sources = [
      JOKER_RUNNER_SRC,
      JOKER_FRONT_SRC,
      BULL_SRC,
      BACKGROUND_SRC,
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

  useEffect(() => {
    if (phase !== "playing") return;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const goal = config.goalMeters;
    const hurdles = buildHurdles(config);

    const runnerImg = new window.Image();
    let runnerReady = false;
    runnerImg.onload = () => {
      runnerReady = true;
    };
    runnerImg.src = JOKER_RUNNER_SRC;

    const bullImg = new window.Image();
    let bullReady = false;
    bullImg.onload = () => {
      bullReady = true;
    };
    bullImg.src = BULL_SRC;

    const backgroundImg = new window.Image();
    let backgroundReady = false;
    backgroundImg.onload = () => {
      backgroundReady = true;
    };
    backgroundImg.src = BACKGROUND_SRC;

    const g: Game = {
      W: 1,
      H: 1,
      groundY: 0,
      runnerX: 0,
      pxPerMeter: 1,
      distance: 0,
      visualDistance: 0,
      speed: 0,
      feetY: 0,
      vy: 0,
      grounded: true,
      hurdles,
      banked: 0,
      bankFlashUntil: 0,
      lives: MAX_LIVES,
      bestDistance: 0,
      bestBanked: 0,
      bestReachedGoal: false,
      startT: 0,
      runStartT: 0,
      lastT: 0,
      jumpBufferedUntil: 0,
      ended: false,
      endType: null,
      endT: 0,
      transitioned: false,
      shake: 0,
      deathRot: 0,
      deathVy: 0,
      particles: [],
    };
    gameRef.current = g;

    const layout = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const w = container.clientWidth;
      const h = container.clientHeight;
      const oldH = g.H;
      const oldGroundY = g.groundY;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.W = w;
      g.H = h;
      g.groundY = h * GROUND_FRAC;
      g.runnerX = w * RUNNER_X_FRAC;
      g.pxPerMeter = w / METERS_PER_SCREEN;
      if (g.grounded || g.feetY === 0) {
        g.feetY = g.groundY;
      } else if (oldH > 1) {
        const frac = (oldGroundY - g.feetY) / oldH;
        g.feetY = g.groundY - frac * g.H;
        g.vy *= g.H / oldH;
      }
    };

    const doJump = () => {
      if (g.ended) return;
      if (g.grounded) {
        g.vy = JUMP_V_FRAC * g.H;
        g.grounded = false;
        spawnDust(g, 7);
      } else {
        g.jumpBufferedUntil = g.lastT + JUMP_BUFFER_MS;
      }
    };
    jumpRef.current = doJump;

    const ro = new ResizeObserver(() => layout());
    ro.observe(container);
    layout();

    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "ArrowUp" || e.key === " ") {
        e.preventDefault();
        doJump();
      }
    };
    window.addEventListener("keydown", onKey);

    const finish = () => {
      if (completedRef.current) return;
      const metersReached = Math.min(Math.round(g.bestDistance), goal);
      const reachedGoal = g.bestReachedGoal || metersReached >= goal;
      const earned = rewards.slice(0, g.bestBanked);
      const res: SanFerminResult = {
        configId: config.id,
        metersReached,
        goalMeters: goal,
        reachedGoal,
        packs: earned.length,
        rewards: earned,
      };
      completedRef.current = true;
      setResult(res);
      setPhase("result");
      onCompleted?.(res);
    };

    let raf = 0;
    const loop = (t: number) => {
      if (!g.startT) {
        g.startT = t;
        g.lastT = t;
      }
      const dt = Math.min((t - g.lastT) / 1000, 0.05);
      g.lastT = t;
      step(g, config, rewards, goal, dt, t);
      if (t - liveSyncRef.current > 80 || g.ended) {
        const meters = Math.min(Math.round(g.distance), goal);
        const banked = Math.max(g.banked, g.bestBanked);
        const lives = g.lives;
        const bestMeters = Math.max(g.bestDistance, meters);
        setLiveStats((current) =>
          current.meters === meters &&
          current.banked === banked &&
          current.lives === lives &&
          current.bestMeters === bestMeters
            ? current
            : { meters, banked, lives, bestMeters },
        );
        liveSyncRef.current = t;
      }
      render(
        ctx,
        g,
        config,
        rewards,
        runnerImg,
        runnerReady,
        bullImg,
        bullReady,
        backgroundImg,
        backgroundReady,
        t,
      );

      const terminalRun = g.ended && (g.endType === "win" || g.lives <= 0);
      if (terminalRun && !g.transitioned && t - g.endT > END_FREEZE_MS) {
        g.transitioned = true;
        finish();
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("keydown", onKey);
      jumpRef.current = null;
    };
    // The game captures config/rewards when a run starts. Restart only by phase.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const onTapJump = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    setHintGone(true);
    jumpRef.current?.();
  }, []);

  const wonAny = (result?.packs ?? 0) > 0;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center overflow-x-hidden overflow-y-auto bg-black/82 px-3 py-3 text-white backdrop-blur-sm sm:px-6 sm:py-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sanfermin-title"
    >
      <div className="theme-dark relative max-h-[calc(100vh-24px)] w-full max-w-2xl overflow-x-hidden overflow-y-auto rounded-2xl border border-red-200/20 bg-[#160809] text-white shadow-2xl shadow-black/70 motion-safe:animate-[adivina-pop_220ms_cubic-bezier(0.22,1,0.36,1)_both]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(145deg,rgba(239,68,68,0.16),transparent_34%,rgba(250,204,21,0.1)_72%,rgba(255,255,255,0.08))]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-red-300/85 to-transparent"
        />

        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="hidden"
        >
          x
        </button>

        <SanFerminHeader
          title={config.title || "SAN FERMIN RUSH"}
          phase={phase}
          goalMeters={config.goalMeters}
        />

        {phase === "intro" ? (
          <IntroPanel rewards={rewards} onStart={openBriefing} />
        ) : phase === "briefing" ? (
          <BriefingPanel
            goalMeters={config.goalMeters}
            firstRewardMeters={rewards[0]?.meters ?? 25}
            onStart={start}
          />
        ) : phase === "playing" ? (
          <div className="relative z-10 px-3 pb-5 pt-4 sm:px-5">
            <div
              ref={containerRef}
              className="relative aspect-[16/9] max-h-[58vh] w-full touch-none select-none overflow-hidden rounded-xl border border-red-100/18 bg-[#22100a] shadow-[inset_0_0_42px_rgba(0,0,0,0.44),0_18px_42px_rgba(0,0,0,0.34)]"
            >
              <canvas
                ref={canvasRef}
                className="absolute inset-0 h-full w-full"
              />
              <button
                type="button"
                aria-label="Saltar"
                onPointerDown={onTapJump}
                className="absolute inset-0 z-20 h-full w-full cursor-pointer"
              />
              {!hintGone ? (
                <div className="pointer-events-none absolute inset-x-0 bottom-3 z-30 flex justify-center">
                  <span className="animate-pulse rounded-full border border-white/25 bg-black/58 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-white shadow-lg shadow-black/40 backdrop-blur-sm">
                    Toca para saltar
                  </span>
                </div>
              ) : null}
            </div>
            <RunLadder
              goalMeters={config.goalMeters}
              rewards={rewards}
              meters={liveStats.meters}
              banked={liveStats.banked}
              bestMeters={liveStats.bestMeters}
              lives={liveStats.lives}
            />
          </div>
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

function SanFerminHeader({
  title,
  phase,
  goalMeters,
}: {
  title: string;
  phase: Phase;
  goalMeters: number;
}) {
  const compact = phase !== "intro";

  if (!compact) {
    return (
      <aside className="relative flex min-h-[225px] items-center justify-center overflow-hidden border-b border-white/10 bg-[#2a0d0d] sm:min-h-[245px]">
        <Image
          src={BACKGROUND_SRC}
          alt=""
          fill
          priority
          sizes="672px"
          className="object-cover opacity-50"
        />
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(circle_at_50%_78%,rgba(239,68,68,0.3),transparent_36%),linear-gradient(180deg,rgba(0,0,0,0.14),rgba(22,8,9,0.82))]"
        />
        <h2 id="sanfermin-title" className="sr-only">
          {title}
        </h2>
        <div className="relative z-10 h-[235px] w-[275px] overflow-hidden sm:h-[250px] sm:w-[295px]">
          <Image
            src={JOKER_FRONT_SRC}
            alt="Joker sanferminero"
            fill
            priority
            sizes="(max-width: 640px) 275px, 295px"
            className="object-contain object-top drop-shadow-[0_22px_26px_rgba(0,0,0,0.7)]"
          />
        </div>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-16 bg-gradient-to-t from-[#160809] via-[#160809]/70 to-transparent"
        />
      </aside>
    );
  }

  return (
    <aside className="relative z-10 border-b border-white/10 px-4 py-3 sm:px-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-red-200">
            Encierro pixel
          </p>
          <h2
            id="sanfermin-title"
            className="truncate text-lg font-bold uppercase tracking-tight text-white sm:text-xl"
          >
            {title}
          </h2>
        </div>
        <div className="shrink-0 rounded-full border border-white/10 bg-white/8 px-3 py-1 text-xs font-bold text-white">
          {goalMeters} m
        </div>
      </div>
    </aside>
  );
}

function IntroPanel({
  rewards,
  onStart,
}: {
  rewards: SanFerminReward[];
  onStart: () => void;
}) {
  return (
    <div className="relative z-10 px-4 pb-5 pt-5 sm:px-5">
      <span className="w-max rounded-full border border-red-200/25 bg-red-500/12 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-red-100">
        San Fermín · Encierro pixel
      </span>
      <h3 className="mt-3 text-2xl font-bold leading-none tracking-tight text-white sm:text-3xl">
        El Joker se ha escapado.
      </h3>
      <p className="mt-2 max-w-xl text-xs leading-5 text-zinc-300 sm:text-sm">
        Un Joker se ha escapado por los Sanfermines con el toro detrás. Salta
        las vallas y llega a los sobres antes de que te alcance.
      </p>

      <div className="mt-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-white/10" />
        <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-red-100">
          Sobres en juego
        </p>
        <span className="h-px flex-1 bg-white/10" />
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2 text-center">
        {rewards.map((reward) => (
          <div
            key={`${reward.meters}-${reward.title}`}
            className="rounded-lg border border-white/10 bg-black/24 px-1 py-2"
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
            <p className="mt-0.5 text-[8px] font-bold uppercase tracking-[0.12em] text-red-100">
              {reward.meters} m
            </p>
          </div>
        ))}
      </div>

      <div className="flex sm:justify-center">
        <button
          type="button"
          onClick={onStart}
          className="mt-5 w-full rounded-xl bg-gradient-to-r from-red-600 via-white to-red-500 px-5 py-3 text-sm font-bold uppercase tracking-[0.14em] text-[#210707] shadow-lg shadow-red-950/30 transition hover:brightness-110 sm:w-max sm:min-w-56"
        >
          Correr el encierro
        </button>
      </div>
    </div>
  );
}

function BriefingPanel({
  goalMeters,
  firstRewardMeters,
  onStart,
}: {
  goalMeters: number;
  firstRewardMeters: number;
  onStart: () => void;
}) {
  return (
    <div className="relative z-10 px-4 pb-5 pt-5 sm:px-5">
      <div className="rounded-xl border border-white/10 bg-black/24 p-4 text-center">
        <div className="flex justify-center gap-2">
          {Array.from({ length: MAX_LIVES }).map((_, index) => (
            <span
              key={`briefing-heart-${index}`}
              className="grid h-9 w-9 place-items-center rounded-full border border-red-200/20 bg-red-500/12 text-xl text-red-300 shadow-[0_0_18px_rgba(239,68,68,0.12)]"
            >
              ♥
            </span>
          ))}
        </div>
        <p className="mt-4 text-[10px] font-bold uppercase tracking-[0.24em] text-red-100">
          3 vidas
        </p>
        <h3 className="mt-2 text-2xl font-bold leading-none tracking-tight text-white sm:text-3xl">
          Tu mejor marca cuenta.
        </h3>
        <p className="mx-auto mt-3 max-w-md text-xs leading-5 text-zinc-300 sm:text-sm">
          Llega a {goalMeters} m. Cada valla fallada cuesta una vida. Si tu
          mejor carrera pasa el hito de {firstRewardMeters} m, ese sobre queda
          bancado.
        </p>
      </div>

      <div className="flex sm:justify-center">
        <button
          type="button"
          onClick={onStart}
          className="mt-5 w-full rounded-xl bg-gradient-to-r from-red-600 via-white to-red-500 px-5 py-3 text-sm font-bold uppercase tracking-[0.14em] text-[#210707] shadow-lg shadow-red-950/30 transition hover:brightness-110 sm:w-max sm:min-w-64"
        >
          Jugar con 3 vidas
        </button>
      </div>
    </div>
  );
}

function RunLadder({
  goalMeters,
  rewards,
  meters,
  banked,
  bestMeters,
  lives,
}: {
  goalMeters: number;
  rewards: SanFerminReward[];
  meters: number;
  banked: number;
  bestMeters: number;
  lives: number;
}) {
  const progress = Math.max(0, Math.min(100, (meters / goalMeters) * 100));
  const bestProgress = Math.max(0, Math.min(100, (bestMeters / goalMeters) * 100));

  return (
    <div className="mt-3 rounded-xl border border-white/10 bg-black/24 p-3">
      <div className="flex items-center justify-between gap-3 text-xs font-bold text-white">
        <span>{meters} m</span>
        <span className="text-red-100">{banked}/{rewards.length} sobres</span>
        <span className="tracking-[0.08em] text-red-300">
          {"♥".repeat(lives)}
          <span className="text-white/20">{"♥".repeat(MAX_LIVES - lives)}</span>
        </span>
      </div>
      <div className="relative mt-3 h-4 overflow-hidden rounded-full border border-white/10 bg-white/8">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-red-600 via-white to-red-500"
          style={{ width: `${progress}%` }}
        />
        <div
          className="absolute top-1/2 h-6 w-0.5 -translate-y-1/2 bg-yellow-300 shadow-[0_0_10px_rgba(250,204,21,0.8)]"
          style={{ left: `${bestProgress}%` }}
        />
        {rewards.map((reward, index) => {
          const left = Math.max(0, Math.min(100, (reward.meters / goalMeters) * 100));
          const earned = index < banked;
          return (
            <span
              key={`${reward.meters}-${reward.title}`}
              className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border ${
                earned
                  ? "border-yellow-200 bg-yellow-300"
                  : "border-white/35 bg-[#160809]"
              }`}
              style={{ left: `${left}%` }}
            />
          );
        })}
      </div>
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
  result: SanFerminResult | null;
  rewards: SanFerminReward[];
  wonAny: boolean;
  allowReplay: boolean;
  onReplay: () => void;
  onClose: () => void;
  onOpenPacks: () => void;
}) {
  const meters = result?.metersReached ?? 0;
  const banked = result?.packs ?? 0;
  const reachedGoal = result?.reachedGoal ?? false;

  return (
    <div className="relative z-10 flex flex-col items-center px-4 pb-5 pt-4 text-center sm:px-5">
      {wonAny ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-40 overflow-hidden">
          <div className="absolute left-1/2 top-4 h-40 w-40 -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(239,68,68,0.34),transparent_68%)] motion-safe:animate-[ruleta-win-burst_750ms_ease-out_both]" />
          {CONFETTI.map((piece, index) => (
            <span
              key={`confetti-${index}`}
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

      <p className="relative z-10 text-[11px] font-bold uppercase tracking-[0.24em] text-red-100">
        {reachedGoal ? "Encierro completado" : "Valla mordida"}
      </p>
      <p className="relative z-10 mt-1 font-[family-name:var(--font-display)] text-5xl leading-none text-white">
        {meters}
        <span className="text-2xl text-zinc-500"> m</span>
      </p>
      <p className="relative z-10 mt-2 max-w-sm text-xs leading-5 text-zinc-300">
        {reachedGoal
          ? `El Joker cruza la calle. Te llevas los ${banked} sobres.`
          : banked > 0
            ? `El toro aprieta, pero conservas ${banked} ${banked === 1 ? "sobre" : "sobres"} de ${rewards.length}.`
            : `No llegaste al primer sobre (${rewards[0]?.meters ?? 25} m).`}
      </p>

      <div className="relative z-10 mt-4 grid w-full max-w-sm grid-cols-4 gap-2">
        {rewards.map((reward, index) => {
          const earned = index < banked;
          return (
            <div
              key={`${reward.meters}-${reward.title}`}
              className={`rounded-xl border p-1.5 transition ${
                earned
                  ? "border-red-100/35 bg-red-400/[0.08]"
                  : "border-white/8 bg-white/[0.015]"
              }`}
            >
              <div
                className={`relative mx-auto aspect-[818/1206] w-9 ${
                  earned
                    ? "drop-shadow-[0_8px_18px_rgba(0,0,0,0.55)]"
                    : "opacity-35 grayscale"
                }`}
              >
                <Image
                  src={reward.image}
                  alt={reward.title}
                  fill
                  sizes="56px"
                  className="object-contain"
                />
              </div>
              <p className="mt-1 text-[8px] font-bold uppercase leading-tight text-white">
                {reward.meters} m
              </p>
            </div>
          );
        })}
      </div>

      <div className="relative z-10 mt-5 flex w-full max-w-sm flex-col gap-2 sm:flex-row">
        {wonAny ? (
          <button
            type="button"
            onClick={onOpenPacks}
            className="flex-1 rounded-xl bg-gradient-to-r from-red-600 via-white to-red-500 px-4 py-3 text-sm font-bold uppercase tracking-[0.12em] text-[#210707] transition hover:brightness-110"
          >
            Abrir sobres
          </button>
        ) : null}
        {allowReplay ? (
          <button
            type="button"
            onClick={onReplay}
            className="flex-1 rounded-xl border border-white/12 bg-white/8 px-4 py-3 text-sm font-bold uppercase tracking-[0.12em] text-white transition hover:bg-white/12"
          >
            Repetir demo
          </button>
        ) : (
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-white/12 bg-white/8 px-4 py-3 text-sm font-bold uppercase tracking-[0.12em] text-white transition hover:bg-white/12"
          >
            Cerrar
          </button>
        )}
      </div>
    </div>
  );
}

function recordBestRun(g: Game, goal: number) {
  const distance = Math.min(g.distance, goal);
  if (distance > g.bestDistance) {
    g.bestDistance = distance;
    g.bestBanked = g.banked;
    g.bestReachedGoal = distance >= goal;
  } else if (g.banked > g.bestBanked) {
    g.bestBanked = g.banked;
  }
}

function resetForNextLife(g: Game, config: SanFerminConfig) {
  g.distance = 0;
  g.speed = BASE_SPEED * 0.7;
  g.hurdles = buildHurdles(config);
  g.feetY = g.groundY;
  g.vy = 0;
  g.grounded = true;
  g.banked = 0;
  g.bankFlashUntil = 0;
  g.runStartT = 0;
  g.jumpBufferedUntil = 0;
  g.ended = false;
  g.endType = null;
  g.endT = 0;
  g.transitioned = false;
  g.shake = 0;
  g.deathRot = 0;
  g.deathVy = 0;
}

function updateRunnerPhysics(g: Game, dt: number, t: number) {
  if (g.ended && g.endType === "crash") {
    g.feetY += g.deathVy * dt;
    g.deathVy += g.H * 3.2 * dt;
    g.deathRot += dt * 7.5;
    if (g.feetY > g.groundY + g.H * 0.26) {
      g.feetY = g.groundY + g.H * 0.26;
      g.deathVy *= -0.12;
    }
    return;
  }

  if (!g.grounded) {
    g.vy += GRAVITY_FRAC * g.H * dt;
    g.feetY += g.vy * dt;
    if (g.feetY >= g.groundY) {
      g.feetY = g.groundY;
      g.vy = 0;
      g.grounded = true;
      spawnDust(g, 5);
      if (t < g.jumpBufferedUntil) {
        g.vy = JUMP_V_FRAC * g.H;
        g.grounded = false;
        g.jumpBufferedUntil = 0;
      }
    }
  }
}

function spawnDust(g: Game, count: number) {
  for (let i = 0; i < count; i++) {
    g.particles.push({
      x: g.runnerX + (Math.random() - 0.5) * g.W * 0.05,
      y: g.groundY + Math.random() * g.H * 0.015,
      vx: -g.W * (0.1 + Math.random() * 0.18),
      vy: -g.H * (0.08 + Math.random() * 0.12),
      life: 0,
      max: 0.35 + Math.random() * 0.22,
      size: 2 + Math.random() * 3,
      color: Math.random() > 0.45 ? "rgba(209,170,115,0.64)" : "rgba(255,255,255,0.48)",
    });
  }
}

function updateParticles(g: Game, dt: number) {
  for (const p of g.particles) {
    p.life += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += g.H * 0.7 * dt;
  }
  g.particles = g.particles.filter((p) => p.life < p.max);
}

function step(
  g: Game,
  config: SanFerminConfig,
  rewards: SanFerminReward[],
  goal: number,
  dt: number,
  t: number,
) {
  if (g.shake > 0) g.shake = Math.max(0, g.shake - 48 * dt);

  if (g.ended) {
    if (g.endType === "crash") updateRunnerPhysics(g, dt, t);
    updateParticles(g, dt);
    if (g.endType === "crash" && g.lives > 0 && t - g.endT > LIFE_RESTART_MS) {
      resetForNextLife(g, config);
    }
    return;
  }

  const countdown = getCountdownState(g, t);
  if (!countdown.active) {
    g.visualDistance += BASE_SPEED * 0.42 * dt;
    updateParticles(g, dt);
    return;
  }

  if (!g.runStartT) {
    g.runStartT = t;
    g.distance = 0;
    g.speed = 0;
  }

  const startup = Math.min(1, (t - g.runStartT) / STARTUP_MS);
  const target = BASE_SPEED + (MAX_SPEED - BASE_SPEED) * (g.distance / goal);
  g.speed = target * easeOut(startup);
  g.distance += g.speed * dt;
  g.visualDistance += g.speed * dt;

  updateRunnerPhysics(g, dt, t);

  while (g.banked < rewards.length && g.distance >= rewards[g.banked]!.meters) {
    g.banked += 1;
    g.bankFlashUntil = t + 820;
  }

  if (g.distance >= goal) {
    g.endType = "win";
    recordBestRun(g, goal);
    g.ended = true;
    g.endT = t;
    return;
  }

  const clearance = g.groundY - g.feetY;
  const runnerHalfW = g.W * 0.036;
  for (const m of g.hurdles) {
    const screenX = g.runnerX + (m - g.distance) * g.pxPerMeter;
    if (screenX < g.runnerX - g.W) continue;
    if (screenX > g.runnerX + g.W) break;
    const hurdleHalfW = g.W * 0.034;
    const hurdleH = g.H * HURDLE_H_FRAC;
    const dx = Math.abs(screenX - g.runnerX);
    if (dx < runnerHalfW + hurdleHalfW && clearance < hurdleH * 0.84) {
      recordBestRun(g, goal);
      g.lives = Math.max(0, g.lives - 1);
      g.ended = true;
      g.endType = "crash";
      g.endT = t;
      g.shake = 12;
      g.deathVy = -g.H * 0.55;
      g.grounded = false;
      spawnDust(g, 12);
      return;
    }
  }

  updateParticles(g, dt);
}

function render(
  ctx: CanvasRenderingContext2D,
  g: Game,
  config: SanFerminConfig,
  rewards: SanFerminReward[],
  runnerImg: HTMLImageElement,
  runnerReady: boolean,
  bullImg: HTMLImageElement,
  bullReady: boolean,
  backgroundImg: HTMLImageElement,
  backgroundReady: boolean,
  t: number,
) {
  const countdown = getCountdownState(g, t);
  ctx.clearRect(0, 0, g.W, g.H);

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  if (g.shake > 0.4) {
    ctx.translate((Math.random() - 0.5) * g.shake, (Math.random() - 0.5) * g.shake);
  }

  drawBackdrop(ctx, g, backgroundImg, backgroundReady);
  drawMotionLane(ctx, g);
  if (countdown.showObstacles) {
    drawHurdles(ctx, g);
    drawFinish(ctx, g, config);
  }
  drawParticles(ctx, g);
  drawBull(ctx, g, bullImg, bullReady, t);
  drawRunner(ctx, g, runnerImg, runnerReady, t);
  ctx.restore();

  drawHud(ctx, g, config, rewards, t);
  drawCountdown(ctx, g, countdown);
}

function drawBackdrop(
  ctx: CanvasRenderingContext2D,
  g: Game,
  img: HTMLImageElement,
  ready: boolean,
) {
  const { W, H } = g;
  const imgW = img.naturalWidth || img.width;
  const imgH = img.naturalHeight || img.height;

  if (!ready || !imgW || !imgH) {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#28a5f5");
    sky.addColorStop(0.5, "#f8fafc");
    sky.addColorStop(0.51, "#c77842");
    sky.addColorStop(1, "#bd7a4d");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    return;
  }

  const scale = Math.max(W / imgW, H / imgH);
  const sourceW = W / scale;
  const sourceH = H / scale;
  const sourceX = Math.max(0, (imgW - sourceW) / 2);
  const sourceY = Math.max(0, imgH - sourceH);
  ctx.drawImage(img, sourceX, sourceY, sourceW, sourceH, 0, 0, W, H);

  const shade = ctx.createLinearGradient(0, 0, 0, H);
  shade.addColorStop(0, "rgba(255,255,255,0.02)");
  shade.addColorStop(0.65, "rgba(0,0,0,0)");
  shade.addColorStop(1, "rgba(0,0,0,0.18)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, W, H);
}

function drawMotionLane(ctx: CanvasRenderingContext2D, g: Game) {
  const y = g.groundY + g.H * 0.04;
  const speedOffset = (g.visualDistance * g.pxPerMeter) % (g.W * 0.12);
  ctx.fillStyle = "rgba(255,255,255,0.16)";
  for (let x = -speedOffset; x < g.W; x += g.W * 0.12) {
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(g.W * 0.036), 3);
  }
  ctx.fillStyle = "rgba(70,40,26,0.28)";
  ctx.fillRect(0, Math.round(g.groundY + 2), g.W, 2);
}

function drawHurdles(
  ctx: CanvasRenderingContext2D,
  g: Game,
) {
  const baseH = g.H * HURDLE_H_FRAC;
  const baseW = g.W * 0.075;
  for (const m of g.hurdles) {
    const x = g.runnerX + (m - g.distance) * g.pxPerMeter;
    if (x < -baseW || x > g.W + baseW) continue;
    drawPixelFence(
      ctx,
      x,
      g.groundY,
      baseW,
      baseH,
      false,
    );
  }
}

function drawPixelFence(
  ctx: CanvasRenderingContext2D,
  x: number,
  baseY: number,
  w: number,
  h: number,
  reward: boolean,
) {
  const left = Math.round(x - w / 2);
  const top = Math.round(baseY - h);
  const postW = Math.max(5, Math.round(w * 0.14));
  const railH = Math.max(6, Math.round(h * 0.18));
  const dark = reward ? "#5b220d" : "#6b3a18";
  const mid = reward ? "#b45309" : "#9a5b24";
  const light = reward ? "#f8b453" : "#d18a3d";

  ctx.fillStyle = "rgba(0,0,0,0.26)";
  ctx.fillRect(left - 4, Math.round(baseY + 2), Math.round(w + 8), 5);
  ctx.fillStyle = dark;
  ctx.fillRect(left, top, postW, Math.round(h));
  ctx.fillRect(Math.round(left + w - postW), top, postW, Math.round(h));
  ctx.fillStyle = mid;
  ctx.fillRect(left, Math.round(top + h * 0.18), Math.round(w), railH);
  ctx.fillRect(left, Math.round(top + h * 0.58), Math.round(w), railH);
  ctx.fillStyle = light;
  ctx.fillRect(left + 1, Math.round(top + h * 0.18), Math.round(w - 2), 2);
  ctx.fillRect(left + 1, Math.round(top + h * 0.58), Math.round(w - 2), 2);

  if (reward) {
    ctx.fillStyle = "#ef4444";
    ctx.fillRect(Math.round(x - w * 0.22), Math.round(top - h * 0.2), Math.round(w * 0.44), Math.round(h * 0.2));
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(Math.round(x - w * 0.14), Math.round(top - h * 0.16), Math.round(w * 0.28), Math.round(h * 0.08));
  }
}

function drawFinish(ctx: CanvasRenderingContext2D, g: Game, config: SanFerminConfig) {
  const x = g.runnerX + (config.goalMeters - g.distance) * g.pxPerMeter;
  if (x < -g.W * 0.5 || x > g.W + g.W * 0.5) return;
  const poleH = g.H * 0.42;
  const top = g.groundY - poleH;
  const stripe = Math.max(8, Math.round(g.H * 0.04));

  ctx.fillStyle = "rgba(0,0,0,0.32)";
  ctx.fillRect(Math.round(x - 10), Math.round(g.groundY + 2), 20, 5);
  for (let y = top; y < g.groundY; y += stripe) {
    ctx.fillStyle = Math.floor((y - top) / stripe) % 2 === 0 ? "#ef4444" : "#ffffff";
    ctx.fillRect(Math.round(x - 5), Math.round(y), 10, Math.ceil(stripe));
  }
  ctx.fillStyle = "#111827";
  ctx.fillRect(Math.round(x - 6), Math.round(top), 12, Math.round(poleH));
  ctx.fillStyle = "#ef4444";
  ctx.fillRect(Math.round(x + 6), Math.round(top + 12), Math.round(g.W * 0.18), Math.round(g.H * 0.055));
  ctx.fillStyle = "#ffffff";
  ctx.font = "900 12px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("META", x + g.W * 0.095, top + 12 + g.H * 0.028);
}

function drawBull(
  ctx: CanvasRenderingContext2D,
  g: Game,
  img: HTMLImageElement,
  ready: boolean,
  t: number,
) {
  const motionT = t * MOTION_SPEED_MULTIPLIER;
  const h = g.H * BULL_H_FRAC;
  const aspect = ready && img.width && img.height ? img.width / img.height : 2;
  const w = h * aspect;
  const pressure = (MAX_LIVES - g.lives) * g.W * 0.018;
  const rightEdge =
    g.runnerX -
    g.W * 0.08 +
    pressure +
    Math.sin(motionT * 0.012) * g.W * 0.01;
  const left = rightEdge - w;
  const y = g.groundY;
  const shadowX = left + w * 0.52;
  const groundOffset = h * 0.045;

  ctx.fillStyle = "rgba(0,0,0,0.32)";
  ctx.beginPath();
  ctx.ellipse(shadowX, y + 3, w * 0.32, h * 0.08, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, g.W, g.H);
  ctx.clip();
  if (ready) {
    const chargeBob = Math.sin(motionT * 0.03) * g.H * 0.008;
    ctx.drawImage(img, left, y - h + chargeBob + groundOffset, w, h);
  } else {
    ctx.fillStyle = "#111827";
    ctx.fillRect(left, y - h + groundOffset, w, h);
  }
  ctx.restore();

  ctx.strokeStyle = "rgba(255,255,255,0.28)";
  ctx.lineWidth = Math.max(2, g.H * 0.006);
  for (let i = 0; i < 3; i++) {
    const sx = Math.max(10, rightEdge - w * (0.74 + i * 0.08));
    const sy = y - h * (0.56 - i * 0.12);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx - g.W * 0.055, sy + g.H * 0.008);
    ctx.stroke();
  }
}

function drawRunner(
  ctx: CanvasRenderingContext2D,
  g: Game,
  img: HTMLImageElement,
  ready: boolean,
  t: number,
) {
  const motionT = t * MOTION_SPEED_MULTIPLIER;
  const h = g.H * RUNNER_H_FRAC;
  const aspect =
    ready && img.width && img.height ? img.width / img.height : 0.58;
  const w = h * aspect;
  const clearance = g.groundY - g.feetY;
  const shadowScale = Math.max(0.25, 1 - clearance / (g.H * 0.32));

  ctx.fillStyle = `rgba(0,0,0,${0.36 * shadowScale})`;
  ctx.beginPath();
  ctx.ellipse(
    g.runnerX,
    g.groundY + 3,
    w * 0.38 * shadowScale,
    h * 0.065 * shadowScale,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  ctx.save();
  ctx.translate(g.runnerX, g.feetY);
  if (g.ended && g.endType === "crash") {
    ctx.rotate(g.deathRot);
  } else if (!g.grounded) {
    ctx.rotate(Math.max(-0.18, Math.min(0.32, g.vy / (g.H * 6))));
  } else {
    ctx.rotate(Math.sin(motionT * 0.02) * 0.03);
  }

  const bob =
    g.grounded ? Math.abs(Math.sin(motionT * 0.02)) * h * 0.03 : 0;
  if (ready) {
    const dx = Math.round(-w / 2);
    const dy = Math.round(-h + bob);
    ctx.drawImage(img, dx, dy, Math.round(w), Math.round(h));
  } else {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(Math.round(-w / 2), Math.round(-h), Math.round(w), Math.round(h));
  }
  ctx.restore();
}

function drawParticles(ctx: CanvasRenderingContext2D, g: Game) {
  for (const p of g.particles) {
    const k = 1 - p.life / p.max;
    ctx.globalAlpha = Math.max(0, k);
    ctx.fillStyle = p.color;
    ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
  }
  ctx.globalAlpha = 1;
}

function drawHud(
  ctx: CanvasRenderingContext2D,
  g: Game,
  config: SanFerminConfig,
  rewards: SanFerminReward[],
  t: number,
) {
  const meters = Math.min(Math.round(g.distance), config.goalMeters);

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  roundRect(ctx, g.W - 92, 10, 82, 29, 14);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 1;
  roundRect(ctx, g.W - 92, 10, 82, 29, 14);
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = "900 13px system-ui, sans-serif";
  ctx.fillText(`${meters}/${config.goalMeters}`, g.W - 51, 29);

  ctx.textAlign = "left";
  ctx.font = "900 18px system-ui, sans-serif";
  for (let i = 0; i < MAX_LIVES; i++) {
    ctx.fillStyle = i < g.lives ? "#ef4444" : "rgba(255,255,255,0.22)";
    ctx.fillText("♥", 14 + i * 19, 30);
  }

  if (t < g.bankFlashUntil) {
    const k = (g.bankFlashUntil - t) / 820;
    ctx.globalAlpha = Math.min(0.5, k * 0.58);
    const vg = ctx.createRadialGradient(
      g.W / 2,
      g.H / 2,
      g.H * 0.18,
      g.W / 2,
      g.H / 2,
      g.H * 0.76,
    );
    vg.addColorStop(0, "rgba(255,255,255,0)");
    vg.addColorStop(1, "rgba(239,68,68,0.95)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, g.W, g.H);
    ctx.globalAlpha = Math.min(1, k * 1.5);
    ctx.fillStyle = "#fff7ed";
    ctx.font = "900 22px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`SOBRE ${g.banked}/${rewards.length}`, g.W / 2, g.H * 0.32);
    ctx.globalAlpha = 1;
  }

  if (g.ended) {
    const k = Math.min(1, (t - g.endT) / 260);
    ctx.globalAlpha = (g.endType === "win" ? 0.22 : 0.32) * k;
    ctx.fillStyle = g.endType === "win" ? "#facc15" : "#ef4444";
    ctx.fillRect(0, 0, g.W, g.H);
    ctx.globalAlpha = 1;
  }
}

function drawCountdown(
  ctx: CanvasRenderingContext2D,
  g: Game,
  countdown: ReturnType<typeof getCountdownState>,
) {
  if (!countdown.label) return;
  const isGo = countdown.label === "YA!";
  const fadeOut = isGo
    ? Math.max(0, 1 - Math.max(0, countdown.phaseProgress - 0.58) / 0.42)
    : 1;
  const pop = isGo
    ? 1 + Math.sin(countdown.phaseProgress * Math.PI) * 0.08
    : 1.18 - countdown.phaseProgress * 0.16;
  const boxW = isGo ? 132 : 98;
  const boxH = 76;

  ctx.save();
  ctx.translate(g.W / 2, g.H * 0.42);
  ctx.scale(pop, pop);
  ctx.globalAlpha = fadeOut;
  ctx.fillStyle = "rgba(0,0,0,0.48)";
  roundRect(ctx, -boxW / 2, -boxH / 2, boxW, boxH, 14);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 1;
  roundRect(ctx, -boxW / 2, -boxH / 2, boxW, boxH, 14);
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = isGo ? "#ef4444" : "#ffffff";
  ctx.font = `900 ${isGo ? 42 : 58}px system-ui, sans-serif`;
  ctx.fillText(countdown.label, 0, isGo ? 1 : -1);
  ctx.restore();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
