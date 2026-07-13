"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  SanFerminModal,
  type SanFerminConfig,
  type SanFerminResult,
  type SanFerminReward,
} from "@/components/sanfermin-modal";
import { useAppContext } from "@/lib/app-context";
import { notifyCardsChanged } from "@/lib/cofres";
import { getSupabaseBrowserClient } from "@/lib/supabase";

type StatusRow = {
  active?: boolean;
  completed?: boolean;
  extra_hurdles_per_run?: number;
  goal_meters?: number;
  hurdles_per_reward?: number;
  rewards?: unknown;
  sanfermin_id?: string;
  title?: string;
};

type RpcClient = {
  auth: { getSession: () => Promise<{ data: { session: { user?: unknown } | null } }> };
  rpc: (fn: string, params?: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message: string } | null;
  }>;
};

const PACK_META: Record<string, { image: string; title: string }> = {
  defensas: { image: "/sobre-defensas.webp", title: "Sobre Defensa" },
  medios: { image: "/sobre-medios.webp", title: "Sobre Mediocentro" },
  delanteros: { image: "/sobre-delanteros.webp", title: "Sobre Delantero" },
  stars: { image: "/sobre-estrellas.webp", title: "Sobre Estrellas" },
};

const DEFAULT_REWARDS: SanFerminReward[] = [
  { meters: 40, pool: "defensas", ...PACK_META.defensas },
  { meters: 80, pool: "medios", ...PACK_META.medios },
  { meters: 120, pool: "delanteros", ...PACK_META.delanteros },
  { meters: 160, pool: "stars", ...PACK_META.stars },
];

function firstRow<T>(data: unknown): T | null {
  return Array.isArray(data) ? ((data[0] as T | undefined) ?? null) : (data as T);
}

function parseRewards(value: unknown): SanFerminReward[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as { meters?: unknown; pool?: unknown; title?: unknown };
    const pool = typeof row.pool === "string" ? row.pool : "";
    const meta = PACK_META[pool];
    const meters = Number(row.meters);
    if (!meta || !Number.isFinite(meters)) return [];
    return [{
      image: meta.image,
      meters,
      pool,
      title: typeof row.title === "string" ? row.title : meta.title,
    }];
  });
}

function configFromStatus(status: StatusRow | null): SanFerminConfig | null {
  if (!status?.sanfermin_id) return null;
  const rewards = parseRewards(status.rewards);
  return {
    id: status.sanfermin_id,
    title: status.title || "SAN FERMIN RUSH",
    goalMeters: Number(status.goal_meters) || 160,
    hurdlesPerReward: Number(status.hurdles_per_reward) || 3,
    extraHurdlesPerRun: Number(status.extra_hurdles_per_run) || 3,
    rewards: rewards.length ? rewards : DEFAULT_REWARDS,
  };
}

export function SanFerminGate() {
  const router = useRouter();
  const { ready, usingSupabase, user } = useAppContext();
  const [config, setConfig] = useState<SanFerminConfig | null>(null);
  const [open, setOpen] = useState(false);
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
    const supabase = getSupabaseBrowserClient() as unknown as RpcClient | null;
    if (!supabase) return;
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session?.user) return;

    const { data, error } = await supabase.rpc("sanfermin_status");
    if (error) return;
    const status = firstRow<StatusRow>(data);
    const next = configFromStatus(status);
    const blocked =
      !next ||
      completedRef.current === next.id ||
      dismissedRef.current === next.id;
    setConfig(next);
    setOpen(Boolean(status?.active && !status.completed && !blocked));
  }, [ready, usingSupabase, user]);

  useEffect(() => {
    const initialCheck = window.setTimeout(() => void checkStatus(), 0);
    const interval = window.setInterval(() => void checkStatus(), 30000);
    window.addEventListener("focus", checkStatus);
    return () => {
      window.clearTimeout(initialCheck);
      window.clearInterval(interval);
      window.removeEventListener("focus", checkStatus);
    };
  }, [checkStatus]);

  const complete = useCallback(async (result: SanFerminResult) => {
    completedRef.current = result.configId;
    const supabase = getSupabaseBrowserClient() as unknown as RpcClient | null;
    if (!supabase) return;
    const { error } = await supabase.rpc("complete_sanfermin", {
      p_meters: result.metersReached,
      p_sanfermin_id: result.configId,
    });
    if (!error) notifyCardsChanged();
  }, []);

  if (!open || !config) return null;
  return (
    <SanFerminModal
      allowReplay={false}
      config={config}
      onClose={() => {
        dismissedRef.current = config.id;
        setOpen(false);
      }}
      onCompleted={complete}
      onOpenPacks={() => {
        setOpen(false);
        router.push("/cofres");
      }}
    />
  );
}
