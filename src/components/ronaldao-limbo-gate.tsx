"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  RonaldaoLimboModal,
  type RonaldaoLimboConfig,
  type RonaldaoLimboResult,
  type RonaldaoLimboReward,
  ronaldaoLimboCompletedEventName,
} from "@/components/ronaldao-limbo-modal";
import { useAppContext } from "@/lib/app-context";
import { notifyCardsChanged } from "@/lib/cofres";
import { getSupabaseBrowserClient } from "@/lib/supabase";

type RonaldaoLimboStatusRow = {
  active?: boolean;
  completed?: boolean;
  ronaldao_limbo_id?: string;
  rewards?: unknown;
  title?: string;
};

type RonaldaoLimboRpcClient = {
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
  francia: { image: "/sobre-francia.webp", title: "Sobre Francia" },
  madrid: { image: "/sobre-madrid.webp", title: "Sobre Madrid" },
  medios: { image: "/sobre-medios.webp", title: "Sobre Mediocentros" },
  porteros: { image: "/sobre-porteros.webp", title: "Sobre Porteros" },
  premier: { image: "/sobre-premier.webp", title: "Sobre Premier" },
  stars: { image: "/sobre-estrellas.webp", title: "Sobre Estrellas" },
  sub21: { image: "/sobre21.webp", title: "Sobre Promesas" },
};

const DEFAULT_REWARDS: RonaldaoLimboReward[] = [
  {
    image: PACK_META.defensas.image,
    pool: "defensas",
    title: PACK_META.defensas.title,
  },
  {
    image: PACK_META.porteros.image,
    pool: "porteros",
    title: PACK_META.porteros.title,
  },
  {
    image: PACK_META.delanteros.image,
    pool: "delanteros",
    title: PACK_META.delanteros.title,
  },
  {
    image: PACK_META.medios.image,
    pool: "medios",
    title: PACK_META.medios.title,
  },
  {
    image: PACK_META.sub21.image,
    pool: "sub21",
    title: PACK_META.sub21.title,
  },
  {
    image: PACK_META.stars.image,
    pool: "stars",
    title: PACK_META.stars.title,
  },
];

function firstRow<T>(data: unknown): T | null {
  return Array.isArray(data) ? ((data[0] as T | undefined) ?? null) : (data as T);
}

function parseRewards(value: unknown): RonaldaoLimboReward[] {
  if (!Array.isArray(value)) return [];
  const parsed: RonaldaoLimboReward[] = [];
  value.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const row = item as { pool?: unknown; title?: unknown };
    const pool = typeof row.pool === "string" ? row.pool : "";
    const meta = PACK_META[pool];
    if (!meta) return;
    parsed.push({
      image: meta.image,
      pool,
      title: typeof row.title === "string" ? row.title : meta.title,
    });
  });
  return parsed;
}

function configFromStatus(
  status: RonaldaoLimboStatusRow | null,
): RonaldaoLimboConfig | null {
  if (!status?.ronaldao_limbo_id) return null;
  const rewards = parseRewards(status.rewards);
  return {
    id: status.ronaldao_limbo_id,
    rewards: rewards.length ? rewards : DEFAULT_REWARDS,
    title: status.title || "PATATA CALIENTE",
  } satisfies RonaldaoLimboConfig;
}

function sameRonaldaoLimboConfig(
  current: RonaldaoLimboConfig | null,
  next: RonaldaoLimboConfig | null,
) {
  if (current === next) return true;
  if (!current || !next) return false;
  if (
    current.id !== next.id ||
    current.title !== next.title ||
    (current.rewards?.length || 0) !== (next.rewards?.length || 0)
  ) {
    return false;
  }
  return (current.rewards || []).every((reward, index) => {
    const other = next.rewards?.[index];
    return (
      Boolean(other) &&
      reward.image === other?.image &&
      reward.pool === other.pool &&
      reward.title === other.title
    );
  });
}

export function RonaldaoLimboGate() {
  const router = useRouter();
  const { ready, usingSupabase, user } = useAppContext();
  const [open, setOpen] = useState(false);
  const [ronaldaoLimbo, setRonaldaoLimbo] =
    useState<RonaldaoLimboConfig | null>(null);
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
      | RonaldaoLimboRpcClient
      | null;
    if (!supabase) return;
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData?.session?.user) {
      setOpen(false);
      return;
    }
    const { data, error } = await supabase.rpc("ronaldao_limbo_status");
    if (error) return;
    const status = firstRow<RonaldaoLimboStatusRow>(data);
    const next = configFromStatus(status);
    const alreadyCompletedHere =
      Boolean(next?.id) && completedRef.current === next?.id;
    const dismissedHere =
      Boolean(next?.id) && dismissedRef.current === next?.id;
    const shouldOpen = Boolean(
      status?.active &&
        !status.completed &&
        next &&
        !alreadyCompletedHere &&
        !dismissedHere,
    );
    setRonaldaoLimbo((current) =>
      sameRonaldaoLimboConfig(current, next) ? current : next,
    );
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

  const handleCompleted = useCallback(async (result: RonaldaoLimboResult) => {
    completedRef.current = result.configId;
    const supabase = getSupabaseBrowserClient() as unknown as
      | RonaldaoLimboRpcClient
      | null;
    if (!supabase) return;
    try {
      const { data, error } = await supabase.rpc("complete_ronaldao_limbo", {
        p_best_round: result.bestRound,
        p_packs: result.packs,
        p_ronaldao_limbo_id: result.configId,
        p_round_scores: result.roundScores,
      });
      if (error) throw new Error(error.message);
      const row = firstRow<{
        awarded_drop_ids?: unknown;
        ronaldao_limbo_id?: unknown;
      }>(data);
      const awardedDropIds = Array.isArray(row?.awarded_drop_ids)
        ? (row.awarded_drop_ids as string[])
        : [];
      notifyCardsChanged();
      window.dispatchEvent(
        new CustomEvent(ronaldaoLimboCompletedEventName, {
          detail: { ...result, awardedDropIds, configId: result.configId },
        }),
      );
    } catch {
      // El modal queda consumido localmente; si falla el RPC no reabrimos en bucle.
    }
  }, []);

  const closeModal = useCallback(() => {
    if (ronaldaoLimbo?.id) dismissedRef.current = ronaldaoLimbo.id;
    setOpen(false);
  }, [ronaldaoLimbo]);

  const goToPacks = useCallback(() => {
    setOpen(false);
    router.push("/cofres");
  }, [router]);

  if (!open || !ronaldaoLimbo) return null;
  return (
    <RonaldaoLimboModal
      allowReplay={false}
      config={ronaldaoLimbo}
      onClose={closeModal}
      onCompleted={handleCompleted}
      onOpenPacks={goToPacks}
    />
  );
}
