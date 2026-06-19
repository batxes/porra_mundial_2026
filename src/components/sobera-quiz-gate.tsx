"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  SoberaQuizModal,
  type SoberaQuizConfig,
  type SoberaQuizCompletion,
  type SoberaQuizQuestion,
  type SoberaQuizReward,
  soberaQuizCompletedEventName,
} from "@/components/sobera-quiz-modal";
import { useAppContext } from "@/lib/app-context";
import { getSupabaseBrowserClient } from "@/lib/supabase";

type QuizStatusRow = {
  active?: boolean;
  completed?: boolean;
  question_time_ms?: number;
  questions?: unknown;
  quiz_id?: string;
  rewards?: unknown;
  title?: string;
};

type QuizRpcClient = {
  rpc: (
    fn: string,
    params?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

function firstRow<T>(data: unknown): T | null {
  return Array.isArray(data) ? ((data[0] as T | undefined) ?? null) : (data as T);
}

const PACK_META: Record<string, { image: string; title: string }> = {
  defensas: { image: "/sobre-defensas.webp", title: "Sobre Defensas" },
  delanteros: { image: "/sobre-delanteros.webp", title: "Sobre Delanteros" },
  francia: { image: "/sobre-francia.webp", title: "Sobre Francia" },
  madrid: { image: "/sobre-madrid.webp", title: "Sobre Madrid" },
  medios: { image: "/sobre-medios.webp", title: "Sobre Mediocentros" },
  premier: { image: "/sobre-premier.webp", title: "Sobre Premier" },
  stars: { image: "/sobre-estrellas.webp", title: "Sobre Estrellas" },
  sub21: { image: "/sobre21.webp", title: "Sobre Promesas" },
};

const DEFAULT_REWARDS: SoberaQuizReward[] = [
  {
    image: PACK_META.defensas.image,
    minScore: 1,
    pool: "defensas",
    title: PACK_META.defensas.title,
  },
];

function parseQuestions(value: unknown): SoberaQuizQuestion[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as { options?: unknown; question?: unknown };
      if (typeof row.question !== "string" || !Array.isArray(row.options)) {
        return null;
      }
      const options = row.options.filter(
        (option): option is string => typeof option === "string",
      );
      if (options.length !== 4) return null;
      return { options, question: row.question };
    })
    .filter((item): item is SoberaQuizQuestion => Boolean(item));
}

function parseRewards(value: unknown): SoberaQuizReward[] {
  if (!Array.isArray(value)) return [];
  const rewards: SoberaQuizReward[] = [];
  value.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const row = item as {
      minScore?: unknown;
      pool?: unknown;
      title?: unknown;
    };
    const pool = typeof row.pool === "string" ? row.pool : "";
    const meta = PACK_META[pool];
    const minScore = Number(row.minScore);
    if (!meta || !Number.isFinite(minScore)) return;
    rewards.push({
      image: meta.image,
      minScore,
      pool,
      title: typeof row.title === "string" ? row.title : meta.title,
    });
  });
  return rewards;
}

function quizConfigFromStatus(status: QuizStatusRow | null) {
  if (!status?.quiz_id) return null;
  const questions = parseQuestions(status.questions);
  if (!questions.length) return null;
  const rewards = parseRewards(status.rewards);
  return {
    id: status.quiz_id,
    questionTimeMs: Number(status.question_time_ms) || 10000,
    questions,
    rewards: rewards.length ? rewards : DEFAULT_REWARDS,
    title: status.title || "SOBRE EXTRA",
  } satisfies SoberaQuizConfig;
}

export function SoberaQuizGate() {
  const router = useRouter();
  const { ready, usingSupabase, user } = useAppContext();
  const [open, setOpen] = useState(false);
  const [quiz, setQuiz] = useState<SoberaQuizConfig | null>(null);
  const completedQuizRef = useRef<string | null>(null);
  const dismissedQuizRef = useRef<string | null>(null);

  useEffect(() => {
    completedQuizRef.current = null;
    dismissedQuizRef.current = null;
  }, [user?.id]);

  const checkStatus = useCallback(async () => {
    if (!ready || !usingSupabase || !user) {
      setOpen(false);
      return;
    }
    const supabase = getSupabaseBrowserClient() as unknown as
      | QuizRpcClient
      | null;
    if (!supabase) return;
    const { data, error } = await supabase.rpc("sobera_quiz_status");
    if (error) return;
    const status = firstRow<QuizStatusRow>(data);
    const nextQuiz = quizConfigFromStatus(status);
    const alreadyCompletedHere =
      Boolean(nextQuiz?.id) && completedQuizRef.current === nextQuiz?.id;
    const dismissedHere =
      Boolean(nextQuiz?.id) && dismissedQuizRef.current === nextQuiz?.id;
    const shouldOpen = Boolean(
      status?.active &&
        !status.completed &&
        nextQuiz &&
        !alreadyCompletedHere &&
        !dismissedHere,
    );
    setQuiz(nextQuiz);
    setOpen(shouldOpen);
  }, [ready, usingSupabase, user]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void checkStatus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [checkStatus]);

  useEffect(() => {
    if (!ready || !usingSupabase || !user) return;
    const interval = window.setInterval(() => {
      void checkStatus();
    }, 30000);
    const onFocus = () => void checkStatus();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [checkStatus, ready, usingSupabase, user]);

  const handleCompleted = useCallback((result: SoberaQuizCompletion) => {
    completedQuizRef.current = result.quizId;
    window.dispatchEvent(
      new CustomEvent(soberaQuizCompletedEventName, { detail: result }),
    );
  }, []);

  const closeModal = useCallback(() => {
    if (quiz?.id) dismissedQuizRef.current = quiz.id;
    setOpen(false);
  }, [quiz]);

  const goToPacks = useCallback(() => {
    setOpen(false);
    router.push("/cofres");
  }, [router]);

  if (!open || !quiz) return null;
  return (
    <SoberaQuizModal
      onClose={closeModal}
      onCompleted={handleCompleted}
      onOpenPacks={goToPacks}
      quiz={quiz}
    />
  );
}
