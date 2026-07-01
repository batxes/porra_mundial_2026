"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  ScratchCardsModal,
  type ScratchCardReward,
  type ScratchCardsConfig,
  type ScratchCardsResult,
  scratchCardsCompletedEventName,
} from "@/components/scratch-cards-modal";
import { useAppContext } from "@/lib/app-context";
import { notifyCardsChanged } from "@/lib/cofres";
import { getSupabaseBrowserClient } from "@/lib/supabase";

type ScratchCardsStatusRow = {
  active?: boolean;
  card_count?: number;
  completed?: boolean;
  rewards?: unknown;
  scratch_card_id?: string;
  title?: string;
  win_chance?: number;
};

type ScratchCardsRpcClient = {
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

const DEFAULT_REWARDS: ScratchCardReward[] = [
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
    image: PACK_META.delanteros.image,
    pool: "delanteros",
    title: PACK_META.delanteros.title,
  },
  {
    image: PACK_META.porteros.image,
    pool: "porteros",
    title: PACK_META.porteros.title,
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

function parseRewards(value: unknown): ScratchCardReward[] {
  if (!Array.isArray(value)) return [];
  const parsed: ScratchCardReward[] = [];
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
  status: ScratchCardsStatusRow | null,
): ScratchCardsConfig | null {
  if (!status?.scratch_card_id) return null;
  const rewards = parseRewards(status.rewards);
  return {
    cardCount: Number(status.card_count) || 5,
    id: status.scratch_card_id,
    rewards: rewards.length ? rewards : DEFAULT_REWARDS,
    title: status.title || "RASCA SOBRES",
    winChance: Number(status.win_chance) || 0.33,
  } satisfies ScratchCardsConfig;
}

function sameScratchCardsConfig(
  current: ScratchCardsConfig | null,
  next: ScratchCardsConfig | null,
) {
  if (current === next) return true;
  if (!current || !next) return false;
  if (
    current.id !== next.id ||
    current.title !== next.title ||
    current.cardCount !== next.cardCount ||
    current.winChance !== next.winChance ||
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

function payloadCards(result: ScratchCardsResult) {
  return result.cards.map((card, index) => ({
    index: index + 1,
    slots: card.slots.map((slot) => slot.pool || ""),
  }));
}

export function ScratchCardsGate() {
  const router = useRouter();
  const { ready, usingSupabase, user } = useAppContext();
  const [open, setOpen] = useState(false);
  const [scratchCards, setScratchCards] =
    useState<ScratchCardsConfig | null>(null);
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
      | ScratchCardsRpcClient
      | null;
    if (!supabase) return;
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData?.session?.user) {
      setOpen(false);
      return;
    }
    const { data, error } = await supabase.rpc("scratch_cards_status");
    if (error) return;
    const status = firstRow<ScratchCardsStatusRow>(data);
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
    setScratchCards((current) =>
      sameScratchCardsConfig(current, next) ? current : next,
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

  const handleCompleted = useCallback(async (result: ScratchCardsResult) => {
    completedRef.current = result.configId;
    const supabase = getSupabaseBrowserClient() as unknown as
      | ScratchCardsRpcClient
      | null;
    if (!supabase) return;
    try {
      const { data, error } = await supabase.rpc("complete_scratch_cards", {
        p_cards: payloadCards(result),
        p_scratch_card_id: result.configId,
      });
      if (error) throw new Error(error.message);
      const row = firstRow<{
        awarded_drop_ids?: unknown;
        scratch_card_id?: unknown;
      }>(data);
      const awardedDropIds = Array.isArray(row?.awarded_drop_ids)
        ? (row.awarded_drop_ids as string[])
        : [];
      notifyCardsChanged();
      window.dispatchEvent(
        new CustomEvent(scratchCardsCompletedEventName, {
          detail: { ...result, awardedDropIds, configId: result.configId },
        }),
      );
    } catch {
      // El modal queda consumido localmente; si falla el RPC no reabrimos en bucle.
    }
  }, []);

  const closeModal = useCallback(() => {
    if (scratchCards?.id) dismissedRef.current = scratchCards.id;
    setOpen(false);
  }, [scratchCards]);

  const goToPacks = useCallback(() => {
    setOpen(false);
    router.push("/cofres");
  }, [router]);

  if (!open || !scratchCards) return null;
  return (
    <ScratchCardsModal
      allowReplay={false}
      config={scratchCards}
      onClose={closeModal}
      onCompleted={handleCompleted}
      onOpenPacks={goToPacks}
    />
  );
}
