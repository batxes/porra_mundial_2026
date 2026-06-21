"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import { data, playersById, teamsById } from "@/lib/data";
import type { Player } from "@/lib/types";

export type AdivinaRound = {
  image: string;
  answerId: string;
  answerLabel?: string;
};

export type AdivinaReward = {
  image: string;
  minScore: number;
  pool?: string;
  title: string;
};

export type AdivinaConfig = {
  id: string;
  rewards?: AdivinaReward[];
  title: string;
  roundTimeMs: number;
  rounds: AdivinaRound[];
};

export type AdivinaResult = {
  answers: Array<string | null>;
  awardedDropIds?: string[];
  configId: string;
  total: number;
  correct: number;
  packs: number;
  rewards?: AdivinaReward[];
};

export const adivinaCompletedEventName = "triliporra:adivina-completed";

const PACK_LADDER: Record<number, number> = { 1: 1, 2: 2, 3: 2, 4: 3 };
const DEFAULT_REWARD: AdivinaReward = {
  image: "/sobre.webp",
  minScore: 1,
  title: "Sobre",
};
const MAX_SUGGESTIONS = 4;
const ADIVINA_IMAGE_VERSION = "20260621-2";

function packsForCorrect(correct: number) {
  if (correct in PACK_LADDER) return PACK_LADDER[correct];
  return correct >= 4 ? 3 : 0;
}

function rewardsForCorrect(correct: number, rewards: AdivinaReward[]) {
  if (rewards.length) {
    return rewards.filter((reward) => correct >= reward.minScore);
  }
  return Array.from({ length: packsForCorrect(correct) }, (_, index) => ({
    ...DEFAULT_REWARD,
    minScore: index + 1,
  }));
}

