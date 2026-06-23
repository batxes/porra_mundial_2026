"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// SALTA LA HOGUERA — minijuego endless-runner (noche de San Juan).
//
// Dragoia corre 100 m por el campo de la víspera de San Juanes en Mondra; tocas
// la pantalla para saltar las hogueras. Cada 25 m banca un sobre (4 en total).
// Si llega a meta se lleva los 4; si se quema, conserva los que hubiera bancado.
//
// Mismo patron que adivina/ruleta: este componente es reutilizable y se
// configura con un `HogueraConfig`. En prod la config vendra del admin/Supabase
// y onCompleted hara el RPC; en la demo se stubea (ver /hoguera-demo).
// ---------------------------------------------------------------------------

export type HogueraReward = {
  image: string;
  meters: number; // hito (en metros) en el que se banca este sobre
  title: string;
  pool?: string;
};

export type HogueraConfig = {
  id: string;
  title: string;
  goalMeters: number; // distancia de meta (p.ej. 100)
  flameEveryMeters: number; // separacion entre hogueras (p.ej. 5)
  rewards: HogueraReward[]; // sobres por hito, ordenados por `meters`
};

export type HogueraResult = {
  configId: string;
  metersReached: number;
  goalMeters: number;
  reachedGoal: boolean;
  packs: number;
  rewards: HogueraReward[];
};

export const hogueraCompletedEventName = "triliporra:hoguera-completed";

type Phase = "intro" | "briefing" | "playing" | "result";

type Runner = { id: string; src: string; label: string };
type HogueraLiveStats = {
  meters: number;
  banked: number;
  lives: number;
  bestMeters: number;
};

const DRAGOIA_RUNNER: Runner = {
  id: "dragoia",
  src: "/dragoia.webp",
  label: "Dragoia",
};

const MONDRAGON_BG_SRC = "/dragoia-bg-night.webp";

// Confeti con paleta de fuego para la pantalla de premio.
const CONFETTI = [
  { color: "#f5c518", delay: "0ms", left: "28%" },
  { color: "#ffb43c", delay: "60ms", left: "62%" },
  { color: "#ff6a2b", delay: "120ms", left: "45%" },
  { color: "#ff3b30", delay: "40ms", left: "72%" },
  { color: "#fff1c2", delay: "150ms", left: "20%" },
  { color: "#f97316", delay: "90ms", left: "55%" },
  { color: "#f5c518", delay: "180ms", left: "48%" },
  { color: "#ff3b30", delay: "110ms", left: "78%" },
  { color: "#ffb43c", delay: "70ms", left: "16%" },
  { color: "#ff6a2b", delay: "200ms", left: "60%" },
  { color: "#fff1c2", delay: "130ms", left: "36%" },
  { color: "#f97316", delay: "30ms", left: "68%" },
];

// --- Tuning del juego (todo escalado por la altura del canvas) ---------------
const METERS_PER_SCREEN = 10; // cuanta pista cabe a lo ancho
const RUNNER_X_FRAC = 0.24; // x fija del corredor (fraccion del ancho)
const GROUND_FRAC = 0.86; // y del suelo, alineado con la hierba del fondo
const RUNNER_H_FRAC = 0.24; // alto del sprite
const FLAME_H_FRAC = 0.17; // alto de la hoguera
const GRAVITY_FRAC = 3.75; // gravedad (x altura) px/s^2 -> con JUMP_V_FRAC da apex 0.30*H, 0.80s en aire
const JUMP_V_FRAC = -1.5; // impulso de salto (x altura) px/s
const BASE_SPEED = 3.2; // m/s al empezar
const MAX_SPEED = 4.4; // m/s cerca de meta
const STARTUP_MS = 750; // arranque suave 0 -> base
const MAX_LIVES = 3;
const LIFE_RESTART_MS = 900;
const COUNTDOWN_NUMBER_MS = 760;
const COUNTDOWN_READY_MS = COUNTDOWN_NUMBER_MS * 3;
const COUNTDOWN_GO_MS = 620;
const COUNTDOWN_TOTAL_MS = COUNTDOWN_READY_MS + COUNTDOWN_GO_MS;
const JUMP_BUFFER_MS = 130; // margen para registrar saltos anticipados
const END_FREEZE_MS = 750; // pausa de efecto antes de mostrar resultado

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
};
type Star = { x: number; y: number; r: number; a: number };

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
  flames: number[];
  banked: number;
  bankFlashUntil: number;
  lives: number;
  maxLives: number;
  bestDistance: number;
  bestBanked: number;
  bestReachedGoal: boolean;
  particles: Particle[];
  stars: Star[];
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
};

function buildFlames(config: HogueraConfig): number[] {
  const flames: number[] = [];
  const step = config.flameEveryMeters;
  // Hogueras desde el primer paso hasta justo antes de meta (la meta queda limpia).
  for (let m = step; m < config.goalMeters; m += step) flames.push(m);
  return flames;
}

function isMilestone(config: HogueraConfig, meters: number) {
  return config.rewards.some((r) => r.meters === meters);
}

function easeOut(t: number) {
  return 1 - (1 - t) * (1 - t);
}

function getCountdownState(g: Game, t: number) {
  const elapsed = Math.max(0, t - g.startT);
  const active = elapsed >= COUNTDOWN_READY_MS;
  let label: "3" | "2" | "1" | "GO!" | null = null;
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
    label = "GO!";
    phaseProgress = (elapsed - COUNTDOWN_READY_MS) / COUNTDOWN_GO_MS;
  }

  return {
    active,
    label,
    phaseProgress: Math.max(0, Math.min(1, phaseProgress)),
    showFlames: active,
  };
}

