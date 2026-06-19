"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase";

type QuizPhase = "intro" | "question" | "result";
type SubmitState = "idle" | "saving" | "saved" | "error";

export type SoberaQuizQuestion = {
  options: string[];
  question: string;
};

export type SoberaQuizReward = {
  image: string;
  minScore: number;
  pool?: string;
  title: string;
};

export type SoberaQuizConfig = {
  id: string;
  questionTimeMs: number;
  questions: SoberaQuizQuestion[];
  rewards: SoberaQuizReward[];
  title: string;
};

type QuizAnswer = {
  selectedIndex: number | null;
};

export type SoberaQuizCompletion = {
  awardedDropIds: string[];
  quizId: string;
  score: number;
};

type QuizRpcClient = {
  rpc: (
    fn: string,
    params?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

export const soberaQuizCompletedEventName = "triliporra:sobera-quiz-completed";

const FALLBACK_QUESTION_TIME_MS = 10000;

function rewardsForScore(score: number | null, rewards: SoberaQuizReward[]) {
  if (score === null) return [];
  return rewards.filter((reward) => score >= reward.minScore);
}

function answerLabel(index: number) {
  return ["A", "B", "C", "D"][index] || String(index + 1);
}

function displaySeconds(timeLeftMs: number) {
  return Math.max(0, Math.ceil(timeLeftMs / 1000));
}

export function SoberaQuizModal({
  onClose,
  onCompleted,
  onOpenPacks,
  quiz,
}: {
  onClose: () => void;
  onCompleted?: (result: SoberaQuizCompletion) => void;
  onOpenPacks?: () => void;
  quiz: SoberaQuizConfig;
}) {
  const questions = quiz.questions.length ? quiz.questions : [];
  const questionTimeMs = Math.max(
    1000,
    Number(quiz.questionTimeMs) || FALLBACK_QUESTION_TIME_MS,
  );
  const [phase, setPhase] = useState<QuizPhase>("intro");
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<QuizAnswer[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [locked, setLocked] = useState(false);
  const [timeLeftMs, setTimeLeftMs] = useState(questionTimeMs);
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [submitError, setSubmitError] = useState("");
  const [serverResult, setServerResult] =
    useState<SoberaQuizCompletion | null>(null);
  const nextTimerRef = useRef<number | null>(null);
  const submitStartedRef = useRef(false);

  const question = questions[questionIndex];
  const displayScore = serverResult?.score ?? null;
  const earnedRewards = useMemo(
    () => rewardsForScore(displayScore, quiz.rewards),
    [displayScore, quiz.rewards],
  );
  const progress = Math.max(0, Math.min(1, timeLeftMs / questionTimeMs));
  const heroCompact = phase !== "intro";
  const soberaImage =
    phase === "result"
      ? displayScore === 0
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
    setTimeLeftMs(questionTimeMs);
  }, [questionTimeMs]);

  const startQuiz = () => {
    if (!questions.length) return;
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
        p_quiz_id: quiz.id,
      });
      if (error) throw new Error(error.message);
      const row = Array.isArray(data) ? data[0] : data;
      const result: SoberaQuizCompletion = {
        quizId: String(
          (row as { quiz_id?: unknown } | null)?.quiz_id ?? quiz.id,
        ),
        score: Number((row as { score?: unknown } | null)?.score ?? 0),
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
  }, [answers, onCompleted, phase, quiz.id]);

  const lockAnswer = useCallback(
    (choiceIndex: number | null) => {
      if (locked || phase !== "question" || !question) return;
      const nextQuestionIndex = questionIndex + 1;

      clearNextTimer();
      setSelectedIndex(choiceIndex);
      setLocked(true);
      setAnswers((current) => [...current, { selectedIndex: choiceIndex }]);

      nextTimerRef.current = window.setTimeout(() => {
        if (nextQuestionIndex >= questions.length) {
          setPhase("result");
          return;
        }
        setQuestionIndex(nextQuestionIndex);
        resetQuestionState();
      }, 650);
    },
    [
      clearNextTimer,
      locked,
      phase,
      question,
      questionIndex,
      questions.length,
      resetQuestionState,
    ],
  );

  useEffect(() => {
    if (phase !== "question" || locked) return;
    const startedAt = performance.now();
    const timer = window.setInterval(() => {
      const elapsed = performance.now() - startedAt;
      const next = Math.max(0, questionTimeMs - elapsed);
      setTimeLeftMs(next);
      if (next <= 0) lockAnswer(null);
    }, 100);

    return () => window.clearInterval(timer);
  }, [lockAnswer, locked, phase, questionIndex, questionTimeMs]);

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
      <div className="theme-dark relative grid w-full max-w-xl overflow-hidden rounded-2xl border border-amber-300/25 bg-[#080808] shadow-2xl shadow-black/70">
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar quiz"
          className="absolute right-3 top-3 z-30 grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-black/45 text-lg font-bold leading-none text-white transition hover:bg-white/10"
        >
          x
        </button>
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
                {quiz.title || "SOBRE EXTRA"}
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
              {quiz.rewards.map((reward) => (
                <div
                  key={`${reward.minScore}-${reward.title}`}
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
            <IntroPanel
              onStart={startQuiz}
              questionCount={questions.length}
              questionTimeMs={questionTimeMs}
            />
          ) : phase === "question" && question ? (
            <QuestionPanel
              locked={locked}
              onAnswer={lockAnswer}
              progress={progress}
              question={question}
              questionIndex={questionIndex}
              questions={questions}
              selectedIndex={selectedIndex}
              timeLeftMs={timeLeftMs}
            />
          ) : (
            <ResultPanel
              earnedRewards={earnedRewards}
              onClose={onClose}
              onOpenPacks={onOpenPacks || onClose}
              onRetry={submitQuizResult}
              questionCount={questions.length || 4}
              rewards={quiz.rewards}
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

function IntroPanel({
  onStart,
  questionCount,
  questionTimeMs,
}: {
  onStart: () => void;
  questionCount: number;
  questionTimeMs: number;
}) {
  return (
    <div className="flex h-full flex-col justify-center">
      <span className="w-max rounded-full border border-amber-200/30 bg-amber-200/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-amber-200">
        Ronda relampago
      </span>
      <h3 className="mt-3 text-2xl font-bold leading-none tracking-tight text-white sm:text-3xl">
        {questionCount} preguntas. {Math.round(questionTimeMs / 1000)} segundos.
        Sobres en juego.
      </h3>
      <p className="mt-2 max-w-xl text-xs leading-5 text-zinc-300 sm:text-sm">
        Cada acierto sube el premio. Con temple, te llevas sobres antes de que
        se apague el cronometro.
      </p>
      <div className="flex sm:mt-4 sm:justify-center">
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
  questions,
  selectedIndex,
  timeLeftMs,
}: {
  locked: boolean;
  onAnswer: (index: number | null) => void;
  progress: number;
  question: SoberaQuizQuestion;
  questionIndex: number;
  questions: SoberaQuizQuestion[];
  selectedIndex: number | null;
  timeLeftMs: number;
}) {
  const seconds = displaySeconds(timeLeftMs);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-amber-200">
            Pregunta {questionIndex + 1} de {questions.length}
          </p>
          <div className="mt-2 flex gap-1.5">
            {questions.map((item, index) => (
              <span
                key={`${item.question}-${index}`}
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
          const selected = selectedIndex === index;
          const showSelected = locked && selected;
          return (
            <button
              key={`${option}-${index}`}
              type="button"
              disabled={locked}
              onClick={() => onAnswer(index)}
              className={`group flex min-h-[46px] items-center gap-2 rounded-xl border p-2 text-left transition ${
                showSelected
                  ? "border-amber-200/80 bg-amber-300/14 text-white"
                  : "border-white/10 bg-white/[0.045] text-zinc-100 hover:border-amber-200/50 hover:bg-amber-200/10"
              }`}
            >
              <span
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-xs font-bold ${
                  showSelected
                    ? "bg-amber-300 text-black"
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
  questionCount,
  rewards,
  score,
  submitError,
  submitState,
}: {
  earnedRewards: SoberaQuizReward[];
  onClose: () => void;
  onOpenPacks: () => void;
  onRetry: () => void;
  questionCount: number;
  rewards: SoberaQuizReward[];
  score: number | null;
  submitError: string;
  submitState: SubmitState;
}) {
  const saving = submitState === "saving";
  const ready = submitState === "saved" && score !== null;
  const hasRewards = ready && earnedRewards.length > 0;

  return (
    <div className="flex h-full flex-col justify-center">
      <p className="text-xs font-bold uppercase tracking-[0.24em] text-amber-200">
        Resultado
      </p>
      <h3 className="mt-2 text-3xl font-black leading-none text-white sm:text-4xl">
        {score === null ? ".../" : `${score}/`}
        {questionCount}
      </h3>
      <p className="mt-2 max-w-xl text-xs leading-5 text-zinc-300 sm:text-sm">
        {score === null
          ? "Sobera esta revisando las respuestas."
          : hasRewards
            ? "Sobera te abre la vitrina. Estos serian tus sobres ganados."
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
        {rewards.map((reward) => {
          const earned = ready && score >= reward.minScore;
          return (
            <div
              key={`${reward.minScore}-${reward.title}`}
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

      <div className="mt-4 flex flex-wrap justify-center gap-2">
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
        {submitState === "error" ? (
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/10 px-4 py-3 text-sm font-bold text-white transition hover:bg-white/10"
          >
            Salir
          </button>
        ) : null}
      </div>
    </div>
  );
}
