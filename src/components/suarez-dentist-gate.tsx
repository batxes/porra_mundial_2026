"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  SuarezDentistModal,
  type SuarezDentistConfig,
  type SuarezDentistResult,
  type SuarezDentistReward,
  suarezDentistCompletedEventName,
} from "@/components/suarez-dentist-modal";
import { useAppContext } from "@/lib/app-context";
import { notifyCardsChanged } from "@/lib/cofres";
import { getSupabaseBrowserClient } from "@/lib/supabase";

type SuarezDentistStatusRow = {
  active?: boolean;
  completed?: boolean;
  suarez_dentist_id?: string;
  title?: string;
  rewards?: unknown;
};

type SuarezDentistRpcClient = {
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
  sub21: { image: "/sobre21.webp", title: "Sobre Promesas" },
  delanteros: { image: "/sobre-delanteros.webp", title: "Sobre Delanteros" },
  stars: { image: "/sobre-estrellas.webp", title: "Sobre Estrellas" },
  madrid: { image: "/sobre-madrid.webp", title: "Sobre Madrid" },
  francia: { image: "/sobre-francia.webp", title: "Sobre Francia" },
};

const DEFAULT_REWARDS: SuarezDentistReward[] = [
  {
    image: PACK_META.defensas.image,
    pool: "defensas",
    title: PACK_META.defensas.title,
  },
  {
    image: PACK_META.medios.image,
    pool: "medios",
    title: PACK_META.medios.title,
  },
  {
    image: PACK_META.premier.image,
    pool: "premier",
    title: PACK_META.premier.title,
  },
];

function firstRow<T>(data: unknown): T | null {
  return Array.isArray(data) ? ((data[0] as T | undefined) ?? null) : (data as T);
}

function parseRewards(value: unknown): SuarezDentistReward[] {
  if (!Array.isArray(value)) return [];
  const parsed: SuarezDentistReward[] = [];
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
  status: SuarezDentistStatusRow | null,
): SuarezDentistConfig | null {
  if (!status?.suarez_dentist_id) return null;
  const rewards = parseRewards(status.rewards);
  return {
    id: status.suarez_dentist_id,
    rewards: rewards.length ? rewards : DEFAULT_REWARDS,
    title: status.title || "DENTISTA SUAREZ",
  } satisfies SuarezDentistConfig;
}

function sameSuarezDentistConfig(
  current: SuarezDentistConfig | null,
  next: SuarezDentistConfig | null,
) {
  if (current === next) return true;
  if (!current || !next) return false;
  if (
    current.id !== next.id ||
    current.title !== next.title ||
    current.rewards.length !== next.rewards.length
  ) {
    return false;
  }
  return current.rewards.every((reward, index) => {
    const other = next.rewards[index];
    return (
      Boolean(other) &&
      reward.image === other.image &&
      reward.pool === other.pool &&
      reward.title === other.title
    );
  });
}

export function SuarezDentistGate() {
  const router = useRouter();
  const { ready, usingSupabase, user } = useAppContext();
  const [open, setOpen] = useState(false);
  const [suarezDentist, setSuarezDentist] =
    useState<SuarezDentistConfig | null>(null);
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
      | SuarezDentistRpcClient
      | null;
    if (!supabase) return;
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData?.session?.user) {
      setOpen(false);
      return;
    }
    const { data, error } = await supabase.rpc("suarez_dentist_status");
    if (error) return;
    const status = firstRow<SuarezDentistStatusRow>(data);
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
    setSuarezDentist((current) =>
      sameSuarezDentistConfig(current, next) ? current : next,
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

  const handleCompleted = useCallback(async (result: SuarezDentistResult) => {
    completedRef.current = result.configId;
    const supabase = getSupabaseBrowserClient() as unknown as
      | SuarezDentistRpcClient
      | null;
    if (!supabase) return;
    try {
      const { data, error } = await supabase.rpc("complete_suarez_dentist", {
        p_attempts: result.attempts,
        p_suarez_dentist_id: result.configId,
      });
      if (error) throw new Error(error.message);
      const row = firstRow<{
        awarded_drop_ids?: unknown;
        suarez_dentist_id?: unknown;
      }>(data);
      const awardedDropIds = Array.isArray(row?.awarded_drop_ids)
        ? (row.awarded_drop_ids as string[])
        : [];
      notifyCardsChanged();
      window.dispatchEvent(
        new CustomEvent(suarezDentistCompletedEventName, {
          detail: { ...result, awardedDropIds, configId: result.configId },
        }),
      );
    } catch {
      // El modal ya quedo consumido localmente; si falla el RPC no reabrimos en bucle.
    }
  }, []);

  const closeModal = useCallback(() => {
    if (suarezDentist?.id) dismissedRef.current = suarezDentist.id;
    setOpen(false);
  }, [suarezDentist]);

  const goToPacks = useCallback(() => {
    setOpen(false);
    router.push("/cofres");
  }, [router]);

  if (!open || !suarezDentist) return null;
  return (
    <SuarezDentistModal
      allowReplay={false}
      config={suarezDentist}
      onClose={closeModal}
      onCompleted={handleCompleted}
      onOpenPacks={goToPacks}
    />
  );
}
