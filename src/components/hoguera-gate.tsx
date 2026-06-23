"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  HogueraModal,
  type HogueraConfig,
  type HogueraResult,
  type HogueraReward,
  hogueraCompletedEventName,
} from "@/components/hoguera-modal";
import { useAppContext } from "@/lib/app-context";
import { notifyCardsChanged } from "@/lib/cofres";
import { getSupabaseBrowserClient } from "@/lib/supabase";

type HogueraStatusRow = {
  active?: boolean;
  completed?: boolean;
  hoguera_id?: string;
  title?: string;
  goal_meters?: number;
  flame_every_meters?: number;
  rewards?: unknown;
};

type HogueraRpcClient = {
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
  defensas: { image: "/sobre-defensas.webp", title: "Sobre Defensas" },
  medios: { image: "/sobre-medios.webp", title: "Sobre Mediocentros" },
  premier: { image: "/sobre-premier.webp", title: "Sobre Premier" },
  sub21: { image: "/sobre21.webp", title: "Sobre Promesas" },
  delanteros: { image: "/sobre-delanteros.webp", title: "Sobre Delanteros" },
  stars: { image: "/sobre-estrellas.webp", title: "Sobre Estrellas" },
  madrid: { image: "/sobre-madrid.webp", title: "Sobre Madrid" },
  francia: { image: "/sobre-francia.webp", title: "Sobre Francia" },
};

const DEFAULT_REWARDS: HogueraReward[] = [
  {
    image: PACK_META.defensas.image,
    meters: 25,
    pool: "defensas",
    title: PACK_META.defensas.title,
  },
  {
    image: PACK_META.medios.image,
    meters: 50,
    pool: "medios",
    title: PACK_META.medios.title,
  },
  {
    image: PACK_META.premier.image,
    meters: 75,
    pool: "premier",
    title: PACK_META.premier.title,
  },
  {
    image: PACK_META.sub21.image,
    meters: 100,
    pool: "sub21",
    title: PACK_META.sub21.title,
  },
];

function firstRow<T>(data: unknown): T | null {
  return Array.isArray(data) ? ((data[0] as T | undefined) ?? null) : (data as T);
}

function parseRewards(value: unknown): HogueraReward[] {
  if (!Array.isArray(value)) return [];
  const parsed: HogueraReward[] = [];
  value.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const row = item as { meters?: unknown; pool?: unknown; title?: unknown };
    const pool = typeof row.pool === "string" ? row.pool : "";
    const meta = PACK_META[pool];
    const meters = Number(row.meters);
    if (!meta || !Number.isFinite(meters)) return;
    parsed.push({
      image: meta.image,
      meters,
      pool,
      title: typeof row.title === "string" ? row.title : meta.title,
    });
  });
  return parsed;
}

function configFromStatus(status: HogueraStatusRow | null): HogueraConfig | null {
  if (!status?.hoguera_id) return null;
  const rewards = parseRewards(status.rewards);
  return {
    id: status.hoguera_id,
    title: status.title || "SALTA LA HOGUERA",
    goalMeters: Number(status.goal_meters) || 100,
    flameEveryMeters: Number(status.flame_every_meters) || 5,
    rewards: rewards.length ? rewards : DEFAULT_REWARDS,
  } satisfies HogueraConfig;
}

export function HogueraGate() {
  const router = useRouter();
  const { ready, usingSupabase, user } = useAppContext();
  const [open, setOpen] = useState(false);
  const [hoguera, setHoguera] = useState<HogueraConfig | null>(null);
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
      | HogueraRpcClient
      | null;
    if (!supabase) return;
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData?.session?.user) {
      setOpen(false);
      return;
    }
    const { data, error } = await supabase.rpc("hoguera_status");
    if (error) return;
    const status = firstRow<HogueraStatusRow>(data);
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
    setHoguera(next);
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

  // El modal de la hoguera llama a onCompleted de forma sincrona (fire-and-forget),
  // asi que el RPC corre como efecto: no relanza ni bloquea el modal. Marcamos la
  // jugada como consumida de inmediato para que el polling no reabra el modal.
  const handleCompleted = useCallback(async (result: HogueraResult) => {
    completedRef.current = result.configId;
    const supabase = getSupabaseBrowserClient() as unknown as
      | HogueraRpcClient
      | null;
    if (!supabase) return;
    try {
      const { data, error } = await supabase.rpc("complete_hoguera", {
        p_hoguera_id: result.configId,
        p_meters: result.metersReached,
      });
      if (error) throw new Error(error.message);
      const row = firstRow<{
        awarded_drop_ids?: unknown;
        hoguera_id?: unknown;
      }>(data);
      const awardedDropIds = Array.isArray(row?.awarded_drop_ids)
        ? (row.awarded_drop_ids as string[])
        : [];
      notifyCardsChanged();
      window.dispatchEvent(
        new CustomEvent(hogueraCompletedEventName, {
          detail: { ...result, awardedDropIds, configId: result.configId },
        }),
      );
    } catch {
      // El modal no espera este RPC; si falla, el sobre no se concede. La jugada
      // ya quedo marcada como consumida arriba para no reabrir en bucle.
    }
  }, []);

  const closeModal = useCallback(() => {
    if (hoguera?.id) dismissedRef.current = hoguera.id;
    setOpen(false);
  }, [hoguera]);

  const goToPacks = useCallback(() => {
    setOpen(false);
    router.push("/cofres");
  }, [router]);

  if (!open || !hoguera) return null;
  return (
    <HogueraModal
      allowReplay={false}
      config={hoguera}
      onClose={closeModal}
      onCompleted={handleCompleted}
      onOpenPacks={goToPacks}
    />
  );
}
