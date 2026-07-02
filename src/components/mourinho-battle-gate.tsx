"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  MourinhoBattleIntroModal,
  type MourinhoBattleConfig,
  type MourinhoBattleResult,
  type MourinhoBattleReward,
  mourinhoBattleCompletedEventName,
} from "@/components/mourinho-battle-intro-modal";
import { useAppContext } from "@/lib/app-context";
import { notifyCardsChanged } from "@/lib/cofres";
import { getSupabaseBrowserClient } from "@/lib/supabase";

type MourinhoBattleStatusRow = {
  active?: boolean;
  completed?: boolean;
  defeated_count?: number;
  defeated_pokemon_ids?: unknown;
  mourinho_battle_id?: string;
  rewards?: unknown;
  title?: string;
};

type MourinhoBattleRpcClient = {
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

const DEFAULT_REWARDS: MourinhoBattleReward[] = [
  {
    battle: 1,
    image: PACK_META.defensas.image,
    pool: "defensas",
    title: PACK_META.defensas.title,
  },
  {
    battle: 2,
    image: PACK_META.medios.image,
    pool: "medios",
    title: PACK_META.medios.title,
  },
  {
    battle: 3,
    image: PACK_META.madrid.image,
    pool: "madrid",
    title: PACK_META.madrid.title,
  },
  {
    battle: 4,
    image: PACK_META.sub21.image,
    pool: "sub21",
    title: PACK_META.sub21.title,
  },
  {
    battle: 5,
    image: PACK_META.stars.image,
    pool: "stars",
    title: PACK_META.stars.title,
  },
];

function firstRow<T>(data: unknown): T | null {
  return Array.isArray(data) ? ((data[0] as T | undefined) ?? null) : (data as T);
}

function parseRewards(value: unknown): MourinhoBattleReward[] {
  if (!Array.isArray(value)) return [];
  const parsed: MourinhoBattleReward[] = [];
  value.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const row = item as { pool?: unknown; title?: unknown };
    const pool = typeof row.pool === "string" ? row.pool : "";
    const meta = PACK_META[pool];
    if (!meta) return;
    parsed.push({
      battle: index + 1,
      image: meta.image,
      pool,
      title: typeof row.title === "string" ? row.title : meta.title,
    });
  });
  return parsed;
}

function configFromStatus(
  status: MourinhoBattleStatusRow | null,
): MourinhoBattleConfig | null {
  if (!status?.mourinho_battle_id) return null;
  const rewards = parseRewards(status.rewards);
  return {
    id: status.mourinho_battle_id,
    rewards: rewards.length ? rewards : DEFAULT_REWARDS,
    title: status.title || "RETO MOURINHO",
  } satisfies MourinhoBattleConfig;
}

function sameMourinhoBattleConfig(
  current: MourinhoBattleConfig | null,
  next: MourinhoBattleConfig | null,
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

export function MourinhoBattleGate() {
  const router = useRouter();
  const { ready, usingSupabase, user } = useAppContext();
  const [open, setOpen] = useState(false);
  const [battle, setBattle] = useState<MourinhoBattleConfig | null>(null);
  const completedRef = useRef<string | null>(null);
  const dismissedRef = useRef<string | null>(null);

  useEffect(() => {
    completedRef.current = null;
    dismissedRef.current = null;
  }, [user?.id]);

  const checkStatus = useCallback(async () => {
    if (!ready || !usingSupabase || !user || user.isAdmin) {
      setOpen(false);
      return;
    }
    const supabase = getSupabaseBrowserClient() as unknown as
      | MourinhoBattleRpcClient
      | null;
    if (!supabase) return;
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData?.session?.user) {
      setOpen(false);
      return;
    }
    const { data, error } = await supabase.rpc("mourinho_battle_status");
    if (error) return;
    const status = firstRow<MourinhoBattleStatusRow>(data);
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
    setBattle((current) =>
      sameMourinhoBattleConfig(current, next) ? current : next,
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
    if (!ready || !usingSupabase || !user || user.isAdmin) return;
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

  const handleCompleted = useCallback(async (result: MourinhoBattleResult) => {
    completedRef.current = result.configId;
    const supabase = getSupabaseBrowserClient() as unknown as
      | MourinhoBattleRpcClient
      | null;
    if (!supabase) return;
    try {
      const { data, error } = await supabase.rpc("complete_mourinho_battle", {
        p_defeated_pokemon_ids: result.defeatedPokemonIds,
        p_mourinho_battle_id: result.configId,
      });
      if (error) throw new Error(error.message);
      const row = firstRow<{
        awarded_drop_ids?: unknown;
        mourinho_battle_id?: unknown;
      }>(data);
      const awardedDropIds = Array.isArray(row?.awarded_drop_ids)
        ? (row.awarded_drop_ids as string[])
        : [];
      notifyCardsChanged();
      window.dispatchEvent(
        new CustomEvent(mourinhoBattleCompletedEventName, {
          detail: { ...result, awardedDropIds, configId: result.configId },
        }),
      );
    } catch {
      // El modal queda consumido localmente; si falla el RPC no reabrimos en bucle.
    }
  }, []);

  const closeModal = useCallback(() => {
    if (battle?.id) dismissedRef.current = battle.id;
    setOpen(false);
  }, [battle]);

  const goToPacks = useCallback(() => {
    setOpen(false);
    router.push("/cofres");
  }, [router]);

  if (!open || !battle) return null;
  return (
    <MourinhoBattleIntroModal
      config={battle}
      onClose={closeModal}
      onCompleted={handleCompleted}
      onOpenPacks={goToPacks}
    />
  );
}