export function HogueraModal({
  config,
  allowReplay = true,
  onClose,
  onCompleted,
  onOpenPacks,
}: {
  config: HogueraConfig;
  allowReplay?: boolean;
  onClose: () => void;
  onCompleted?: (result: HogueraResult) => void;
  onOpenPacks?: () => void;
}) {
  const rewards = [...config.rewards].sort((a, b) => a.meters - b.meters);
  const totalSobres = rewards.length;

  const [phase, setPhase] = useState<Phase>("intro");
  const [result, setResult] = useState<HogueraResult | null>(null);
  const [hintGone, setHintGone] = useState(false);
  const [liveStats, setLiveStats] = useState<HogueraLiveStats>({
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

  const chosen = DRAGOIA_RUNNER;

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

  // Precarga (al montar, en la primera pantalla del modal) las imagenes que el
  // canvas pide con URL cruda, para que no carguen a mitad de partida.
  useEffect(() => {
    const sources = [DRAGOIA_RUNNER.src, MONDRAGON_BG_SRC];
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

  // --- Bucle del juego (solo activo en "playing") ---------------------------
  useEffect(() => {
    if (phase !== "playing") return;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const goal = config.goalMeters;
    const flames = buildFlames(config);

    const runnerImg = new window.Image();
    let runnerReady = false;
    runnerImg.onload = () => {
      runnerReady = true;
    };
    runnerImg.src = chosen.src;

    const backgroundImg = new window.Image();
    let backgroundReady = false;
    backgroundImg.onload = () => {
      backgroundReady = true;
    };
    backgroundImg.src = MONDRAGON_BG_SRC;

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
      flames,
      banked: 0,
      bankFlashUntil: 0,
      lives: MAX_LIVES,
      maxLives: MAX_LIVES,
      bestDistance: 0,
      bestBanked: 0,
      bestReachedGoal: false,
      particles: [],
      stars: [],
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
    };
    gameRef.current = g;

    const layout = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const w = container.clientWidth;
      const h = container.clientHeight;
      const oldW = g.W;
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
        // En el aire: conserva la altura relativa y reescala la velocidad.
        const frac = (oldGroundY - g.feetY) / oldH;
        g.feetY = g.groundY - frac * g.H;
        g.vy *= g.H / oldH;
      }
      // Estrellas: dispersas en el cielo (parte superior).
      if (!g.stars.length) {
        const n = Math.round((w * h) / 5200);
        for (let i = 0; i < n; i++) {
          g.stars.push({
            x: Math.random() * w,
            y: Math.random() * h * 0.55,
            r: Math.random() * 1.2 + 0.3,
            a: Math.random() * 0.6 + 0.25,
          });
        }
      } else if (oldW > 1 && oldH > 1 && (w !== oldW || h !== oldH)) {
        for (const s of g.stars) {
          s.x *= w / oldW;
          s.y *= h / oldH;
        }
      }
    };

    const doJump = () => {
      if (g.ended) return;
      if (g.grounded) {
        g.vy = JUMP_V_FRAC * g.H;
        g.grounded = false;
        spawnDust(g, 6);
      } else {
        // Salto anticipado: lo bufferizamos para que salga al aterrizar.
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
      const metersReached = Math.min(g.bestDistance, goal);
      const reachedGoal = g.bestReachedGoal || metersReached >= goal;
      const earned = rewards.slice(0, g.bestBanked);
      const res: HogueraResult = {
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
        const banked = g.banked;
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
        backgroundImg,
        backgroundReady,
        t,
      );

      const terminalRun = g.ended && (g.endType === "win" || g.lives <= 0);
      if (terminalRun && !g.transitioned && t - g.endT > END_FREEZE_MS) {
        g.transitioned = true;
        finish();
        return; // el cambio de fase desmonta el efecto y cancela el raf
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
    // IMPORTANTE: depende SOLO de `phase`. El bucle debe (re)arrancar al empezar
    // una partida (intro/result -> playing), NUNCA al cambiar la referencia de
    // `config` (p.ej. el polling/focus del gate), que reiniciaria el juego a
    // mitad. `config`/`rewards`/`chosen` se capturan en el closure al arrancar.
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
      aria-labelledby="hoguera-title"
    >
      <div className="theme-dark relative max-h-[calc(100vh-24px)] w-full max-w-xl overflow-x-hidden overflow-y-auto rounded-2xl border border-[#f5c518]/20 bg-[#06120b] text-white shadow-2xl shadow-black/70 motion-safe:animate-[adivina-pop_220ms_cubic-bezier(0.22,1,0.36,1)_both]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(145deg,rgba(33,197,94,0.13),transparent_34%,rgba(245,197,24,0.11)_72%,rgba(255,106,43,0.12))]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#f5c518]/85 to-transparent"
        />

        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="hidden"
        >
          ×
        </button>

        <HogueraEventHeader
          title={config.title || "SALTA LA HOGUERA"}
          phase={phase}
          goalMeters={config.goalMeters}
          rewardStep={config.rewards[0]?.meters ?? 25}
          totalRewards={totalSobres}
        />

        {phase === "intro" ? (
          <IntroPanel
            config={config}
            rewards={rewards}
            onStart={openBriefing}
          />
        ) : phase === "briefing" ? (
          <BriefingPanel
            goalMeters={config.goalMeters}
            rewards={rewards}
            onStart={start}
          />
        ) : phase === "playing" ? (
          <div className="relative z-10 px-3 pb-5 pt-4 sm:px-5">
            <div
              ref={containerRef}
              className="relative aspect-[16/10] max-h-[58vh] w-full touch-none select-none overflow-hidden rounded-2xl border border-emerald-200/18 bg-[#07130c] shadow-[inset_0_0_48px_rgba(0,0,0,0.62),0_18px_42px_rgba(0,0,0,0.36)]"
            >
              <canvas
                ref={canvasRef}
                className="absolute inset-0 h-full w-full"
              />
              {/* Capa transparente para el toque (todo el area salta) */}
              <button
                type="button"
                aria-label="Saltar"
                onPointerDown={onTapJump}
                className="absolute inset-0 z-20 h-full w-full cursor-pointer"
              />
              {!hintGone ? (
                <div className="pointer-events-none absolute inset-x-0 bottom-3 z-30 flex justify-center">
                  <span className="animate-pulse rounded-full border border-emerald-100/25 bg-black/58 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-white shadow-lg shadow-black/40 backdrop-blur-sm">
                    Toca para saltar
                  </span>
                </div>
              ) : null}
            </div>
            <HogueraRunLadder
              goalMeters={config.goalMeters}
              rewards={rewards}
              meters={liveStats.meters}
              banked={liveStats.banked}
              bestMeters={liveStats.bestMeters}
              lives={liveStats.lives}
              maxLives={MAX_LIVES}
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

function HogueraEventHeader({
  title,
  phase,
  goalMeters,
  rewardStep,
  totalRewards,
}: {
  title: string;
  phase: Phase;
  goalMeters: number;
  rewardStep: number;
  totalRewards: number;
}) {
  const compact = phase !== "intro";

  if (!compact) {
    return (
      <aside className="relative flex min-h-[205px] items-center justify-center overflow-hidden border-b border-white/10 bg-[#071008] p-0 sm:min-h-[235px]">
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(circle_at_50%_74%,rgba(245,197,24,0.16),transparent_28%),radial-gradient(circle_at_24%_42%,rgba(255,106,43,0.12),transparent_30%),radial-gradient(circle_at_78%_38%,rgba(34,197,94,0.12),transparent_32%),linear-gradient(180deg,rgba(0,0,0,0.08),rgba(0,0,0,0.42))]"
        />
        <div aria-hidden className="hoguera-hero-fire">
          <span className="hoguera-hero-flame hoguera-hero-flame--far-left" />
          <span className="hoguera-hero-flame hoguera-hero-flame--left" />
          <span className="hoguera-hero-flame hoguera-hero-flame--back-left" />
          <span className="hoguera-hero-flame hoguera-hero-flame--mid-left" />
          <span className="hoguera-hero-flame hoguera-hero-flame--center" />
          <span className="hoguera-hero-flame hoguera-hero-flame--mid-right" />
          <span className="hoguera-hero-flame hoguera-hero-flame--back-right" />
          <span className="hoguera-hero-flame hoguera-hero-flame--right" />
          <span className="hoguera-hero-flame hoguera-hero-flame--far-right" />
          <span className="hoguera-hero-ember hoguera-hero-ember--one" />
          <span className="hoguera-hero-ember hoguera-hero-ember--two" />
          <span className="hoguera-hero-ember hoguera-hero-ember--three" />
          <span className="hoguera-hero-ember hoguera-hero-ember--four" />
          <span className="hoguera-hero-ember hoguera-hero-ember--five" />
        </div>
        <h2 id="hoguera-title" className="sr-only">
          {title}
        </h2>
        <Image
          src="/dragoia.webp"
          alt="Dragoia"
          width={720}
          height={520}
          priority
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
        className="absolute inset-0 bg-[linear-gradient(120deg,rgba(245,197,24,0.08),transparent_34%,rgba(255,106,43,0.08)_76%,transparent),radial-gradient(circle_at_50%_100%,rgba(34,197,94,0.08),transparent_46%)]"
      />

      <div className="relative z-10">
        <p className="text-[9px] font-bold uppercase tracking-[0.22em] text-[#f5c518] sm:text-[10px]">
          Víspera · San Juanes
        </p>
        <h2
          id="hoguera-title"
          className="mt-1 text-xl font-bold uppercase leading-none text-white sm:text-2xl"
        >
          {title}
        </h2>
        <p className="mt-2 text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-500 sm:text-[10px]">
          Mondra · {goalMeters} m · {totalRewards} sobres cada {rewardStep} m
        </p>
      </div>
    </aside>
  );
}

function LivesRow({ lives, maxLives }: { lives: number; maxLives: number }) {
  return (
    <div
      className="flex items-center justify-center gap-2"
      aria-label={`Vidas: ${lives} de ${maxLives}`}
    >
      {Array.from({ length: maxLives }).map((_, index) => {
        const filled = index < lives;
        return (
          <svg
            key={`life-${index}`}
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

function HogueraRunLadder({
  goalMeters,
  rewards,
  meters,
  banked,
  bestMeters,
  lives,
  maxLives,
}: {
  goalMeters: number;
  rewards: HogueraReward[];
  meters: number;
  banked: number;
  bestMeters: number;
  lives: number;
  maxLives: number;
}) {
  const safeMeters = Math.max(0, Math.min(meters, goalMeters));
  const progressPct = Math.max(
    0,
    Math.min(100, (safeMeters / goalMeters) * 100),
  );
  const bestSafeMeters = Math.max(0, Math.min(bestMeters, goalMeters));

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#070b06]/78 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="mt-1 flex justify-center">
        <LivesRow lives={lives} maxLives={maxLives} />
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 px-1 text-[9px] font-black uppercase tracking-[0.16em] text-zinc-400">
        <span>Actual {safeMeters}/{goalMeters} m</span>
        <span className="text-[#f5c518]">Mejor {bestSafeMeters} m</span>
      </div>

      <div className="relative mt-3 px-1 pt-2">
        <div className="absolute left-2 right-2 top-[23px] h-1.5 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#22c55e] via-[#f5c518] to-[#ff6a2b] transition-[width] duration-150 ease-out"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <div className="relative grid grid-cols-4 gap-2">
          {rewards.map((reward, index) => {
            const earned = index < banked;
            return (
              <div
                key={`${reward.meters}-${reward.title}`}
                className="group flex min-w-0 flex-col items-center text-center"
              >
                <span
                  className={`relative z-10 grid h-8 w-8 place-items-center rounded-full border transition duration-300 ${
                    earned
                      ? "border-[#f5c518] bg-[#241a05] shadow-[0_0_18px_rgba(245,197,24,0.55)]"
                      : "border-white/15 bg-[#101407]"
                  }`}
                >
                  <span
                    className={`h-2.5 w-2.5 rounded-full transition duration-300 ${
                      earned
                        ? "bg-gradient-to-br from-[#fff3c0] to-[#ff6a2b]"
                        : "bg-white/15"
                    }`}
                  />
                </span>
                <div
                  className={`mt-2 w-full rounded-lg border px-1.5 py-2 transition duration-300 ${
                    earned
                      ? "border-[#f5c518]/45 bg-[#f5c518]/[0.07] shadow-[0_0_16px_rgba(245,197,24,0.2)]"
                      : "border-white/8 bg-white/[0.02]"
                  }`}
                >
                  <div
                    className={`relative mx-auto aspect-[818/1206] w-7 transition duration-300 ${
                      earned
                        ? "drop-shadow-[0_7px_14px_rgba(245,197,24,0.35)]"
                        : "opacity-40 grayscale"
                    }`}
                  >
                    <Image
                      src={reward.image}
                      alt={reward.title}
                      fill
                      sizes="44px"
                      className="object-contain"
                    />
                  </div>
                  <p
                    className={`mt-1 truncate text-[8px] font-black uppercase ${
                      earned ? "text-white" : "text-zinc-500"
                    }`}
                  >
                    {reward.title.replace(/^Sobre\s+/i, "")}
                  </p>
                  <p
                    className={`mt-0.5 text-[8px] font-bold uppercase tracking-[0.12em] ${
                      earned ? "text-[#f5c518]" : "text-zinc-600"
                    }`}
                  >
                    {earned ? "Ganado" : `${reward.meters} m`}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// LOGICA DEL JUEGO (mutaciones sobre `g`, sin estado de React por frame)
// ===========================================================================

function spawnDust(g: Game, n: number) {
  for (let i = 0; i < n; i++) {
    g.particles.push({
      x: g.runnerX + (Math.random() - 0.5) * g.W * 0.04,
      y: g.groundY,
      vx: -(Math.random() * 60 + 30),
      vy: -(Math.random() * 40 + 10),
      life: 0,
      max: 0.4 + Math.random() * 0.3,
      size: Math.random() * 3 + 1.5,
    });
  }
}

function updateRunnerPhysics(g: Game, dt: number, t: number) {
  if (!g.grounded) {
    g.vy += GRAVITY_FRAC * g.H * dt;
    g.feetY += g.vy * dt;
    if (g.feetY >= g.groundY) {
      g.feetY = g.groundY;
      g.vy = 0;
      g.grounded = true;
      spawnDust(g, 5);
      // Salto bufferizado al aterrizar.
      if (t < g.jumpBufferedUntil) {
        g.vy = JUMP_V_FRAC * g.H;
        g.grounded = false;
        g.jumpBufferedUntil = 0;
        spawnDust(g, 4);
      }
    }
  }
}

function recordBestRun(g: Game, goal: number) {
  const meters = Math.min(Math.round(g.distance), goal);
  if (meters > g.bestDistance || g.banked > g.bestBanked) {
    g.bestDistance = Math.max(g.bestDistance, meters);
    g.bestBanked = Math.max(g.bestBanked, g.banked);
  }
  if (meters >= goal || g.endType === "win") {
    g.bestReachedGoal = true;
  }
}

function resetLifeRun(g: Game, t: number) {
  g.distance = 0;
  g.visualDistance = 0;
  g.speed = 0;
  g.feetY = g.groundY;
  g.vy = 0;
  g.grounded = true;
  g.banked = 0;
  g.bankFlashUntil = 0;
  g.particles = [];
  g.startT = t;
  g.runStartT = 0;
  g.lastT = t;
  g.jumpBufferedUntil = 0;
  g.ended = false;
  g.endType = null;
  g.endT = 0;
  g.transitioned = false;
  g.shake = 0;
  g.deathRot = 0;
  g.deathVy = 0;
}

function step(
  g: Game,
  config: HogueraConfig,
  rewards: HogueraReward[],
  goal: number,
  dt: number,
  t: number,
) {
  if (g.ended) {
    // Animacion de muerte: el corredor cae girando.
    if (g.endType === "crash") {
      if (g.lives > 0 && t - g.endT > LIFE_RESTART_MS) {
        resetLifeRun(g, t);
        return;
      }
      g.deathVy += GRAVITY_FRAC * g.H * dt * 0.6;
      g.feetY += g.deathVy * dt;
      g.deathRot += dt * 6;
    }
    g.shake *= 0.9;
    updateParticles(g, dt);
    return;
  }

  const countdown = getCountdownState(g, t);
  if (!countdown.active) {
    g.speed = BASE_SPEED * 0.72;
    g.visualDistance += g.speed * dt;
    updateRunnerPhysics(g, dt, t);
    updateParticles(g, dt);
    return;
  }

  if (!g.runStartT) {
    g.runStartT = t;
    g.distance = 0;
    g.speed = 0;
  }

  // Velocidad: rampa de arranque suave + aceleracion con la distancia.
  const startup = Math.min(1, (t - g.runStartT) / STARTUP_MS);
  const target = BASE_SPEED + (MAX_SPEED - BASE_SPEED) * (g.distance / goal);
  g.speed = target * easeOut(startup);
  g.distance += g.speed * dt;
  g.visualDistance += g.speed * dt;

  // Fisica de salto.
  updateRunnerPhysics(g, dt, t);

  // Banca de sobres por hito (antes que la colision: si llegas, te lo llevas).
  while (g.banked < rewards.length && g.distance >= rewards[g.banked]!.meters) {
    g.banked += 1;
    g.bankFlashUntil = t + 900;
  }

  // Meta.
  if (g.distance >= goal) {
    g.endType = "win";
    recordBestRun(g, goal);
    g.ended = true;
    g.endT = t;
    return;
  }

  // Colision con hogueras. El hitbox sigue el tamano dibujado (las de hito
  // son mas grandes), para que lo que ves sea lo que te quema.
  const clearance = g.groundY - g.feetY; // altura de los pies sobre el suelo
  const runnerHalfW = g.W * 0.045;
  for (const m of g.flames) {
    const screenX = g.runnerX + (m - g.distance) * g.pxPerMeter;
    if (screenX < g.runnerX - g.W) continue; // ya pasada
    if (screenX > g.runnerX + g.W) break; // aun lejos (flames esta ordenado)
    const big = isMilestone(config, m);
    const flameHalfW = g.W * 0.035 * (big ? 1.15 : 1);
    const flameH = g.H * FLAME_H_FRAC * (big ? 1.2 : 1);
    const dx = Math.abs(screenX - g.runnerX);
    if (dx < runnerHalfW + flameHalfW && clearance < flameH * 0.72) {
      recordBestRun(g, goal);
      g.lives = Math.max(0, g.lives - 1);
      // Misma muerte en vidas intermedias y final: cae girando con shake/flash.
      // Si aun quedan vidas, el bloque `if (g.ended)` reinicia la carrera tras
      // LIFE_RESTART_MS (no reiniciamos al instante).
      g.ended = true;
      g.endType = "crash";
      g.endT = t;
      g.shake = 14;
      g.deathVy = -g.H * 0.6;
      g.grounded = false;
      return;
    }
  }

  updateParticles(g, dt);
}

function updateParticles(g: Game, dt: number) {
  for (const p of g.particles) {
    p.life += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 220 * dt; // el polvo cae
  }
  g.particles = g.particles.filter((p) => p.life < p.max);
}

// ===========================================================================
// RENDER
// ===========================================================================

function render(
  ctx: CanvasRenderingContext2D,
  g: Game,
  config: HogueraConfig,
  rewards: HogueraReward[],
  runnerImg: HTMLImageElement,
  runnerReady: boolean,
  backgroundImg: HTMLImageElement,
  backgroundReady: boolean,
  t: number,
) {
  const { W, H } = g;
  const countdown = getCountdownState(g, t);
  ctx.clearRect(0, 0, W, H);

  ctx.save();
  if (g.shake > 0.4) {
    ctx.translate(
      (Math.random() - 0.5) * g.shake,
      (Math.random() - 0.5) * g.shake,
    );
  }

  drawMondragonBackdrop(ctx, g, backgroundImg, backgroundReady, t);
  drawRaceLane(ctx, g);
  if (countdown.showFlames) {
    drawFlames(ctx, g, config, t);
    drawFinish(ctx, g, config);
  }
  drawParticles(ctx, g);
  drawRunner(ctx, g, runnerImg, runnerReady, t);
  ctx.restore();

  drawHud(ctx, g, config, rewards, t);
  drawCountdown(ctx, g, countdown);
}

function drawCountdown(
  ctx: CanvasRenderingContext2D,
  g: Game,
  countdown: ReturnType<typeof getCountdownState>,
) {
  if (!countdown.label) return;

  const { W, H } = g;
  const isGo = countdown.label === "GO!";
  const fadeOut = isGo
    ? Math.max(0, 1 - Math.max(0, countdown.phaseProgress - 0.58) / 0.42)
    : 1;
  const pop = isGo
    ? 1 + Math.sin(countdown.phaseProgress * Math.PI) * 0.08
    : 1.18 - countdown.phaseProgress * 0.16;
  const boxW = isGo ? 148 : 104;
  const boxH = 82;

  ctx.save();
  ctx.translate(W / 2, H * 0.43);
  ctx.scale(pop, pop);
  ctx.globalAlpha = fadeOut;
  ctx.fillStyle = "rgba(0,0,0,0.42)";
  roundRect(ctx, -boxW / 2, -boxH / 2, boxW, boxH, 18);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 1;
  roundRect(ctx, -boxW / 2, -boxH / 2, boxW, boxH, 18);
  ctx.stroke();
  ctx.shadowColor = isGo ? "rgba(245,197,24,0.8)" : "rgba(0,0,0,0.7)";
  ctx.shadowBlur = isGo ? 16 : 8;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = isGo ? "#f5c518" : "#ffffff";
  ctx.font = `900 ${isGo ? 42 : 58}px system-ui, sans-serif`;
  ctx.fillText(countdown.label, 0, isGo ? 1 : -1);
  ctx.restore();
}

function drawMondragonBackdrop(
  ctx: CanvasRenderingContext2D,
  g: Game,
  img: HTMLImageElement,
  ready: boolean,
  t: number,
) {
  const { W, H } = g;
  const imgW = img.naturalWidth || img.width;
  const imgH = img.naturalHeight || img.height;

  if (!ready || !imgW || !imgH) {
    drawStadiumBackdrop(ctx, g);
    drawStars(ctx, g, t);
    drawFloodlights(ctx, g);
    return;
  }

  const scale = Math.max(W / imgW, H / imgH);
  const sourceW = W / scale;
  const sourceH = H / scale;
  const sourceX = Math.max(0, (imgW - sourceW) / 2);
  const sourceY = Math.max(0, imgH - sourceH);

  ctx.drawImage(img, sourceX, sourceY, sourceW, sourceH, 0, 0, W, H);

  const night = ctx.createLinearGradient(0, 0, 0, H);
  night.addColorStop(0, "rgba(1,8,24,0.08)");
  night.addColorStop(0.54, "rgba(2,9,18,0.18)");
  night.addColorStop(1, "rgba(0,0,0,0.26)");
  ctx.fillStyle = night;
  ctx.fillRect(0, 0, W, H);
}

function drawStadiumBackdrop(ctx: CanvasRenderingContext2D, g: Game) {
  const { W, H } = g;
  const sky = ctx.createLinearGradient(0, 0, 0, g.groundY);
  sky.addColorStop(0, "#040713");
  sky.addColorStop(0.45, "#071329");
  sky.addColorStop(0.72, "#092018");
  sky.addColorStop(1, "#103a1d");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, g.groundY);

  const standTop = g.groundY - H * 0.25;
  const stand = ctx.createLinearGradient(0, standTop, 0, g.groundY);
  stand.addColorStop(0, "rgba(3,7,18,0.1)");
  stand.addColorStop(0.45, "rgba(5,9,18,0.72)");
  stand.addColorStop(1, "rgba(3,8,6,0.92)");
  ctx.fillStyle = stand;
  ctx.fillRect(0, standTop, W, g.groundY - standTop);

  ctx.fillStyle = "rgba(255,255,255,0.08)";
  for (let y = standTop + H * 0.04; y < g.groundY - H * 0.03; y += H * 0.045) {
    ctx.fillRect(0, y, W, 1);
  }

  const glow = ctx.createRadialGradient(
    W * 0.5,
    g.groundY - H * 0.05,
    0,
    W * 0.5,
    g.groundY - H * 0.05,
    W * 0.7,
  );
  glow.addColorStop(0, "rgba(245,197,24,0.18)");
  glow.addColorStop(0.44, "rgba(34,197,94,0.16)");
  glow.addColorStop(1, "rgba(255,140,40,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, g.groundY - H * 0.45, W, H * 0.45);
}

function drawStars(ctx: CanvasRenderingContext2D, g: Game, t: number) {
  for (const s of g.stars) {
    const tw = 0.6 + 0.4 * Math.sin(t * 0.002 + s.x);
    ctx.globalAlpha = s.a * tw;
    ctx.fillStyle = "#fff6d8";
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawFloodlights(ctx: CanvasRenderingContext2D, g: Game) {
  const lights = [
    { x: g.W * 0.13, y: g.H * 0.13, tilt: 1 },
    { x: g.W * 0.87, y: g.H * 0.13, tilt: -1 },
  ];

  for (const light of lights) {
    ctx.fillStyle = "rgba(9,14,22,0.8)";
    ctx.fillRect(light.x - 2, light.y, 4, g.groundY - light.y);

    const beam = ctx.createLinearGradient(
      light.x,
      light.y,
      g.W * 0.5,
      g.groundY,
    );
    beam.addColorStop(0, "rgba(255,246,205,0.22)");
    beam.addColorStop(1, "rgba(255,246,205,0)");
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(light.x, light.y);
    ctx.lineTo(g.W * (light.tilt > 0 ? 0.56 : 0.44), g.groundY);
    ctx.lineTo(g.W * (light.tilt > 0 ? 0.18 : 0.82), g.groundY);
    ctx.closePath();
    ctx.fill();

    const halo = ctx.createRadialGradient(
      light.x,
      light.y,
      0,
      light.x,
      light.y,
      g.H * 0.16,
    );
    halo.addColorStop(0, "rgba(255,246,205,0.5)");
    halo.addColorStop(1, "rgba(255,246,205,0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(light.x, light.y, g.H * 0.16, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#fff1b8";
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.arc(light.x + i * 9, light.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawRaceLane(ctx: CanvasRenderingContext2D, g: Game) {
  const { W, H } = g;
  const laneDistance = g.visualDistance;
  const laneTop = g.groundY - H * 0.08;
  const grd = ctx.createLinearGradient(0, laneTop, 0, H);
  grd.addColorStop(0, "rgba(20,83,45,0)");
  grd.addColorStop(0.36, "rgba(21,128,61,0.16)");
  grd.addColorStop(1, "rgba(4,24,12,0.42)");
  ctx.fillStyle = grd;
  ctx.fillRect(0, laneTop, W, H - laneTop);

  ctx.strokeStyle = "rgba(255,255,255,0.54)";
  ctx.lineWidth = Math.max(1, H * 0.0035);
  ctx.beginPath();
  ctx.moveTo(0, g.groundY + 1);
  ctx.lineTo(W, g.groundY + 1);
  ctx.stroke();

  ctx.strokeStyle = "rgba(255,255,255,0.2)";
  ctx.lineWidth = 1;
  const spacing = g.pxPerMeter; // una marca por metro
  const offset = (laneDistance * g.pxPerMeter) % spacing;
  for (let x = -offset; x < W; x += spacing) {
    ctx.beginPath();
    ctx.moveTo(x, g.groundY + H * 0.045);
    ctx.lineTo(x + spacing * 0.35, g.groundY + H * 0.045);
    ctx.stroke();
  }
}

function drawFlame(
  ctx: CanvasRenderingContext2D,
  x: number,
  baseY: number,
  w: number,
  h: number,
  t: number,
  seed: number,
  gold: boolean,
) {
  const flick =
    1 +
    0.14 * Math.sin(t * 0.012 + seed) +
    0.06 * Math.sin(t * 0.03 + seed * 2);
  const hh = h * flick;
  const sway = Math.sin(t * 0.008 + seed) * w * 0.12;
  // Resplandor.
  const glow = ctx.createRadialGradient(
    x,
    baseY - hh * 0.4,
    0,
    x,
    baseY - hh * 0.4,
    hh,
  );
  glow.addColorStop(
    0,
    gold ? "rgba(255,210,80,0.55)" : "rgba(255,140,40,0.45)",
  );
  glow.addColorStop(1, "rgba(255,120,30,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, baseY - hh * 0.4, hh, 0, Math.PI * 2);
  ctx.fill();
  // Troncos.
  ctx.fillStyle = "#3a2410";
  ctx.beginPath();
  ctx.ellipse(x, baseY, w * 0.75, h * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
  // Llama exterior (rojo->naranja->oro).
  const body = ctx.createLinearGradient(x, baseY, x, baseY - hh);
  body.addColorStop(0, "#d62410");
  body.addColorStop(0.45, "#ff6a1f");
  body.addColorStop(0.8, gold ? "#ffd24a" : "#ffb43c");
  body.addColorStop(1, "#fff3c0");
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(x - w * 0.5, baseY);
  ctx.quadraticCurveTo(
    x - w * 0.55,
    baseY - hh * 0.5,
    x - w * 0.1 + sway,
    baseY - hh * 0.78,
  );
  ctx.quadraticCurveTo(x + sway, baseY - hh, x + sway, baseY - hh);
  ctx.quadraticCurveTo(
    x + sway,
    baseY - hh * 0.85,
    x + w * 0.15 + sway,
    baseY - hh * 0.7,
  );
  ctx.quadraticCurveTo(x + w * 0.55, baseY - hh * 0.45, x + w * 0.5, baseY);
  ctx.closePath();
  ctx.fill();
  // Nucleo claro.
  const core = ctx.createLinearGradient(x, baseY, x, baseY - hh * 0.7);
  core.addColorStop(0, "#ff9a2e");
  core.addColorStop(1, "#fff6d8");
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.moveTo(x - w * 0.22, baseY);
  ctx.quadraticCurveTo(
    x - w * 0.2,
    baseY - hh * 0.4,
    x + sway * 0.6,
    baseY - hh * 0.55,
  );
  ctx.quadraticCurveTo(x + w * 0.2, baseY - hh * 0.4, x + w * 0.22, baseY);
  ctx.closePath();
  ctx.fill();
}

function drawFlames(
  ctx: CanvasRenderingContext2D,
  g: Game,
  config: HogueraConfig,
  t: number,
) {
  const flameH = g.H * FLAME_H_FRAC;
  const flameW = g.W * 0.085;
  for (const m of g.flames) {
    const x = g.runnerX + (m - g.distance) * g.pxPerMeter;
    if (x < -flameW || x > g.W + flameW) continue;
    const milestone = isMilestone(config, m);
    drawFlame(
      ctx,
      x,
      g.groundY,
      milestone ? flameW * 1.15 : flameW,
      milestone ? flameH * 1.2 : flameH,
      t,
      m,
      milestone,
    );
    if (milestone) {
      // Etiqueta del hito de sobre.
      ctx.fillStyle = "#ffe08a";
      ctx.font = "800 11px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`${m} m`, x, g.groundY - flameH * 1.5);
    }
  }
}

function drawFinish(
  ctx: CanvasRenderingContext2D,
  g: Game,
  config: HogueraConfig,
) {
  const x = g.runnerX + (config.goalMeters - g.distance) * g.pxPerMeter;
  if (x < -g.W * 0.5 || x > g.W + g.W * 0.5) return;
  const goalW = g.W * 0.34;
  const goalH = g.H * 0.34;
  const topY = g.groundY - goalH;
  const left = x - goalW / 2;
  const right = x + goalW / 2;

  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.beginPath();
  ctx.ellipse(x, g.groundY + 3, goalW * 0.56, g.H * 0.035, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(255,255,255,0.28)";
  ctx.lineWidth = 1;
  for (let gx = left + goalW / 5; gx < right; gx += goalW / 5) {
    ctx.beginPath();
    ctx.moveTo(gx, topY + 4);
    ctx.lineTo(gx, g.groundY);
    ctx.stroke();
  }
  for (let gy = topY + goalH / 4; gy < g.groundY; gy += goalH / 4) {
    ctx.beginPath();
    ctx.moveTo(left, gy);
    ctx.lineTo(right, gy);
    ctx.stroke();
  }

  ctx.strokeStyle = "#f8fafc";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(left, g.groundY);
  ctx.lineTo(left, topY);
  ctx.lineTo(right, topY);
  ctx.lineTo(right, g.groundY);
  ctx.stroke();

  const bannerH = g.H * 0.065;
  const banner = ctx.createLinearGradient(
    left,
    topY - bannerH,
    right,
    topY - bannerH,
  );
  banner.addColorStop(0, "#19c463");
  banner.addColorStop(0.55, "#f5c518");
  banner.addColorStop(1, "#ff6a2b");
  ctx.fillStyle = banner;
  roundRect(ctx, left - 6, topY - bannerH - 8, goalW + 12, bannerH, 7);
  ctx.fill();
  ctx.fillStyle = "#06120b";
  ctx.font = "800 13px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("META", x, topY - bannerH / 2 - 8);
  ctx.textBaseline = "alphabetic";
}

function drawParticles(ctx: CanvasRenderingContext2D, g: Game) {
  for (const p of g.particles) {
    const k = 1 - p.life / p.max;
    ctx.globalAlpha = Math.max(0, k);
    ctx.fillStyle = "rgba(200,170,120,0.58)";
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawRunner(
  ctx: CanvasRenderingContext2D,
  g: Game,
  img: HTMLImageElement,
  ready: boolean,
  t: number,
) {
  const h = g.H * RUNNER_H_FRAC;
  const aspect =
    ready && img.width && img.height ? img.width / img.height : 0.8;
  const w = h * aspect;
  const clearance = g.groundY - g.feetY;
  // Sombra (se encoge al subir).
  const shadowScale = Math.max(0.25, 1 - clearance / (g.H * 0.3));
  ctx.fillStyle = `rgba(0,0,0,${0.4 * shadowScale})`;
  ctx.beginPath();
  ctx.ellipse(
    g.runnerX,
    g.groundY + 2,
    w * 0.42 * shadowScale,
    h * 0.07 * shadowScale,
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
    // Inclinacion segun la velocidad vertical.
    ctx.rotate(Math.max(-0.18, Math.min(0.3, g.vy / (g.H * 6))));
  } else {
    // Bob de carrera.
    ctx.rotate(Math.sin(t * 0.02) * 0.03);
  }
  const bob = g.grounded ? Math.abs(Math.sin(t * 0.02)) * h * 0.03 : 0;
  if (ready) {
    ctx.drawImage(img, -w / 2, -h + bob, w, h);
  } else {
    // Fallback mientras carga.
    ctx.fillStyle = "#f5c518";
    ctx.beginPath();
    ctx.arc(0, -h * 0.5, w * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }
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

function drawHud(
  ctx: CanvasRenderingContext2D,
  g: Game,
  config: HogueraConfig,
  rewards: HogueraReward[],
  t: number,
) {
  const { W } = g;
  const meters = Math.min(Math.round(g.distance), config.goalMeters);

  // Metros, arriba derecha donde antes estaba el boton de salir.
  const meterBoxW = 78;
  const meterBoxH = 28;
  const meterBoxX = W - meterBoxW - 10;
  const meterBoxY = 10;
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(0,0,0,0.46)";
  roundRect(ctx, meterBoxX, meterBoxY, meterBoxW, meterBoxH, 14);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  ctx.lineWidth = 1;
  roundRect(ctx, meterBoxX, meterBoxY, meterBoxW, meterBoxH, 14);
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = "900 13px system-ui, sans-serif";
  ctx.fillText(
    `${meters}/${config.goalMeters}`,
    meterBoxX + meterBoxW / 2,
    meterBoxY + 18,
  );
  ctx.textAlign = "left";

  ctx.save();
  ctx.globalAlpha = 0;
  // Sobres bancados (arriba derecha): pips que se rellenan.
  const pip = 16;
  const gap = 5;
  const totalW = rewards.length * pip + (rewards.length - 1) * gap;
  let px = W - 14 - totalW;
  const py = 30;
  ctx.fillStyle = "rgba(0,0,0,0.42)";
  roundRect(ctx, px - 7, py - 6, totalW + 14, pip + 12, 9);
  ctx.fill();
  for (let i = 0; i < rewards.length; i++) {
    const got = i < g.banked;
    if (got) {
      const grad = ctx.createLinearGradient(px, py, px, py + pip);
      grad.addColorStop(0, "#ffe08a");
      grad.addColorStop(1, "#f5c518");
      ctx.fillStyle = grad;
      roundRect(ctx, px, py, pip, pip, 3);
      ctx.fill();
      ctx.fillStyle = "#120a06";
      ctx.font = "800 11px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("★", px + pip / 2, py + pip - 4);
    } else {
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 1.5;
      roundRect(ctx, px, py, pip, pip, 3);
      ctx.stroke();
    }
    px += pip + gap;
  }
  ctx.textAlign = "left";
  ctx.restore();

  // Flash al bancar un sobre.
  if (t < g.bankFlashUntil) {
    const k = (g.bankFlashUntil - t) / 900;
    ctx.globalAlpha = Math.min(0.5, k * 0.6);
    const vg = ctx.createRadialGradient(
      W / 2,
      g.H / 2,
      g.H * 0.2,
      W / 2,
      g.H / 2,
      g.H * 0.7,
    );
    vg.addColorStop(0, "rgba(245,197,24,0)");
    vg.addColorStop(1, "rgba(245,197,24,0.9)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, g.H);
    ctx.globalAlpha = Math.min(1, k * 1.5);
    ctx.fillStyle = "#fff3c0";
    ctx.font = "800 22px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`¡SOBRE ${g.banked}/${rewards.length}!`, W / 2, g.H * 0.32);
    ctx.textAlign = "left";
    ctx.globalAlpha = 1;
  }

  // Flash de meta / quemado.
  if (g.ended) {
    const k = Math.min(1, (t - g.endT) / 300);
    if (g.endType === "win") {
      ctx.globalAlpha = 0.25 * k;
      ctx.fillStyle = "#f5c518";
    } else {
      ctx.globalAlpha = 0.35 * k;
      ctx.fillStyle = "#ff3b30";
    }
    ctx.fillRect(0, 0, W, g.H);
    ctx.globalAlpha = 1;
  }
}

// ===========================================================================
// PANELES (DOM)
// ===========================================================================

function IntroPanel({
  config,
  rewards,
  onStart,
}: {
  config: HogueraConfig;
  rewards: HogueraReward[];
  onStart: () => void;
}) {
  return (
    <div className="relative z-10 flex flex-col justify-center px-4 pb-5 pt-5 sm:px-5">
      <span className="w-max rounded-full border border-[#f5c518]/30 bg-[#f5c518]/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#f5c518]">
        Víspera · San Juanes
      </span>
      <h3 className="mt-3 text-2xl font-bold leading-none tracking-tight text-white sm:text-3xl">
        San juan bezpera!
      </h3>
      <p className="mt-2 max-w-xl text-xs leading-5 text-zinc-300 sm:text-sm">
        ¡El campo está lleno de hogueras! Toca la pantalla para saltar hasta la
        portería de {config.goalMeters} m: cada {rewards[0]?.meters ?? 25} m que
        sobrevivas gana un sobre.
      </p>

      {/* Premios en juego */}
      <div className="mt-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-white/10" />
        <p className="text-[10px] font-bold uppercase tracking-[0.26em] text-[#f5c518]">
          Sobres en juego
        </p>
        <span className="h-px flex-1 bg-white/10" />
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2 text-center">
        {rewards.map((r) => (
          <div
            key={`${r.meters}-${r.title}`}
            className="rounded-lg border border-emerald-100/12 bg-black/24 px-1 py-2"
          >
            <div className="relative mx-auto aspect-[818/1206] w-8">
              <Image
                src={r.image}
                alt={r.title}
                fill
                sizes="48px"
                className="object-contain"
              />
            </div>
            <p className="mt-1 text-[9px] font-black uppercase leading-tight text-white">
              {r.title.replace(/^Sobre\s+/i, "")}
            </p>
            <p className="mt-0.5 text-[8px] font-bold uppercase tracking-[0.12em] text-[#f5c518]">
              {r.meters} m
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
          Saltar las hogueras
        </button>
      </div>
    </div>
  );
}

function BriefingPanel({
  goalMeters,
  rewards,
  onStart,
}: {
  goalMeters: number;
  rewards: HogueraReward[];
  onStart: () => void;
}) {
  const firstRewardMeters = rewards[0]?.meters ?? 25;

  return (
    <div className="relative z-10 px-4 pb-5 pt-5 sm:px-5">
      <div className="rounded-2xl border border-white/10 bg-black/24 p-4 text-center">
        <div className="flex justify-center gap-2">
          {Array.from({ length: MAX_LIVES }).map((_, index) => (
            <span
              key={`briefing-heart-${index}`}
              className="grid h-9 w-9 place-items-center rounded-full border border-red-200/20 bg-red-500/12 text-xl text-red-400 shadow-[0_0_18px_rgba(255,59,48,0.12)]"
            >
              ♥
            </span>
          ))}
        </div>

        <p className="mt-4 text-[10px] font-black uppercase tracking-[0.24em] text-[#f5c518]">
          3 vidas
        </p>
        <h3 className="mt-2 text-2xl font-bold leading-none tracking-tight text-white sm:text-3xl">
          Tu mejor marca manda.
        </h3>
        <p className="mx-auto mt-3 max-w-md text-xs leading-5 text-zinc-300 sm:text-sm">
          Tienes tres intentos para llegar a la porteria de {goalMeters} m. Cada
          hoguera te quita un corazon. Al final cuenta tu mejor carrera: si tu
          mejor marca pasa un hito de {firstRewardMeters} m, ese sobre queda
          bancado.
        </p>
      </div>

      <div className="flex sm:justify-center">
        <button
          type="button"
          onClick={onStart}
          className="mt-5 w-full rounded-xl bg-gradient-to-r from-[#22c55e] via-[#f5c518] to-[#ff6a2b] px-5 py-3 text-sm font-bold uppercase tracking-[0.14em] text-[#06120b] shadow-lg shadow-[#ff6a2b]/20 transition hover:brightness-110 sm:w-max sm:min-w-64"
        >
          Jugar con 3 vidas
        </button>
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
  result: HogueraResult | null;
  rewards: HogueraReward[];
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
          <div className="absolute left-1/2 top-4 h-40 w-40 -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(245,197,24,0.4),transparent_68%)] motion-safe:animate-[ruleta-win-burst_750ms_ease-out_both]" />
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

      <p className="relative z-10 text-[11px] font-bold uppercase tracking-[0.24em] text-[#f5c518]">
        {reachedGoal ? "Portería final" : "Hoguera pisada"}
      </p>
      <p className="relative z-10 mt-1 font-[family-name:var(--font-display)] text-5xl leading-none text-white">
        {meters}
        <span className="text-2xl text-zinc-500"> m</span>
      </p>
      <p className="relative z-10 mt-2 max-w-sm text-xs leading-5 text-zinc-300">
        {reachedGoal
          ? `Cruzaste el campo de fuego. Te llevas los ${banked} sobres.`
          : banked > 0
            ? `Te cazó una hoguera, pero conservas ${banked} ${banked === 1 ? "sobre" : "sobres"} de los ${rewards.length}.`
            : `No llegaste al primer sobre (${rewards[0]?.meters ?? 25} m). Otra carrera y a la banda.`}
      </p>

      <div className="relative z-10 mt-4 grid w-full max-w-sm grid-cols-4 gap-2">
        {rewards.map((reward, index) => {
          const earned = index < banked;
          return (
            <div
              key={`${reward.meters}-${reward.title}`}
              className={`rounded-xl border p-1.5 transition ${
                earned
                  ? "border-[#f5c518]/35 bg-emerald-400/[0.055]"
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
                  sizes="60px"
                  className="object-contain"
                />
              </div>
              <p
                className={`mt-1 text-[9px] font-black uppercase leading-tight ${
                  earned ? "text-white" : "text-zinc-500"
                }`}
              >
                {reward.title.replace(/^Sobre\s+/i, "")}
              </p>
              <p
                className={`mt-0.5 text-[8px] font-bold uppercase tracking-[0.1em] ${
                  earned ? "text-[#f5c518]" : "text-zinc-600"
                }`}
              >
                {earned ? "Ganado" : `${reward.meters} m`}
              </p>
            </div>
          );
        })}
      </div>

      <div className="relative z-10 mt-5 flex w-full flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={wonAny ? onOpenPacks : onClose}
          className="rounded-xl bg-gradient-to-r from-[#22c55e] via-[#f5c518] to-[#ff6a2b] px-5 py-3 text-sm font-bold uppercase tracking-[0.1em] text-[#06120b] shadow-lg shadow-[#ff6a2b]/18 transition hover:brightness-110"
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
