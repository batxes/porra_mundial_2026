"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type QuienDaMasFormat =
  | "age"
  | "compact"
  | "currency"
  | "height"
  | "int";

export type QuienDaMasSide = {
  id: string;
  name: string;
  teamCode?: string;
  teamName?: string;
  image?: string;
  value: number;
};

export type QuienDaMasDuel = {
  id: string;
  question: string;
  metricLabel: string;
  format?: QuienDaMasFormat;
  a: QuienDaMasSide;
  b: QuienDaMasSide;
};

export type QuienDaMasReward = {
  image: string;
  minScore: number;
  pool?: string;
  title: string;
};

export type QuienDaMasConfig = {
  id: string;
  title: string;
  duelTimeMs: number;
  duels: QuienDaMasDuel[];
  rewards: QuienDaMasReward[];
};

export type QuienDaMasResult = {
  configId: string;
  picks: Array<"a" | "b" | null>;
  correct: number;
  total: number;
  packs: number;
  rewards?: QuienDaMasReward[];
  awardedDropIds?: string[];
};

export const quienDaMasCompletedEventName = "triliporra:quien-da-mas-completed";

function rewardsForCorrect(correct: number, rewards: QuienDaMasReward[]) {
  return rewards.filter((reward) => correct >= reward.minScore);
}

function formatValue(
  value: number,
  format: QuienDaMasFormat = "int",
): string {
  if (format === "age") {
    const years = Math.floor(value);
    const days = Math.min(364, Math.round((value - years) * 365));
    return `${years}a ${days}d`;
  }
  if (format === "currency") {
    return `${formatValue(value, "compact")} €`;
  }
  if (format === "compact") {
    if (value >= 1e6) {
      const millions = value / 1e6;
      const rounded =
        millions >= 100 ? Math.round(millions) : Math.round(millions * 10) / 10;
      return `${String(rounded).replace(".", ",")}M`;
    }
    if (value >= 1e3) return `${Math.round(value / 1e3)}K`;
    return `${Math.round(value)}`;
  }
  if (format === "height") {
    return `${(value / 100).toFixed(2).replace(".", ",")} m`;
  }
  return Math.round(value).toLocaleString("es-ES");
}

function codeToFlag(code?: string | null) {
  if (!code || code.length !== 2 || /[^a-z]/i.test(code)) return "";
  const base = 0x1f1e6;
  const up = code.toUpperCase();
  return String.fromCodePoint(
    base + up.charCodeAt(0) - 65,
    base + up.charCodeAt(1) - 65,
  );
}

const CONFETTI = [
  { color: "#a7f600", delay: "0ms", left: "30%" },
  { color: "#2f6bff", delay: "60ms", left: "62%" },
  { color: "#16b364", delay: "120ms", left: "45%" },
  { color: "#ff3b30", delay: "40ms", left: "70%" },
  { color: "#9b5cff", delay: "150ms", left: "22%" },
  { color: "#f7c93b", delay: "90ms", left: "55%" },
  { color: "#19c5e6", delay: "180ms", left: "48%" },
  { color: "#ff3b30", delay: "110ms", left: "75%" },
  { color: "#16b364", delay: "70ms", left: "18%" },
  { color: "#9b5cff", delay: "200ms", left: "60%" },
  { color: "#2f6bff", delay: "130ms", left: "38%" },
  { color: "#f7c93b", delay: "30ms", left: "66%" },
];

type Phase = "intro" | "playing" | "result";
type DuelState = "picking" | "revealed";
type Outcome = "hit" | "miss";
type PickSide = "a" | "b";

function CountUpValue({
  value,
  format,
  durationMs = 900,
}: {
  value: number;
  format: QuienDaMasFormat;
  durationMs?: number;
}) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    let raf = 0;
    const startedAt = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - startedAt) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(value * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, durationMs]);
  return <>{formatValue(shown, format)}</>;
}

