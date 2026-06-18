"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase";

type QuizPhase = "intro" | "question" | "result";
type SubmitState = "idle" | "saving" | "saved" | "error";

type QuizQuestion = {
  question: string;
  options: string[];
  correctIndex: number;
};

type QuizAnswer = {
  correct: boolean;
  selectedIndex: number | null;
};

type RewardPack = {
  image: string;
  minScore: number;
  title: string;
};

export type SoberaQuizCompletion = {
  awardedDropIds: string[];
  score: number;
};

type QuizRpcClient = {
  rpc: (
    fn: string,
    params?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

export const soberaQuizCompletedEventName = "triliporra:sobera-quiz-completed";

const QUESTION_TIME_MS = 10000;

const QUESTIONS: QuizQuestion[] = [
  {
    question: "¿Quién fue el máximo goleador del Mundial de Francia 98?",
    options: ["Ronaldo", "Davor Šuker", "Christian Vieri", "Batistuta"],
    correctIndex: 1,
  },
  {
    question: "¿En qué año debutó Morata con la selección española?",
    options: ["2012", "2013", "2014", "2015"],
    correctIndex: 2,
  },
  {
    question: "¿Cuántos equipos ha descendido Lotina?",
    options: ["3", "4", "5", "6"],
    correctIndex: 2,
  },
  {
    question: "¿Qué selección ganó el Mundial 2022?",
    options: ["Francia", "Argentina", "Croacia", "Brasil"],
    correctIndex: 1,
  },
];

const REWARD_PACKS: RewardPack[] = [
  {
    minScore: 1,
    title: "Sobre Defensas",
    image: "/sobre-defensas.webp",
  },
  {
    minScore: 2,
    title: "Sobre Mediocentros",
    image: "/sobre-medios.webp",
  },
  {
    minScore: 4,
    title: "Sobre Delanteros",
    image: "/sobre-delanteros.webp",
  },
];

function rewardsForScore(score: number) {
  return REWARD_PACKS.filter((reward) => score >= reward.minScore);
}

function answerLabel(index: number) {
  return ["A", "B", "C", "D"][index] || String(index + 1);
}

export function SoberaQuizModal({
  onClose,
  onCompleted,
  onOpenPacks,
}: {
  onClose: () => void;
  onCompleted?: (result: SoberaQuizCompletion) => void;
  onOpenPacks?: () => void;
}) {
  const [phase, setPhase] = useState<QuizPhase>("intro");
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<QuizAnswer[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [locked, setLocked] = useState(false);
  const [timeLeftMs, setTimeLeftMs] = useState(QUESTION_TIME_MS);
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [submitError, setSubmitError] = useState("");
  const [serverResult, setServerResult] =
    useState<SoberaQuizCompletion | null>(null);
  const nextTimerRef = useRef<number | null>(null);
  const submitStartedRef = useRef(false);

  const question = QUESTIONS[questionIndex];
  const localScore = useMemo(
    () => answers.filter((answer) => answer.correct).length,
    [answers],
  );
  const displayScore = serverResult?.score ?? localScore;
  const earnedRewards = rewardsForScore(displayScore);
  const progress = Math.max(0, Math.min(1, timeLeftMs / QUESTION_TIME_MS));
  const heroCompact = phase !== "intro";
  const soberaImage =
    phase === "result"
      ? displayScore <= 0
        ? "/sobera-triste.webp"
        : "/sobera-final.webp"
      : phase === "question" && questionIndex % 2 === 1
        ? "/sobera2.webp"
        : "/sobera.webp";

  const clearNextTimer = useCallback(() => {
    if (nextTimerRef.current !== null) {
      window.clearTimeout(nextTimerRef.current);
      nextTimerRef.current = null;
    }
  }, []);

  const resetQuestionState = useCallback(() => {
    setSelectedIndex(null);
    setLocked(false);
    setTimeLeftMs(QUESTION_TIME_MS);
  }, []);

  const startQuiz = () => {
    clearNextTimer();
    setAnswers([]);
    setQuestionIndex(0);
    setServerResult(null);
    setSubmitError("");
    setSubmitState("idle");
    submitStartedRef.current = false;
    resetQuestionState();
    setPhase("question");
  };

  const submitQuizResult = useCallback(async () => {
    if (phase !== "result") return;
    setSubmitState("saving");
    setSubmitError("");
    try {
      const supabase = getSupabaseBrowserClient() as unknown as
        | QuizRpcClient
        | null;
      if (!supabase) throw new Error("No se ha podido conectar con Supabase.");
      const payload = answers.map((answer) => answer.selectedIndex);
      const { data, error } = await supabase.rpc("complete_sobera_quiz", {
        p_answers: payload,
      });
      if (error) throw new Error(error.message);
      const row = Array.isArray(data) ? data[0] : data;
      const result: SoberaQuizCompletion = {
        score: Number((row as { score?: unknown } | null)?.score ?? localScore),
        awardedDropIds: Array.isArray(
          (row as { awarded_drop_ids?: unknown } | null)?.awarded_drop_ids,
        )
          ? ((row as { awarded_drop_ids: string[] }).awarded_drop_ids || [])
          : [],
      };
      setServerResult(result);
      setSubmitState("saved");
      onCompleted?.(result);
    } catch (error) {
      const msg =
        error instanceof Error
          ? error.message
          : "No se han podido preparar tus sobres.";
      setSubmitError(msg);
      setSubmitState("error");
      submitStartedRef.current = false;
    }
  }, [answers, localScore, onCompleted, phase]);

  const lockAnswer = useCallback(
    (choiceIndex: number | null) => {
      if (locked || phase !== "question") return;
      const correct = choiceIndex === question.correctIndex;
      const nextQuestionIndex = questionIndex + 1;

      clearNextTimer();
      setSelectedIndex(choiceIndex);
      setLocked(true);
      setAnswers((current) => [
        ...current,
        { selectedIndex: choiceIndex, correct },
      ]);

      nextTimerRef.current = window.setTimeout(() => {
        if (nextQuestionIndex >= QUESTIONS.length) {
          setPhase("result");
          return;
        }
        setQuestionIndex(nextQuestionIndex);
        resetQuestionState();
      }, 950);
    },
    [
      clearNextTimer,
      locked,
      phase,
      question.correctIndex,
      questionIndex,
      resetQuestionState,
    ],
  );

  useEffect(() => {
    if (phase !== "question" || locked) return;
    const startedAt = performance.now();
    const timer = window.setInterval(() => {
      const elapsed = performance.now() - startedAt;
      const next = Math.max(0, QUESTION_TIME_MS - elapsed);
      setTimeLeftMs(next);
      if (next <= 0) lockAnswer(null);
    }, 100);

    return () => window.clearInterval(timer);
  }, [lockAnswer, locked, phase, questionIndex]);

  useEffect(() => clearNextTimer, [clearNextTimer]);

  useEffect(() => {
    if (phase !== "result" || submitStartedRef.current) return;
    submitStartedRef.current = true;
    void submitQuizResult();
  }, [phase, submitQuizResult]);

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center overflow-y-auto bg-black/82 px-3 py-3 text-white backdrop-blur-sm sm:px-6 sm:py-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sobera-quiz-title"
    >
      <div className="relative grid w-full max-w-xl overflow-hidden rounded-2xl border border-amber-300/25 bg-[#080808] shadow-2xl shadow-black/70">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,rgba(245,197,24,0.18),transparent_34%,rgba(167,246,0,0.08)_68%,transparent)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-200/80 to-transparent"
        />

        <aside
          className={`relative flex flex-col justify-between overflow-hidden border-b border-white/10 bg-[#10100b] p-3.5 sm:p-4 ${
            heroCompact
              ? "min-h-[200px] sm:min-h-[225px]"
              : "min-h-[225px] sm:min-h-[260px]"
          }`}
        >
          <div className="relative z-10 flex items-center gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-amber-200">
                EVENTO ESPECIAL
              </p>
              <h2
                id="sobera-quiz-title"
                className="mt-1 text-xl font-bold uppercase leading-none text-white sm:text-2xl"
              >
                SOBRE EXTRA
              </h2>
            </div>
          </div>

          <div
            className={`relative z-10 mx-auto mt-2 flex w-full flex-1 items-end justify-center ${
              heroCompact
                ? "max-w-[280px] sm:max-w-[330px]"
                : "max-w-[230px] sm:max-w-[270px]"
            }`}
          >
            <div
              aria-hidden
              className="absolute bottom-1 h-[72%] w-[86%] rounded-t-full bg-[radial-gradient(ellipse_at_center,rgba(245,197,24,0.28),rgba(245,197,24,0.08)_42%,transparent_70%)]"
            />
            <Image
              src={soberaImage}
              alt="Sobera"
              width={560}
              height={760}
              priority
              className={`relative z-10 h-auto w-full object-contain drop-shadow-[0_18px_28px_rgba(0,0,0,0.65)] ${
                heroCompact
                  ? "max-h-[165px] sm:max-h-[195px]"
                  : "max-h-[155px] sm:max-h-[185px]"
              }`}
            />
          </div>

          {phase === "intro" ? (
            <div className="relative z-10 grid grid-cols-3 gap-1.5">
              {REWARD_PACKS.map((reward) => (
                <div
                  key={reward.title}
                  className="rounded-lg border border-white/10 bg-black/22 px-2 py-1 text-center"
                >
                  <div className="relative mx-auto aspect-[818/1206] w-5 sm:w-6">
                    <Image
                      src={reward.image}
                      alt=""
                      fill
                      sizes="40px"
                      className="object-contain"
                    />
                  </div>
                  <p className="mt-0.5 text-[8px] font-bold uppercase leading-tight text-zinc-200">
                    {reward.minScore}
                    {reward.minScore === 1 ? " acierto" : " aciertos"}
                  </p>
                </div>
              ))}
            </div>
          ) : null}
        </aside>

        <main className="relative z-10 flex min-h-[270px] flex-col p-3.5 sm:p-4">
          {phase === "intro" ? (
            <IntroPanel onStart={startQuiz} />
          ) : phase === "question" ? (
            <QuestionPanel
              locked={locked}
              onAnswer={lockAnswer}
              progress={progress}
              question={question}
              questionIndex={questionIndex}
              selectedIndex={selectedIndex}
              timeLeftMs={timeLeftMs}
            />
          ) : (
            <ResultPanel
              earnedRewards={earnedRewards}
              onClose={onClose}
              onOpenPacks={onOpenPacks || onClose}
              onRetry={submitQuizResult}
              score={displayScore}
              submitError={submitError}
              submitState={submitState}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function IntroPanel({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex h-full flex-col justify-center">
      <span className="w-max rounded-full border border-amber-200/30 bg-amber-200/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-amber-200">
        Ronda relámpago
      </span>
      <h3 className="mt-3 text-2xl font-bold leading-none tracking-tight text-white sm:text-3xl">
        Cuatro preguntas. Diez segundos. Sobres en juego.
      </h3>
      <p className="mt-2 max-w-xl text-xs leading-5 text-zinc-300 sm:text-sm">
        Cada acierto sube el premio. Con temple, te llevas defensa, medio y
        delantero antes de que se apague el cronómetro.
      </p>
      <div className="flex sm:justify-center sm:mt-4">
        <button
          type="button"
          onClick={onStart}
          className="mt-4 w-full rounded-xl bg-amber-300 px-5 py-2.5 text-sm font-bold uppercase tracking-[0.12em] text-black shadow-lg shadow-amber-300/20 transition hover:bg-amber-200 sm:w-max"
        >
          Jugar ahora
        </button>
      </div>
    </div>
  );
}

function QuestionPanel({
  locked,
  onAnswer,
  progress,
  question,
  questionIndex,
  selectedIndex,
  timeLeftMs,
}: {
  locked: boolean;
  onAnswer: (index: number | null) => void;
  progress: number;
  question: QuizQuestion;
  questionIndex: number;
  selectedIndex: number | null;
  timeLeftMs: number;
}) {
  const seconds = Math.ceil(timeLeftMs / 1000);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-amber-200">
            Pregunta {questionIndex + 1} de {QUESTIONS.length}
          </p>
          <div className="mt-2 flex gap-1.5">
            {QUESTIONS.map((item, index) => (
              <span
                key={item.question}
                className={`h-1.5 w-8 rounded-full ${
                  index <= questionIndex ? "bg-amber-300" : "bg-white/12"
                }`}
              />
            ))}
          </div>
        </div>
        <div
          className={`grid h-10 w-10 place-items-center rounded-full border text-base font-bold tabular-nums ${
            seconds <= 3
              ? "border-rose-300/70 bg-rose-400/12 text-rose-100"
              : "border-amber-200/60 bg-amber-200/10 text-amber-100"
          }`}
        >
          {seconds}
        </div>
      </div>

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full transition-[width] duration-100 ${
            seconds <= 3 ? "bg-rose-300" : "bg-amber-300"
          }`}
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      <h3 className="mt-4 text-lg font-bold leading-tight text-white sm:text-xl">
        {question.question}
      </h3>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {question.options.map((option, index) => {
          const correct = index === question.correctIndex;
          const selected = selectedIndex === index;
          const showCorrect = locked && correct;
          const showWrong = locked && selected && !correct;
          return (
            <button
              key={option}
              type="button"
              disabled={locked}
              onClick={() => onAnswer(index)}
              className={`group flex min-h-[46px] items-center gap-2 rounded-xl border p-2 text-left transition ${
                showCorrect
                  ? "border-emerald-300/80 bg-emerald-400/16 text-white"
                  : showWrong
                    ? "border-rose-300/80 bg-rose-500/16 text-white"
                    : "border-white/10 bg-white/[0.045] text-zinc-100 hover:border-amber-200/50 hover:bg-amber-200/10"
              }`}
            >
              <span
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-xs font-bold ${
                  showCorrect
                    ? "bg-emerald-300 text-black"
                    : showWrong
                      ? "bg-rose-300 text-black"
                      : "bg-black/36 text-amber-200 group-hover:bg-amber-200 group-hover:text-black"
                }`}
              >
                {answerLabel(index)}
              </span>
              <span className="text-xs font-bold leading-snug sm:text-sm">
                {option}
              </span>
            </button>
          );
        })}
      </div>

      <p className="mt-auto pt-4 text-center text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
        {locked ? "Respuesta bloqueada" : "El tiempo corre"}
      </p>
    </div>
  );
}

