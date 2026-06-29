"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  PorteroPenaltyModal,
  type PorteroPenaltyConfig,
  type PorteroPenaltyResult,
  type PorteroPenaltyReward,
  porteroPenaltyCompletedEventName,
} from "@/components/portero-penalty-modal";
import { useAppContext } from "@/lib/app-context";
import { notifyCardsChanged } from "@/lib/cofres";
import { getSupabaseBrowserClient } from "@/lib/supabase";

type PorteroPenaltyStatusRow = {
  active?: boolean;
  completed?: boolean;
  portero_penalty_id?: string;
  rewards?: unknown;
  title?: string;
  total_shots?: number;
};

type PorteroPenaltyRpcClient = {
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
  medios: { image: "/sobre-medios.webp", title: "Sobre Mediocentros" },
  premier: { image: "/sobre-premier.webp", title: "Sobre Premier" },
  porteros: { image: "/sobre-porteros.webp", title: "Sobre Porteros" },
  sub21: { image: "/sobre21.webp", title: "Sobre Promesas" },
  delanteros: { image: "/sobre-delanteros.webp", title: "Sobre Delanteros" },
  stars: { image: "/sobre-estrellas.webp", title: "Sobre Estrellas" },
  madrid: { image: "/sobre-madrid.webp", title: "Sobre Madrid" },
  francia: { image: "/sobre-francia.webp", title: "Sobre Francia" },
};

const DEFAULT_REWARDS: PorteroPenaltyReward[] = [
  {
    image: PACK_META.porteros.image,
    minSaves: 1,
    pool: "porteros",
    title: PACK_META.porteros.title,
  },
  {
    image: PACK_META.porteros.image,
    minSaves: 2,
    pool: "porteros",
    title: PACK_META.porteros.title,
  },
  {
    image: PACK_META.porteros.image,
    minSaves: 4,
    pool: "porteros",
    title: PACK_META.porteros.title,
  },
];

function firstRow<T>(data: unknown): T | null {
  return Array.isArray(data) ? ((data[0] as T | undefined) ?? null) : (data as T);
}

function parseRewards(value: unknown): PorteroPenaltyReward[] {
  if (!Array.isArray(value)) return [];
  const parsed: PorteroPenaltyReward[] = [];
  value.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const row = item as { minSaves?: unknown; pool?: unknown; title?: unknown };
    const pool = typeof row.pool === "string" ? row.pool : "";
    const meta = PACK_META[pool];
    const minSaves = Number(row.minSaves);
    if (!meta || !Number.isFinite(minSaves)) return;
    parsed.push({
      image: meta.image,
      minSaves,
      pool,
      title: typeof row.title === "string" ? row.title : meta.title,
    });
  });
  return parsed;
}

function configFromStatus(
  status: PorteroPenaltyStatusRow | null,
): PorteroPenaltyConfig | null {
  if (!status?.portero_penalty_id) return null;
  const rewards = parseRewards(status.rewards);
  return {
    id: status.portero_penalty_id,
    rewards: rewards.length ? rewards : DEFAULT_REWARDS,
    title: status.title || "MARRERO BAJO PALOS",
    totalShots: Number(status.total_shots) || 5,
  } satisfies PorteroPenaltyConfig;
}

function samePorteroPenaltyConfig(
  current: PorteroPenaltyConfig | null,
  next: PorteroPenaltyConfig | null,
) {
  if (current === next) return true;
  if (!current || !next) return false;
  if (
    current.id !== next.id ||
    current.title !== next.title ||
    current.totalShots !== next.totalShots ||
    (current.rewards?.length || 0) !== (next.rewards?.length || 0)
  ) {
    return false;
  }
  return (current.rewards || []).every((reward, index) => {
    const other = next.rewards?.[index];
    return (
      Boolean(other) &&
      reward.image === other?.image &&
      reward.minSaves === other.minSaves &&
      reward.pool === other.pool &&
      reward.title === other.title
    );
  });
}

export function PorteroPenaltyGate() {
  const router = useRouter();
  const { ready, usingSupabase, user } = useAppContext();
  const [open, setOpen] = useState(false);
  const [porteroPenalty, setPorteroPenalty] =
    useState<PorteroPenaltyConfig | null>(null);
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
      | PorteroPenaltyRpcClient
      | null;
    if (!supabase) return;
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData?.session?.user) {
      setOpen(false);
      return;
    }
    const { data, error } = await supabase.rpc("portero_penalty_status");
    if (error) return;
    const status = firstRow<PorteroPenaltyStatusRow>(data);
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
    setPorteroPenalty((current) =>
      samePorteroPenaltyConfig(current, next) ? current : next,
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

  const handleCompleted = useCallback(async (result: PorteroPenaltyResult) => {
    completedRef.current = result.configId;
    const supabase = getSupabaseBrowserClient() as unknown as
      | PorteroPenaltyRpcClient
      | null;
    if (!supabase) return;
    try {
      const { data, error } = await supabase.rpc("complete_portero_penalty", {
        p_portero_penalty_id: result.configId,
        p_saves: result.saves,
        p_shots: result.shots,
        p_total_shots: result.totalShots,
      });
      if (error) throw new Error(error.message);
      const row = firstRow<{
        awarded_drop_ids?: unknown;
        portero_penalty_id?: unknown;
      }>(data);
      const awardedDropIds = Array.isArray(row?.awarded_drop_ids)
        ? (row.awarded_drop_ids as string[])
        : [];
      notifyCardsChanged();
      window.dispatchEvent(
        new CustomEvent(porteroPenaltyCompletedEventName, {
          detail: { ...result, awardedDropIds, configId: result.configId },
        }),
      );
    } catch {
      // El modal ya quedo consumido localmente; si falla el RPC no reabrimos en bucle.
    }
  }, []);

  const closeModal = useCallback(() => {
    if (porteroPenalty?.id) dismissedRef.current = porteroPenalty.id;
    setOpen(false);
  }, [porteroPenalty]);

  const goToPacks = useCallback(() => {
    setOpen(false);
    router.push("/cofres");
  }, [router]);

  if (!open || !porteroPenalty) return null;
  return (
    <PorteroPenaltyModal
      allowReplay={false}
      config={porteroPenalty}
      onClose={closeModal}
      onCompleted={handleCompleted}
      onOpenPacks={goToPacks}
    />
  );
}