const DIACRITICS = new RegExp("[\\u0300-\\u036f]", "g");
function normalize(value: string) {
  return value.normalize("NFD").replace(DIACRITICS, "").toLowerCase().trim();
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

function adivinaImageSrc(src: string) {
  const separator = src.includes("?") ? "&" : "?";
  return `${src}${separator}v=${ADIVINA_IMAGE_VERSION}`;
}

const POSITION_LABEL: Record<string, string> = {
  POR: "POR",
  DEF: "DEF",
  MED: "MED",
  DEL: "DEL",
};

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

const ENCOUNTER_SPARKS = [
  { delay: "0ms", left: "18%", top: "28%" },
  { delay: "260ms", left: "76%", top: "30%" },
  { delay: "520ms", left: "63%", top: "18%" },
  { delay: "780ms", left: "29%", top: "45%" },
  { delay: "1040ms", left: "84%", top: "50%" },
  { delay: "1300ms", left: "43%", top: "21%" },
];

// Centradas en el recuadro (independiente de donde este la criatura).
const HIT_SPARKS = [
  { delay: "0ms", left: "32%", top: "32%" },
  { delay: "55ms", left: "68%", top: "32%" },
  { delay: "95ms", left: "76%", top: "52%" },
  { delay: "135ms", left: "54%", top: "66%" },
  { delay: "175ms", left: "24%", top: "52%" },
  { delay: "215ms", left: "46%", top: "44%" },
];

type Phase = "intro" | "playing" | "result";
type RoundState = "guessing" | "revealed";
type Outcome = "hit" | "miss";

export function AdivinaModal({
  allowReplay = true,
  config,
  onClose,
  onCompleted,
  onOpenPacks,
}: {
  allowReplay?: boolean;
  config: AdivinaConfig;
  onClose: () => void;
  onCompleted?: (
    result: AdivinaResult,
  ) => Promise<Partial<AdivinaResult> | void> | Partial<AdivinaResult> | void;
  onOpenPacks?: () => void;
}) {
  const rounds = config.rounds;
  const rewards = useMemo(() => config.rewards || [], [config.rewards]);
  const total = rounds.length;
  const roundTimeMs = config.roundTimeMs;

  const [phase, setPhase] = useState<Phase>("intro");
  const [roundIndex, setRoundIndex] = useState(0);
  const [roundState, setRoundState] = useState<RoundState>("guessing");
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [timeLeftMs, setTimeLeftMs] = useState(roundTimeMs);
  const [submitState, setSubmitState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [submitError, setSubmitError] = useState("");
  const [completedResult, setCompletedResult] = useState<AdivinaResult | null>(
    null,
  );

  const inputRef = useRef<HTMLInputElement | null>(null);
  const outcomesRef = useRef<Outcome[]>([]);
  const answersRef = useRef<Array<string | null>>([]);
  const advanceRef = useRef<number | null>(null);

  const round = rounds[roundIndex];
  const answer = round ? (playersById.get(round.answerId) ?? null) : null;
  const answerTeam = answer ? (teamsById.get(answer.team) ?? null) : null;
  const answerLabel = round?.answerLabel ?? answer?.name ?? "";
  const currentOutcome = outcomes[roundIndex];

  const correctCount = useMemo(
    () => outcomes.filter((outcome) => outcome === "hit").length,
    [outcomes],
  );

  const suggestions = useMemo(() => {
    const q = normalize(query);
    if (q.length < 2) return [] as Player[];
    const matches = data.players.filter((player) =>
      normalize(player.name).includes(q),
    );
    matches.sort((a, b) => {
      const aName = normalize(a.name);
      const bName = normalize(b.name);
      const aStarts = aName.startsWith(q) ? 0 : 1;
      const bStarts = bName.startsWith(q) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;
      return a.name.localeCompare(b.name);
    });
    return matches.slice(0, MAX_SUGGESTIONS);
  }, [query]);

  const submitCompletion = useCallback(
    async (result: AdivinaResult) => {
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
      const result: AdivinaResult = {
        answers: answersRef.current.slice(0, total),
        configId: config.id,
        correct,
        packs: earnedRewards.length,
        rewards: earnedRewards,
        total,
      };
      setCompletedResult(result);
      setPhase("result");
      void submitCompletion(result);
    },
    [config.id, rewards, submitCompletion, total],
  );

  const advance = useCallback(
    (outcome: Outcome, answerId: string | null = null) => {
      setRoundState("revealed");
      const next = [...outcomesRef.current];
      next[roundIndex] = outcome;
      outcomesRef.current = next;
      const nextAnswers = [...answersRef.current];
      nextAnswers[roundIndex] = answerId;
      answersRef.current = nextAnswers;
      setOutcomes(next);

      const isLast = roundIndex + 1 >= total;
      if (advanceRef.current) window.clearTimeout(advanceRef.current);
      advanceRef.current = window.setTimeout(
        () => {
          if (isLast) {
            finish(next);
          } else {
            setRoundIndex((index) => index + 1);
            setRoundState("guessing");
            setQuery("");
            setHighlight(0);
            setTimeLeftMs(roundTimeMs);
          }
        },
        outcome === "hit" ? 950 : 1500,
      );
    },
    [roundIndex, roundTimeMs, total, finish],
  );

  const submitGuess = useCallback(
    (player: Player) => {
      if (roundState !== "guessing" || !round) return;
      advance(player.id === round.answerId ? "hit" : "miss", player.id);
    },
    [roundState, round, advance],
  );

  const start = useCallback(() => {
    outcomesRef.current = [];
    answersRef.current = [];
    setOutcomes([]);
    setCompletedResult(null);
    setRoundIndex(0);
    setRoundState("guessing");
    setQuery("");
    setHighlight(0);
    setTimeLeftMs(roundTimeMs);
    setSubmitState("idle");
    setSubmitError("");
    setPhase("playing");
  }, [roundTimeMs]);

  useEffect(() => {
    if (phase !== "playing" || roundState !== "guessing") return;
    const deadline = performance.now() + roundTimeMs;
    const id = window.setInterval(() => {
      const left = Math.max(0, deadline - performance.now());
      setTimeLeftMs(left);
      if (left <= 0) {
        window.clearInterval(id);
        advance("miss");
      }
    }, 100);
    return () => window.clearInterval(id);
  }, [phase, roundIndex, roundState, roundTimeMs, advance]);

  useEffect(() => {
    if (phase === "playing" && roundState === "guessing") {
      const id = window.setTimeout(() => inputRef.current?.focus(), 60);
      return () => window.clearTimeout(id);
    }
  }, [phase, roundIndex, roundState]);

  useEffect(
    () => () => {
      if (advanceRef.current) window.clearTimeout(advanceRef.current);
    },
    [],
  );

  const onInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((index) =>
        Math.min(index + 1, Math.max(0, suggestions.length - 1)),
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const pick = suggestions[highlight] ?? suggestions[0];
      if (pick) submitGuess(pick);
    } else if (event.key === "Escape") {
      setQuery("");
    }
  };

  const displayResult = completedResult || {
    answers: [],
    configId: config.id,
    correct: correctCount,
    packs: rewardsForCorrect(correctCount, rewards).length,
    rewards: rewardsForCorrect(correctCount, rewards),
    total,
  };
  const earnedRewards = displayResult.rewards || [];
  // Todas las recompensas posibles (para pintar tambien las no ganadas, apagadas).
  const allRewards = rewardsForCorrect(total, rewards);
  const wonPacks = phase === "result" && earnedRewards.length > 0;
  const timeFrac = Math.max(0, Math.min(1, timeLeftMs / roundTimeMs));
  const secondsLeft = Math.ceil(timeLeftMs / 1000);
  const barColor =
    timeFrac > 0.5 ? "#a7f600" : timeFrac > 0.25 ? "#f7c93b" : "#ff5247";
  const showHint = roundState === "guessing" && timeLeftMs <= 5000;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center overflow-y-auto bg-black/82 px-3 py-3 text-white backdrop-blur-sm sm:px-6 sm:py-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="adivina-title"
    >
      <div className="theme-dark relative grid max-h-[calc(100vh-24px)] w-full max-w-xl overflow-hidden rounded-2xl border border-lime-300/25 bg-[#080808] text-white shadow-2xl shadow-black/70 motion-safe:animate-[adivina-pop_220ms_cubic-bezier(0.22,1,0.36,1)_both]">
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
              ? "flex min-h-[225px] items-center justify-center p-0 sm:min-h-[250px]"
              : "flex min-h-[82px] flex-col items-center justify-center px-3.5 py-3 text-center sm:min-h-[108px] sm:p-4"
          }`}
        >
          {phase === "intro" ? (
            <>
              <h2 id="adivina-title" className="sr-only">
                {config.title || "ADIVINA EL CRACK"}
              </h2>
              <Image
                src={adivinaImageSrc("/oak.webp")}
                alt="Oak"
                width={720}
                height={520}
                priority
                className="relative z-10 h-auto w-[360px] max-w-[92%] object-contain drop-shadow-[0_18px_28px_rgba(0,0,0,0.65)] sm:w-[410px]"
              />
            </>
          ) : (
            <div className="relative z-10">
              <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-lime-200 sm:text-[10px] sm:tracking-[0.22em]">
                {phase === "playing" ? "Encuentro salvaje" : "Rastreo cerrado"}
              </p>
              <h2
                id="adivina-title"
                className="mt-0.5 text-lg font-bold uppercase leading-[0.92] text-white sm:mt-1 sm:text-2xl sm:leading-none"
              >
                {config.title || "ADIVINA EL CRACK"}
              </h2>
              <p className="mt-1.5 text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-400 sm:mt-2 sm:text-[10px] sm:tracking-[0.2em]">
                Avistamiento {Math.min(roundIndex + 1, total)} de {total}
              </p>
            </div>
          )}
        </aside>

        <main className="relative z-10 flex min-h-[315px] flex-col p-4 sm:min-h-[380px] sm:p-5">
          {phase === "intro" ? (
            <IntroPanel
              onStart={start}
              questionCount={total}
              roundTimeMs={roundTimeMs}
              rewards={rewards}
            />
          ) : phase === "playing" && round ? (
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

              <div
                className={`relative mt-3 aspect-[16/10] w-full max-w-[460px] overflow-hidden rounded-[28px] border border-lime-200/20 bg-[#10230b] shadow-[0_22px_44px_rgba(0,0,0,0.5)] ${
                  roundState === "revealed" && currentOutcome === "miss"
                    ? "motion-safe:animate-[adivina-shake_320ms_ease-in-out_both]"
                    : ""
                }`}
              >
                <Image
                  src={adivinaImageSrc("/oak-bg.webp")}
                  alt=""
                  fill
                  priority
                  sizes="460px"
                  className="object-cover"
                />
                <div
                  aria-hidden
                  className="absolute inset-0 bg-[radial-gradient(circle_at_50%_62%,rgba(255,255,255,0.22),transparent_23%),linear-gradient(180deg,rgba(0,0,0,0.03),rgba(0,0,0,0.26))]"
                />
                {ENCOUNTER_SPARKS.map((spark, index) => (
                  <span
                    key={`spark-${index}`}
                    aria-hidden
                    className="absolute z-10 h-1.5 w-1.5 rounded-[1px] bg-lime-100 shadow-[0_0_12px_rgba(217,255,132,0.9)] motion-safe:animate-[adivina-spark-pop_1600ms_ease-in-out_infinite]"
                    style={{
                      animationDelay: spark.delay,
                      left: spark.left,
                      top: spark.top,
                    }}
                  />
                ))}
                <div
                  aria-hidden
                  className="absolute bottom-[13%] left-[86%] z-10 h-11 w-[45%] -translate-x-1/2 rounded-full bg-black/50 blur-md"
                />
                <div
                  aria-hidden
                  className="absolute bottom-[17%] left-[86%] z-10 h-[58%] w-[66%] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.34),rgba(167,246,0,0.16)_36%,transparent_70%)]"
                />
                <div className="absolute bottom-[7%] left-[86%] z-20 h-[82%] w-[82%] -translate-x-1/2 motion-safe:animate-[adivina-wild-bob_1800ms_ease-in-out_infinite]">
                  <Image
                    src={adivinaImageSrc(round.image)}
                    alt="Criatura por identificar"
                    fill
                    priority
                    sizes="380px"
                    className="scale-[1.08] object-contain drop-shadow-[0_20px_24px_rgba(0,0,0,0.6)] sm:scale-[1.12]"
                  />
                </div>

                {roundState === "revealed" && currentOutcome === "hit" ? (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-0 z-30 grid place-items-center"
                  >
                    <div className="col-start-1 row-start-1 aspect-square w-[64%] rounded-full bg-[radial-gradient(circle,rgba(217,255,82,0.48),rgba(167,246,0,0.18)_32%,transparent_68%)] mix-blend-screen motion-safe:animate-[adivina-hit-burst_760ms_ease-out_both]" />
                    <div className="col-start-1 row-start-1 aspect-square w-[44%] rounded-full border-2 border-lime-200/80 shadow-[0_0_26px_rgba(190,255,59,0.65)] motion-safe:animate-[adivina-hit-ring_720ms_ease-out_both]" />
                    {HIT_SPARKS.map((spark, index) => (
                      <span
                        key={`hit-spark-${index}`}
                        className="absolute z-10 h-2.5 w-2.5 rounded-[2px] bg-lime-200 shadow-[0_0_14px_rgba(217,255,82,0.95)] motion-safe:animate-[adivina-hit-spark_760ms_ease-out_both]"
                        style={{
                          animationDelay: spark.delay,
                          left: spark.left,
                          top: spark.top,
                        }}
                      />
                    ))}
                  </div>
                ) : null}

                {roundState === "guessing" ? (
                  <p className="absolute left-3 top-3 z-20 rounded-full border border-white/20 bg-black/45 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.18em] text-white backdrop-blur-sm">
                    Crack salvaje
                  </p>
                ) : null}

                {roundState === "revealed" ? (
                  <div className="absolute inset-x-0 bottom-0 z-20 flex flex-col items-center bg-gradient-to-t from-black/92 via-black/45 to-transparent px-3 pb-4 pt-16 text-center">
                    <p
                      className={`text-xs font-black uppercase tracking-[0.2em] ${
                        currentOutcome === "hit"
                          ? "text-lime-200"
                          : "text-rose-200"
                      }`}
                    >
                      {currentOutcome === "hit" ? "Identificado" : "Se escapo"}
                    </p>
                    <p className="mt-1 text-3xl font-black uppercase leading-none text-white">
                      {answerLabel}
                    </p>
                    {answerTeam ? (
                      <p className="mt-1 text-xs font-bold uppercase tracking-[0.18em] text-zinc-300">
                        {codeToFlag(answerTeam.code)} {answerTeam.name}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="mt-1 h-5">
                {showHint && answerTeam ? (
                  <p className="text-[11px] font-semibold text-zinc-400">
                    Pista: {codeToFlag(answerTeam.code)} {answerTeam.name}
                  </p>
                ) : null}
              </div>

              <div className="relative mt-4 w-full max-w-[360px]">
                {roundState === "guessing" && suggestions.length ? (
                  <ul className="absolute inset-x-0 bottom-[calc(100%+10px)] z-30 overflow-hidden rounded-2xl border border-lime-200/15 bg-[#070807]/95 py-1 shadow-2xl shadow-black/70 backdrop-blur-md">
                    {suggestions.map((player, index) => {
                      const team = teamsById.get(player.team);
                      const active = index === highlight;
                      return (
                        <li key={player.id}>
                          <button
                            type="button"
                            onMouseEnter={() => setHighlight(index)}
                            onClick={() => submitGuess(player)}
                            className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition ${
                              active
                                ? "bg-lime-300/15 text-white"
                                : "text-zinc-200 hover:bg-white/[0.05]"
                            }`}
                          >
                            <span className="w-5 shrink-0 text-base leading-none">
                              {codeToFlag(team?.code)}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-sm font-bold">
                              {player.name}
                            </span>
                            <span
                              className={`text-[9px] font-black uppercase tracking-[0.16em] ${
                                active ? "text-lime-200" : "text-zinc-500"
                              }`}
                            >
                              {POSITION_LABEL[player.position] ??
                                player.position}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}

                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  disabled={roundState !== "guessing"}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setHighlight(0);
                  }}
                  onKeyDown={onInputKeyDown}
                  placeholder="Escribe el nombre del jugador"
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full border-0 border-b border-white/18 bg-transparent px-0 pb-2 pt-1 text-center text-lg font-bold text-white outline-none transition placeholder:text-base placeholder:font-semibold placeholder:text-zinc-600 focus:border-lime-300 disabled:opacity-60"
                />
                <p className="mt-2 h-4 text-center text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-600">
                  {query.length >= 2 && !suggestions.length
                    ? "Sin coincidencias"
                    : "Busca y pulsa la respuesta"}
                </p>
              </div>

              <div className="mt-auto flex items-center gap-2 pt-3">
                {rounds.map((_, index) => {
                  const outcome = outcomes[index];
                  const isCurrent = index === roundIndex;
                  return (
                    <span
                      key={`dot-${index}`}
                      className={`h-2 w-7 rounded-full ${
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
              onReplay={start}
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

function IntroPanel({
  onStart,
  questionCount,
  roundTimeMs,
  rewards,
}: {
  onStart: () => void;
  questionCount: number;
  roundTimeMs: number;
  rewards: AdivinaReward[];
}) {
  return (
    <div className="flex h-full flex-col justify-center">
      <span className="w-max rounded-full border border-lime-200/30 bg-lime-200/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-lime-200">
        Pokedex futbolera
      </span>
      <h3 className="mt-3 text-2xl font-bold leading-none tracking-tight text-white sm:text-3xl">
        Identifica {questionCount} criaturas antes de que Oak pierda la pista.
      </h3>
      <p className="mt-2 max-w-xl text-xs leading-5 text-zinc-300 sm:text-sm">
        Cada imagen esconde un crack del Mundial. Tienes{" "}
        {Math.round(roundTimeMs / 1000)} segundos por avistamiento y los sobres
        suben con tus aciertos.
      </p>
      {rewards.length ? (
        <div className="mt-5 grid grid-cols-3 gap-2 text-center">
          {rewards.map((reward) => (
            <div
              key={`${reward.minScore}-${reward.title}`}
              className="rounded-lg border border-white/10 bg-black/22 px-2 py-2"
            >
              <div className="relative mx-auto aspect-[818/1206] w-7">
                <Image
                  src={reward.image}
                  alt=""
                  fill
                  sizes="48px"
                  className="object-contain"
                />
              </div>
              <p className="mt-1 text-[9px] font-black uppercase leading-tight text-white">
                {reward.title.replace(/^Sobre\s+/i, "")}
              </p>
              <p className="mt-0.5 text-[8px] font-bold uppercase tracking-[0.14em] text-lime-200">
                {reward.minScore}{" "}
                {reward.minScore === 1 ? "acierto" : "aciertos"}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-xl font-black text-white">{questionCount}</p>
            <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-500">
              criaturas
            </p>
          </div>
          <div>
            <p className="text-xl font-black text-white">
              {Math.round(roundTimeMs / 1000)}s
            </p>
            <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-500">
              por ronda
            </p>
          </div>
          <div>
            <p className="text-xl font-black text-lime-200">3</p>
            <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-500">
              sobres max
            </p>
          </div>
        </div>
      )}
      <div className="flex sm:justify-center">
        <button
          type="button"
          onClick={onStart}
          className="mt-5 w-full rounded-xl bg-lime-300 px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-black shadow-lg shadow-lime-300/20 transition hover:bg-lime-200 sm:w-max"
        >
          Empezar rastreo
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
  rewards: AdivinaReward[];
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
        Informe cerrado
      </p>
      <p className="relative z-10 mt-2 text-5xl font-black leading-none text-white">
        {correctCount}
        <span className="text-2xl text-zinc-500">/{total}</span>
      </p>
      <p className="relative z-10 mt-2 max-w-sm text-xs leading-5 text-zinc-300 sm:text-sm">
        {saving
          ? "Oak esta preparando los sobres en cofres."
          : wonPacks
            ? "Identificaciones completadas. Hay sobres preparados en cofres."
            : allowReplay
              ? "No se han catalogado a tiempo, pero el rastreo puede repetirse."
              : "No se han catalogado a tiempo. Oak guarda este intento."}
      </p>
      {submitError ? (
        <p className="relative z-10 mt-2 max-w-sm text-xs font-semibold text-rose-200">
          {submitError}. Pulsa de nuevo para reintentarlo.
        </p>
      ) : null}

      {rewards.length ? (
        <div className="relative z-10 mt-4 grid w-full max-w-sm grid-cols-3 gap-2">
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
                  className={`mt-1 text-[10px] font-black uppercase leading-tight ${
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
            Reintentar
          </button>
        ) : null}
      </div>
    </div>
  );
}