export function QuienDaMasModal({
  allowReplay = true,
  config,
  onClose,
  onCompleted,
  onOpenPacks,
  onReplay,
}: {
  allowReplay?: boolean;
  config: QuienDaMasConfig;
  onClose: () => void;
  onCompleted?: (
    result: QuienDaMasResult,
  ) =>
    | Promise<Partial<QuienDaMasResult> | void>
    | Partial<QuienDaMasResult>
    | void;
  onOpenPacks?: () => void;
  onReplay?: () => void;
}) {
  const duels = config.duels;
  const rewards = useMemo(() => config.rewards || [], [config.rewards]);
  const total = duels.length;
  const duelTimeMs = config.duelTimeMs;

  const [phase, setPhase] = useState<Phase>("intro");
  const [duelIndex, setDuelIndex] = useState(0);
  const [duelState, setDuelState] = useState<DuelState>("picking");
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [picked, setPicked] = useState<PickSide | null>(null);
  const [timeLeftMs, setTimeLeftMs] = useState(duelTimeMs);
  const [submitState, setSubmitState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [submitError, setSubmitError] = useState("");
  const [completedResult, setCompletedResult] =
    useState<QuienDaMasResult | null>(null);

  const outcomesRef = useRef<Outcome[]>([]);
  const picksRef = useRef<Array<PickSide | null>>([]);
  const advanceRef = useRef<number | null>(null);

  const duel = duels[duelIndex];
  const currentOutcome = outcomes[duelIndex];

  const correctCount = useMemo(
    () => outcomes.filter((outcome) => outcome === "hit").length,
    [outcomes],
  );

  // La portada es el momento ideal para calentar las imágenes de los dos
  // jugadores de cada duelo. Así la transición al primer (y siguientes)
  // enfrentamientos no depende de la red.
  useEffect(() => {
    const imageSources = new Set(
      duels.flatMap((item) => [item.a.image, item.b.image]).filter(
        (source): source is string => Boolean(source),
      ),
    );
    imageSources.forEach((source) => {
      const preload = new window.Image();
      preload.src = source;
    });
  }, [duels]);

  const submitCompletion = useCallback(
    async (result: QuienDaMasResult) => {
      if (!onCompleted) {
        setSubmitState("saved");
        return;
      }
      setSubmitState("saving");
      setSubmitError("");
      try {
        const completion = await onCompleted(result);
        if (completion) {
          const nextCorrect =
            typeof completion.correct === "number"
              ? completion.correct
              : result.correct;
          const nextRewards =
            completion.rewards || rewardsForCorrect(nextCorrect, rewards);
          setCompletedResult({
            ...result,
            ...completion,
            correct: nextCorrect,
            packs:
              typeof completion.packs === "number"
                ? completion.packs
                : nextRewards.length,
            rewards: nextRewards,
          });
        }
        setSubmitState("saved");
      } catch (error) {
        const msg =
          error instanceof Error
            ? error.message
            : "No se han podido preparar tus sobres.";
        setSubmitError(msg);
        setSubmitState("error");
      }
    },
    [onCompleted, rewards],
  );

  const finish = useCallback(
    (finalOutcomes: Outcome[]) => {
      const correct = finalOutcomes.filter(
        (outcome) => outcome === "hit",
      ).length;
      const earnedRewards = rewardsForCorrect(correct, rewards);
      const result: QuienDaMasResult = {
        configId: config.id,
        picks: picksRef.current.slice(0, total),
        correct,
        total,
        packs: earnedRewards.length,
        rewards: earnedRewards,
      };
      setCompletedResult(result);
      setPhase("result");
      void submitCompletion(result);
    },
    [config.id, rewards, submitCompletion, total],
  );

  const advance = useCallback(
    (outcome: Outcome, pick: PickSide | null) => {
      setDuelState("revealed");
      setPicked(pick);
      const next = [...outcomesRef.current];
      next[duelIndex] = outcome;
      outcomesRef.current = next;
      const nextPicks = [...picksRef.current];
      nextPicks[duelIndex] = pick;
      picksRef.current = nextPicks;
      setOutcomes(next);

      const isLast = duelIndex + 1 >= total;
      if (advanceRef.current) window.clearTimeout(advanceRef.current);
      advanceRef.current = window.setTimeout(
        () => {
          if (isLast) {
            finish(next);
          } else {
            setDuelIndex((index) => index + 1);
            setDuelState("picking");
            setPicked(null);
            setTimeLeftMs(duelTimeMs);
          }
        },
        outcome === "hit" ? 1900 : 2200,
      );
    },
    [duelIndex, duelTimeMs, total, finish],
  );

  const submitPick = useCallback(
    (side: PickSide) => {
      if (duelState !== "picking" || !duel) return;
      const chosen = side === "a" ? duel.a : duel.b;
      const other = side === "a" ? duel.b : duel.a;
      // Empate cuenta como acierto (el banco no deberia traer empates).
      advance(chosen.value >= other.value ? "hit" : "miss", side);
    },
    [duelState, duel, advance],
  );

  const start = useCallback(() => {
    outcomesRef.current = [];
    picksRef.current = [];
    setOutcomes([]);
    setCompletedResult(null);
    setDuelIndex(0);
    setDuelState("picking");
    setPicked(null);
    setTimeLeftMs(duelTimeMs);
    setSubmitState("idle");
    setSubmitError("");
    setPhase("playing");
  }, [duelTimeMs]);

  useEffect(() => {
    if (phase !== "playing" || duelState !== "picking") return;
    const deadline = performance.now() + duelTimeMs;
    const id = window.setInterval(() => {
      const left = Math.max(0, deadline - performance.now());
      setTimeLeftMs(left);
      if (left <= 0) {
        window.clearInterval(id);
        advance("miss", null);
      }
    }, 100);
    return () => window.clearInterval(id);
  }, [phase, duelIndex, duelState, duelTimeMs, advance]);

  useEffect(
    () => () => {
      if (advanceRef.current) window.clearTimeout(advanceRef.current);
    },
    [],
  );

  const displayResult = completedResult || {
    configId: config.id,
    picks: [],
    correct: correctCount,
    total,
    packs: rewardsForCorrect(correctCount, rewards).length,
    rewards: rewardsForCorrect(correctCount, rewards),
  };
  const earnedRewards = displayResult.rewards || [];
  const allRewards = rewardsForCorrect(total, rewards);
  const wonPacks = phase === "result" && earnedRewards.length > 0;
  const timeFrac = Math.max(0, Math.min(1, timeLeftMs / duelTimeMs));
  const secondsLeft = Math.ceil(timeLeftMs / 1000);
  const barColor =
    timeFrac > 0.5 ? "#a7f600" : timeFrac > 0.25 ? "#f7c93b" : "#ff5247";

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center overflow-y-auto bg-black/82 px-3 py-3 text-white backdrop-blur-sm sm:px-6 sm:py-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="quiendamas-title"
    >
      <div className="theme-dark relative grid max-h-[calc(100dvh-24px)] w-full max-w-xl overflow-y-auto overflow-x-hidden rounded-2xl border border-lime-300/25 bg-[#080808] text-white shadow-2xl shadow-black/70 motion-safe:animate-[adivina-pop_220ms_cubic-bezier(0.22,1,0.36,1)_both]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,rgba(167,246,0,0.17),transparent_32%,rgba(245,197,24,0.08)_70%,transparent)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-lime-200/80 to-transparent"
        />

        <aside
          className={`relative overflow-hidden border-b border-white/10 bg-[#0b1208] ${
            phase === "intro"
              ? "min-h-[205px] p-0 sm:min-h-[225px]"
              : "flex min-h-[78px] flex-col items-center justify-center px-3.5 py-3 text-center sm:min-h-[96px] sm:p-4"
          }`}
        >
          {phase === "intro" ? (
            <IntroCover
              title={config.title || "¿QUIÉN DA MÁS?"}
              duelCount={total}
              duelTimeMs={duelTimeMs}
            />
          ) : (
            <div className="relative z-10 w-full">
              <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-lime-200 sm:text-[10px] sm:tracking-[0.22em]">
                {phase === "playing" ? "Duelo de cifras" : "Subasta cerrada"}
              </p>
              <h2
                id="quiendamas-title"
                className="mt-0.5 text-lg font-bold uppercase leading-[0.92] text-white sm:mt-1 sm:text-2xl sm:leading-none"
              >
                {config.title || "¿QUIÉN DA MÁS?"}
              </h2>
              <div className="mt-1.5 flex items-center justify-center gap-3 sm:mt-2">
                <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-400 sm:text-[10px] sm:tracking-[0.2em]">
                  Duelo {Math.min(duelIndex + 1, total)} de {total}
                </p>
                <span className="h-3 w-px bg-white/15" />
                <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-lime-200 sm:text-[10px] sm:tracking-[0.2em]">
                  {correctCount} aciertos
                </p>
              </div>
            </div>
          )}
        </aside>

        <main className="relative z-10 flex min-h-[340px] flex-col p-4 sm:min-h-[400px] sm:p-5">
          {phase === "intro" ? (
            <IntroPanel
              onStart={start}
              duelCount={total}
              duelTimeMs={duelTimeMs}
              rewards={rewards}
            />
          ) : phase === "playing" && duel ? (
            <div className="flex h-full flex-col items-center">
              <div className="flex w-full items-center gap-3">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full transition-[width] duration-100 ease-linear"
                    style={{
                      width: `${timeFrac * 100}%`,
                      backgroundColor: barColor,
                    }}
                  />
                </div>
                <span
                  className="w-7 text-right font-[family-name:var(--font-display)] text-lg leading-none tabular-nums"
                  style={{ color: barColor }}
                >
                  {secondsLeft}
                </span>
              </div>

              <QuestionTitle key={`q-${duelIndex}`} question={duel.question} />

              <div
                key={`duel-${duelIndex}`}
                className={`relative mt-3 grid w-full grid-cols-2 gap-2.5 sm:gap-3 ${
                  duelState === "revealed" && currentOutcome === "miss"
                    ? "motion-safe:animate-[adivina-shake_320ms_ease-in-out_both]"
                    : "motion-safe:animate-[vs-card-in_360ms_cubic-bezier(0.22,1,0.36,1)_both]"
                }`}
              >
                <DuelCard
                  side={duel.a}
                  format={duel.format ?? "int"}
                  metricLabel={duel.metricLabel}
                  state={duelState}
                  isWinner={duel.a.value >= duel.b.value}
                  isPicked={picked === "a"}
                  onPick={() => submitPick("a")}
                />
                <DuelCard
                  side={duel.b}
                  format={duel.format ?? "int"}
                  metricLabel={duel.metricLabel}
                  state={duelState}
                  isWinner={duel.b.value >= duel.a.value}
                  isPicked={picked === "b"}
                  onPick={() => submitPick("b")}
                />
                <span className="pointer-events-none absolute left-1/2 top-[38%] z-20 grid h-9 w-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-lime-200/40 bg-black/80 font-[family-name:var(--font-display)] text-sm text-lime-200 shadow-[0_0_18px_rgba(167,246,0,0.3)] motion-safe:animate-[vs-pop_420ms_cubic-bezier(0.22,1,0.36,1)_both] sm:h-10 sm:w-10">
                  VS
                </span>
              </div>

              <div className="mt-2 h-5 text-center">
                {duelState === "revealed" ? (
                  <p
                    className={`text-[11px] font-bold uppercase tracking-[0.2em] motion-safe:animate-[vs-pop_320ms_ease-out_both] ${
                      currentOutcome === "hit"
                        ? "text-lime-200"
                        : "text-rose-300"
                    }`}
                  >
                    {currentOutcome === "hit"
                      ? "¡Acertaste!"
                      : picked === null
                        ? "¡Tiempo! Cuenta como fallo"
                        : "Fallaste. Sigue la puja"}
                  </p>
                ) : (
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-600">
                    Toca al que dé más
                  </p>
                )}
              </div>

              <div className="mt-auto flex w-full items-center gap-1.5 pt-3">
                {duels.map((_, index) => {
                  const outcome = outcomes[index];
                  const isCurrent = index === duelIndex;
                  return (
                    <span
                      key={`dot-${index}`}
                      className={`h-2 min-w-0 flex-1 rounded-full ${
                        outcome === "hit"
                          ? "bg-lime-300"
                          : outcome === "miss"
                            ? "bg-rose-400/80"
                            : isCurrent
                              ? "bg-white/70"
                              : "bg-white/15"
                      }`}
                    />
                  );
                })}
              </div>
            </div>
          ) : (
            <ResultPanel
              allowReplay={allowReplay}
              correctCount={displayResult.correct}
              rewards={allRewards}
              onClose={onClose}
              onOpenPacks={onOpenPacks ?? onClose}
              onReplay={onReplay ?? start}
              onRetrySubmit={() => void submitCompletion(displayResult)}
              submitError={submitError}
              submitState={submitState}
              total={total}
              wonPacks={wonPacks}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function IntroCover({
  title,
  duelCount,
  duelTimeMs,
}: {
  title: string;
  duelCount: number;
  duelTimeMs: number;
}) {
  return (
    <div className="relative flex min-h-[205px] items-center justify-center overflow-hidden bg-[#0b1208] px-5 text-center sm:min-h-[225px]">
      <div
        aria-hidden
        className="absolute inset-0 opacity-35 [background-image:linear-gradient(rgba(167,246,0,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(167,246,0,0.12)_1px,transparent_1px)] [background-size:24px_24px]"
      />
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(circle_at_50%_55%,rgba(167,246,0,0.28),transparent_34%),linear-gradient(180deg,rgba(0,0,0,0.1),rgba(2,7,2,0.94))]"
      />
      <span
        aria-hidden
        className="absolute -left-2 top-2 font-[family-name:var(--font-display)] text-[130px] leading-none text-lime-200/[0.055] sm:text-[152px]"
      >
        ?
      </span>
      <span
        aria-hidden
        className="absolute -right-3 bottom-[-26px] font-[family-name:var(--font-display)] text-[150px] leading-none text-lime-200/[0.055] sm:text-[176px]"
      >
        ?
      </span>

      <div className="relative z-10 flex flex-col items-center">
        <p className="text-[9px] font-bold uppercase tracking-[0.3em] text-lime-200/80 sm:text-[10px]">
          El duelo de las cifras
        </p>
        <h2
          id="quiendamas-title"
          className="mt-2 font-[family-name:var(--font-display)] text-[38px] font-bold uppercase leading-[0.78] tracking-tight text-white drop-shadow-[0_5px_0_rgba(0,0,0,0.42)] sm:text-[46px]"
        >
          {title}
        </h2>
        <div className="mt-4 flex items-center gap-2 rounded-full border border-lime-200/25 bg-black/40 px-3 py-1 text-[9px] font-bold uppercase tracking-[0.16em] text-lime-100 sm:text-[10px]">
          <span>{duelCount} duelos</span>
          <span className="h-3 w-px bg-lime-100/25" />
          <span>{Math.round(duelTimeMs / 1000)} segundos</span>
        </div>
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-[#080808] via-[#080808]/70 to-transparent"
      />
    </div>
  );
}

function QuestionTitle({ question }: { question: string }) {
  // Resalta "más" (la palabra clave del duelo) en lima.
  const parts = question.split(/(más)/i);
  return (
    <h3 className="mt-3 min-h-[40px] w-full text-balance text-center text-base font-bold leading-tight text-white motion-safe:animate-[vs-card-in_360ms_cubic-bezier(0.22,1,0.36,1)_both] sm:min-h-[44px] sm:text-lg">
      {parts.map((part, index) =>
        /^más$/i.test(part) ? (
          <span key={`part-${index}`} className="text-lime-300">
            {part}
          </span>
        ) : (
          <span key={`part-${index}`}>{part}</span>
        ),
      )}
    </h3>
  );
}

function DuelCard({
  side,
  format,
  metricLabel,
  state,
  isWinner,
  isPicked,
  onPick,
}: {
  side: QuienDaMasSide;
  format: QuienDaMasFormat;
  metricLabel: string;
  state: DuelState;
  isWinner: boolean;
  isPicked: boolean;
  onPick: () => void;
}) {
  const revealed = state === "revealed";
  const flag = codeToFlag(side.teamCode);
  const frame = revealed
    ? isWinner
      ? "border-lime-300/70 bg-[#0d1607] shadow-[0_0_24px_rgba(167,246,0,0.25)]"
      : "border-white/10 bg-[#101010] opacity-60 saturate-50"
    : "border-white/12 bg-[#101010] hover:border-lime-200/50 hover:bg-[#131a0d] active:scale-[0.985]";

  return (
    <button
      type="button"
      disabled={revealed}
      onClick={onPick}
      className={`relative flex flex-col overflow-hidden rounded-2xl border p-2.5 text-center transition duration-300 sm:p-3 ${frame}`}
    >
      {isPicked ? (
        <span
          className={`absolute left-2 top-2 z-20 rounded-full px-2 py-0.5 text-[8px] font-bold uppercase tracking-[0.14em] ${
            revealed && !isWinner
              ? "bg-rose-400/90 text-black"
              : "bg-lime-300 text-black"
          }`}
        >
          Tu voto
        </span>
      ) : null}

      <div className="relative mx-auto aspect-[5/4] w-full overflow-hidden rounded-xl bg-[radial-gradient(circle_at_50%_70%,rgba(167,246,0,0.14),transparent_65%)]">
        {side.image ? (
          <Image
            src={side.image}
            alt={side.name}
            fill
            sizes="220px"
            className="object-contain drop-shadow-[0_12px_16px_rgba(0,0,0,0.55)]"
          />
        ) : (
          <span className="absolute inset-0 grid place-items-center text-6xl drop-shadow-[0_10px_14px_rgba(0,0,0,0.5)] sm:text-7xl">
            {flag || "⚽"}
          </span>
        )}
      </div>

      <p className="mt-2 truncate text-sm font-bold uppercase leading-none text-white sm:text-base">
        {side.name}
      </p>
      {side.teamName ? (
        <p className="mt-1 truncate text-[9px] font-bold uppercase tracking-[0.16em] text-zinc-400">
          {flag} {side.teamName}
        </p>
      ) : null}

      <div className="mt-2 flex min-h-[44px] flex-col items-center justify-center rounded-lg bg-black/35 px-1 py-1.5 sm:min-h-[50px]">
        {revealed ? (
          <>
            <p
              className={`font-[family-name:var(--font-display)] text-xl leading-none tabular-nums sm:text-2xl ${
                isWinner ? "text-lime-200" : "text-zinc-400"
              }`}
            >
              <CountUpValue value={side.value} format={format} />
            </p>
            <p className="mt-0.5 text-[8px] font-bold uppercase tracking-[0.14em] text-zinc-500">
              {metricLabel}
            </p>
          </>
        ) : (
          <p className="font-[family-name:var(--font-display)] text-2xl leading-none text-zinc-600">
            ?
          </p>
        )}
      </div>
    </button>
  );
}

function IntroPanel({
  onStart,
  duelCount,
  duelTimeMs,
  rewards,
}: {
  onStart: () => void;
  duelCount: number;
  duelTimeMs: number;
  rewards: QuienDaMasReward[];
}) {
  return (
    <div className="relative z-10 px-4 pb-5 pt-5 sm:px-5">
      <span className="w-max rounded-full border border-lime-200/30 bg-lime-200/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-lime-200">
        Sin vidas · partida completa
      </span>
      <h3 className="mt-3 text-2xl font-bold leading-none tracking-tight text-white sm:text-3xl">
        Elige al que da más.
      </h3>
      <p className="mt-2 max-w-xl text-xs leading-5 text-zinc-300 sm:text-sm">
        Fútbol, datos imposibles y cifras ocultas. Tienes{" "}
        {Math.round(duelTimeMs / 1000)} segundos por duelo y juegas las{" "}
        {duelCount} preguntas completas.
      </p>
      {rewards.length ? (
        <>
          <div className="mt-5 flex items-center gap-3">
            <span className="h-px flex-1 bg-white/10" />
            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-lime-200">
              Sobres en juego
            </p>
            <span className="h-px flex-1 bg-white/10" />
          </div>
          <div className="mt-3 grid grid-cols-4 gap-2 text-center">
            {rewards.map((reward) => (
              <div
                key={`${reward.minScore}-${reward.title}`}
                className="rounded-lg border border-white/10 bg-black/22 px-1 py-2"
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
                <p className="mt-0.5 text-[8px] font-bold uppercase tracking-[0.14em] text-lime-200">
                  {reward.minScore}{" "}
                  {reward.minScore === 1 ? "acierto" : "aciertos"}
                </p>
              </div>
            ))}
          </div>
        </>
      ) : null}
      <div className="flex sm:justify-center">
        <button
          type="button"
          onClick={onStart}
          className="mt-5 w-full rounded-xl bg-lime-300 px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-black shadow-lg shadow-lime-300/20 transition hover:bg-lime-200 sm:w-max"
        >
          Empezar el duelo
        </button>
      </div>
    </div>
  );
}

function ResultPanel({
  allowReplay,
  correctCount,
  rewards,
  onClose,
  onOpenPacks,
  onReplay,
  onRetrySubmit,
  submitError,
  submitState,
  total,
  wonPacks,
}: {
  allowReplay: boolean;
  correctCount: number;
  rewards: QuienDaMasReward[];
  onClose: () => void;
  onOpenPacks: () => void;
  onReplay: () => void;
  onRetrySubmit: () => void;
  submitError: string;
  submitState: "idle" | "saving" | "saved" | "error";
  total: number;
  wonPacks: boolean;
}) {
  const saving = submitState === "saving";
  const error = submitState === "error";
  return (
    <div className="relative flex h-full flex-col items-center justify-center text-center">
      {wonPacks ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-40 overflow-hidden">
          <div className="absolute left-1/2 top-4 h-40 w-40 -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(167,246,0,0.38),transparent_68%)] motion-safe:animate-[ruleta-win-burst_750ms_ease-out_both]" />
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

      <p className="relative z-10 text-xs font-bold uppercase tracking-[0.24em] text-lime-200">
        Subasta cerrada
      </p>
      <p className="relative z-10 mt-2 text-5xl font-bold leading-none text-white">
        {correctCount}
        <span className="text-2xl text-zinc-500">/{total}</span>
      </p>
      <p className="relative z-10 mt-2 max-w-sm text-xs leading-5 text-zinc-300 sm:text-sm">
        {saving
          ? "Estamos preparando tus sobres en cofres."
          : wonPacks
            ? "Duelos ganados. Hay sobres preparados en cofres."
            : allowReplay
              ? "Esta vez las cifras no acompañaron, pero puedes pujar de nuevo."
              : "Esta vez las cifras no acompañaron. Guardamos este intento."}
      </p>
      {submitError ? (
        <p className="relative z-10 mt-2 max-w-sm text-xs font-semibold text-rose-200">
          {submitError}. Pulsa de nuevo para reintentarlo.
        </p>
      ) : null}

      {rewards.length ? (
        <div className="relative z-10 mt-4 grid w-full max-w-sm grid-cols-4 gap-2">
          {rewards.map((reward) => {
            const earned = correctCount >= reward.minScore;
            return (
              <div
                key={`${reward.minScore}-${reward.title}`}
                className={`rounded-xl border p-2 transition ${
                  earned
                    ? "border-lime-200/30 bg-white/[0.045]"
                    : "border-white/8 bg-white/[0.015]"
                }`}
              >
                <div
                  className={`relative mx-auto aspect-[818/1206] w-11 ${
                    earned
                      ? "drop-shadow-[0_8px_18px_rgba(0,0,0,0.55)]"
                      : "opacity-35 grayscale"
                  }`}
                >
                  <Image
                    src={reward.image}
                    alt={reward.title}
                    fill
                    sizes="72px"
                    className="object-contain"
                  />
                </div>
                <p
                  className={`mt-1 text-[10px] font-bold uppercase leading-tight ${
                    earned ? "text-white" : "text-zinc-500"
                  }`}
                >
                  {reward.title.replace(/^Sobre\s+/i, "")}
                </p>
                <p
                  className={`mt-0.5 text-[8px] font-bold uppercase tracking-[0.14em] ${
                    earned ? "text-lime-200" : "text-zinc-600"
                  }`}
                >
                  {earned
                    ? "Ganado"
                    : `${reward.minScore} ${
                        reward.minScore === 1 ? "acierto" : "aciertos"
                      }`}
                </p>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="relative z-10 mt-5 flex w-full flex-wrap justify-center gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={error ? onRetrySubmit : wonPacks ? onOpenPacks : onClose}
          className="rounded-xl bg-lime-300 px-5 py-3 text-sm font-bold uppercase tracking-[0.1em] text-black shadow-lg shadow-lime-300/18 transition hover:bg-lime-200 disabled:cursor-wait disabled:opacity-70"
        >
          {saving
            ? "Preparando..."
            : error
              ? "Reintentar"
              : wonPacks
                ? "Abrir en cofres"
                : "Cerrar"}
        </button>
        {allowReplay ? (
          <button
            type="button"
            disabled={saving}
            onClick={onReplay}
            className="rounded-xl border border-white/10 px-5 py-3 text-sm font-bold uppercase tracking-[0.1em] text-white transition hover:bg-white/10 disabled:cursor-wait disabled:opacity-70"
          >
            Jugar otra vez
          </button>
        ) : null}
      </div>
    </div>
  );
}