function ResultPanel({
  earnedRewards,
  onClose,
  onOpenPacks,
  onRetry,
  score,
  submitError,
  submitState,
}: {
  earnedRewards: RewardPack[];
  onClose: () => void;
  onOpenPacks: () => void;
  onRetry: () => void;
  score: number;
  submitError: string;
  submitState: SubmitState;
}) {
  const saving = submitState === "saving";
  const ready = submitState === "saved";
  const hasRewards = earnedRewards.length > 0;

  return (
    <div className="flex h-full flex-col justify-center">
      <p className="text-xs font-bold uppercase tracking-[0.24em] text-amber-200">
        Resultado
      </p>
      <h3 className="mt-2 text-3xl font-black leading-none text-white sm:text-4xl">
        {score}/4
      </h3>
      <p className="mt-2 max-w-xl text-xs leading-5 text-zinc-300 sm:text-sm">
        {earnedRewards.length
          ? "Sobera te abre la vitrina. Estos serían tus sobres ganados."
          : "Esta vez no hay sobre, pero la silla caliente siempre da revancha."}
      </p>
      {saving ? (
        <p className="mt-2 text-xs font-semibold text-amber-100">
          Preparando tus sobres...
        </p>
      ) : null}
      {submitError ? (
        <p className="mt-2 text-xs font-semibold text-rose-200">
          {submitError}. Pulsa de nuevo para reintentarlo.
        </p>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {REWARD_PACKS.map((reward) => {
          const earned = score >= reward.minScore;
          return (
            <div
              key={reward.title}
              className={`relative overflow-hidden rounded-xl border p-3 ${
                earned
                  ? "border-amber-200/60 bg-amber-200/12"
                  : "border-white/10 bg-white/[0.035] opacity-55"
              }`}
            >
              <div className="relative mx-auto aspect-[818/1206] w-12 sm:w-14">
                <Image
                  src={reward.image}
                  alt={reward.title}
                  fill
                  sizes="88px"
                  className="object-contain"
                />
              </div>
              <p
                className={`mt-2 text-center text-xs font-bold ${
                  earned ? "text-lime-200" : "text-white"
                }`}
              >
                {reward.title}
              </p>
              <p
                className={`mt-1 text-center text-[10px] font-bold uppercase tracking-[0.14em] ${
                  earned ? "text-lime-300" : "text-zinc-400"
                }`}
              >
                {earned ? "Ganado" : `${reward.minScore} aciertos`}
              </p>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex justify-center">
        <button
          type="button"
          disabled={saving}
          onClick={ready ? (hasRewards ? onOpenPacks : onClose) : onRetry}
          className="rounded-xl bg-amber-300 px-4 py-3 text-sm font-bold text-black transition hover:bg-amber-200 disabled:cursor-wait disabled:opacity-70"
        >
          {saving
            ? "Preparando..."
            : ready
              ? hasRewards
                ? "Abrir ahora"
                : "Cerrar"
              : "Reintentar"}
        </button>
      </div>
    </div>
  );
}
