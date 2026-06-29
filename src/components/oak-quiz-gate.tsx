"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  AdivinaModal,
  type AdivinaConfig,
  type AdivinaResult,
  type AdivinaReward,
  type AdivinaRound,
  adivinaCompletedEventName,
} from "@/components/adivina-modal";
import { useAppContext } from "@/lib/app-context";
import { notifyCardsChanged } from "@/lib/cofres";
import { getSupabaseBrowserClient } from "@/lib/supabase";

type OakStatusRow = {
  active?: boolean;
  completed?: boolean;
  quiz_id?: string;
  rewards?: unknown;
  round_time_ms?: number;
  rounds?: unknown;
  title?: string;
};

type OakRpcClient = {
  auth: {
    getSession: () => Promise<{
      data: { session: { user?: unknown } | null };
    }>;
  };
  rpc: (
    fn: string,
    params?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

const PACK_META: Record<string, { image: string; title: string }> = {
  barcelona: { image: "/sobre-barcelona.webp", title: "Sobre Barcelona" },
  defensas: { image: "/sobre-defensas.webp", title: "Sobre Defensas" },
  delanteros: { image: "/sobre-delanteros.webp", title: "Sobre Delanteros" },
  medios: { image: "/sobre-medios.webp", title: "Sobre Mediocentros" },
  porteros: { image: "/sobre-porteros.webp", title: "Sobre Porteros" },
  sub21: { image: "/sobre21.webp", title: "Sobre Promesas" },
};

const DEFAULT_REWARDS: AdivinaReward[] = [
  {
    image: PACK_META.defensas.image,
    minScore: 1,
    pool: "defensas",
    title: PACK_META.defensas.title,
  },
  {
    image: PACK_META.medios.image,
    minScore: 2,
    pool: "medios",
    title: PACK_META.medios.title,
  },
  {
    image: PACK_META.barcelona.image,
    minScore: 4,
    pool: "barcelona",
    title: PACK_META.barcelona.title,
  },
];

function firstRow<T>(data: unknown): T | null {
  return Array.isArray(data) ? ((data[0] as T | undefined) ?? null) : (data as T);
}

function parseRounds(value: unknown): AdivinaRound[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): AdivinaRound | null => {
      if (!item || typeof item !== "object") return null;
      const row = item as {
        aliases?: unknown;
        answerId?: unknown;
        answerLabel?: unknown;
        image?: unknown;
      };
      if (typeof row.image !== "string" || typeof row.answerId !== "string") {
        return null;
      }
      const round: AdivinaRound = {
        answerId: row.answerId,
        image: row.image,
      };
      if (typeof row.answerLabel === "string") {
        round.answerLabel = row.answerLabel;
      }
      if (Array.isArray(row.aliases)) {
        const aliases = row.aliases.filter(
          (alias): alias is string => typeof alias === "string",
        );
        if (aliases.length) round.aliases = aliases;
      }
      return round;
    })
    .filter((item): item is AdivinaRound => Boolean(item));
}

function parseRewards(value: unknown): AdivinaReward[] {
  if (!Array.isArray(value)) return [];
  const parsed: AdivinaReward[] = [];
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
    parsed.push({
      image: meta.image,
      minScore,
      pool,
      title: typeof row.title === "string" ? row.title : meta.title,
    });
  });
  return parsed;
}

function configFromStatus(status: OakStatusRow | null) {
  if (!status?.quiz_id) return null;
  const rounds = parseRounds(status.rounds);
  if (!rounds.length) return null;
  const rewards = parseRewards(status.rewards);
  return {
    id: status.quiz_id,
    rewards: rewards.length ? rewards : DEFAULT_REWARDS,
    roundTimeMs: Number(status.round_time_ms) || 10000,
    rounds,
    title: status.title || "ADIVINA EL CRACK",
  } satisfies AdivinaConfig;
}

export function OakQuizGate() {
  const router = useRouter();
  const { ready, usingSupabase, user } = useAppContext();
  const [open, setOpen] = useState(false);
  const [quiz, setQuiz] = useState<AdivinaConfig | null>(null);
  const completedRef = useRef<string | null>(null);
  const dismissedRef = useRef<string | null>(null);

  useEffect(() => {
    completedRef.current = null;
    dismissedRef.current = null;
  }, [user?.id]);

  const checkStatus = useCallback(async () => {
    if (!ready || !usingSupabase || !user) {
      setOpen(false);
      return;
    }
    const supabase = getSupabaseBrowserClient() as unknown as
      | OakRpcClient
      | null;
    if (!supabase) return;
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData?.session?.user) {
      setOpen(false);
      return;
    }
    const { data, error } = await supabase.rpc("oak_quiz_status");
    if (error) return;
    const status = firstRow<OakStatusRow>(data);
    const nextQuiz = configFromStatus(status);
    const alreadyCompletedHere =
      Boolean(nextQuiz?.id) && completedRef.current === nextQuiz?.id;
    const dismissedHere =
      Boolean(nextQuiz?.id) && dismissedRef.current === nextQuiz?.id;
    const shouldOpen = Boolean(
      status?.active &&
        !status.completed &&
        nextQuiz &&
        !alreadyCompletedHere &&
        !dismissedHere,
    );
    setQuiz(nextQuiz);
    setOpen((prev) => {
      if (shouldOpen) return true;
      if (prev && Boolean(status?.active)) return true;
      return false;
    });
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

  const handleCompleted = useCallback(async (result: AdivinaResult) => {
    const supabase = getSupabaseBrowserClient() as unknown as
      | OakRpcClient
      | null;
    if (!supabase) throw new Error("No se ha podido conectar con Supabase.");
    const { data, error } = await supabase.rpc("complete_oak_quiz", {
      p_answers: result.answers,
      p_quiz_id: result.configId,
    });
    if (error) throw new Error(error.message);
    const row = firstRow<{
      awarded_drop_ids?: unknown;
      quiz_id?: unknown;
      score?: unknown;
    }>(data);
    const quizId = String(row?.quiz_id ?? result.configId);
    const score = Number(row?.score ?? result.correct);
    const awardedDropIds = Array.isArray(row?.awarded_drop_ids)
      ? (row.awarded_drop_ids as string[])
      : [];
    completedRef.current = quizId;
    notifyCardsChanged();
    window.dispatchEvent(
      new CustomEvent(adivinaCompletedEventName, {
        detail: { ...result, awardedDropIds, configId: quizId, correct: score },
      }),
    );
    return {
      awardedDropIds,
      configId: quizId,
      correct: score,
    } satisfies Partial<AdivinaResult>;
  }, []);

  const closeModal = useCallback(() => {
    if (quiz?.id) dismissedRef.current = quiz.id;
    setOpen(false);
  }, [quiz]);

  const goToPacks = useCallback(() => {
    setOpen(false);
    router.push("/cofres");
  }, [router]);

  if (!open || !quiz) return null;
  return (
    <AdivinaModal
      allowReplay={false}
      config={quiz}
      onClose={closeModal}
      onCompleted={handleCompleted}
      onOpenPacks={goToPacks}
    />
  );
}
