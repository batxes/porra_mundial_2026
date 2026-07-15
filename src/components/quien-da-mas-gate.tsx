"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  QuienDaMasModal,
  type QuienDaMasConfig,
  type QuienDaMasDuel,
  type QuienDaMasFormat,
  type QuienDaMasResult,
  type QuienDaMasReward,
  type QuienDaMasSide,
} from "@/components/quien-da-mas-modal";
import { useAppContext } from "@/lib/app-context";
import { notifyCardsChanged } from "@/lib/cofres";
import { getSupabaseBrowserClient } from "@/lib/supabase";

type StatusRow = {
  active?: boolean;
  completed?: boolean;
  duel_time_ms?: number;
  duels?: unknown;
  game_id?: string;
  rewards?: unknown;
  title?: string;
};

type CompletionRow = {
  awarded_drop_ids?: string[];
  game_id?: string;
  score?: number;
};

type RpcClient = {
  auth: { getSession: () => Promise<{ data: { session: { user?: unknown } | null } }> };
  rpc: (fn: string, params?: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message: string } | null;
  }>;
};

const PACK_META: Record<string, { image: string; title: string }> = {
  medios: { image: "/sobre-medios.webp", title: "Sobre Medios" },
  delanteros: { image: "/sobre-delanteros.webp", title: "Sobre Delanteros" },
  defensas: { image: "/sobre-defensas.webp", title: "Sobre Defensas" },
  stars: { image: "/sobre-estrellas.webp", title: "Sobre Estrellas" },
};

const FORMATS = new Set<QuienDaMasFormat>([
  "age",
  "compact",
  "currency",
  "height",
  "int",
]);

function firstRow<T>(data: unknown): T | null {
  return Array.isArray(data) ? ((data[0] as T | undefined) ?? null) : (data as T);
}

function parseSide(value: unknown): QuienDaMasSide | null {
  if (!value || typeof value !== "object") return null;
  const side = value as Record<string, unknown>;
  if (
    typeof side.id !== "string" ||
    typeof side.name !== "string" ||
    !Number.isFinite(Number(side.value))
  ) return null;
  return {
    id: side.id,
    image: typeof side.image === "string" ? side.image : undefined,
    name: side.name,
    teamCode: typeof side.teamCode === "string" ? side.teamCode : undefined,
    teamName: typeof side.teamName === "string" ? side.teamName : undefined,
    value: Number(side.value),
  };
}

function parseDuels(value: unknown): QuienDaMasDuel[] {
  if (!Array.isArray(value)) return [];
  const duels = value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const a = parseSide(row.a);
    const b = parseSide(row.b);
    const format = typeof row.format === "string" && FORMATS.has(row.format as QuienDaMasFormat)
      ? row.format as QuienDaMasFormat
      : "int";
    if (!a || !b || typeof row.id !== "string" || typeof row.question !== "string" || typeof row.metricLabel !== "string") return [];
    return [{ a, b, format, id: row.id, metricLabel: row.metricLabel, question: row.question }];
  });
  return duels.length === 12 ? duels : [];
}

function parseRewards(value: unknown): QuienDaMasReward[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const pool = typeof row.pool === "string" ? row.pool : "";
    const meta = PACK_META[pool];
    const minScore = Number(row.minScore);
    if (!meta || !Number.isInteger(minScore)) return [];
    return [{
      image: meta.image,
      minScore,
      pool,
      title: typeof row.title === "string" ? row.title : meta.title,
    }];
  });
}

function configFromStatus(status: StatusRow | null): QuienDaMasConfig | null {
  if (!status?.game_id) return null;
  const duels = parseDuels(status.duels);
  const rewards = parseRewards(status.rewards);
  if (!duels.length || !rewards.length) return null;
  return {
    duelTimeMs: Math.max(5_000, Math.min(30_000, Number(status.duel_time_ms) || 10_000)),
    duels,
    id: status.game_id,
    rewards,
    title: status.title || "¿QUIÉN DA MÁS?",
  };
}

export function QuienDaMasGate() {
  const router = useRouter();
  const { ready, usingSupabase, user } = useAppContext();
  const [config, setConfig] = useState<QuienDaMasConfig | null>(null);
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

    const { data, error } = await supabase.rpc("quien_da_mas_status");
    if (error) return;
    const status = firstRow<StatusRow>(data);
    const next = configFromStatus(status);
    const blocked = !next || completedRef.current === next.id || dismissedRef.current === next.id;
    setConfig(next);
    setOpen(Boolean(status?.active && !status.completed && !blocked));
  }, [ready, usingSupabase, user]);

  useEffect(() => {
    const initialCheck = window.setTimeout(() => void checkStatus(), 0);
    const interval = window.setInterval(() => void checkStatus(), 30_000);
    window.addEventListener("focus", checkStatus);
    return () => {
      window.clearTimeout(initialCheck);
      window.clearInterval(interval);
      window.removeEventListener("focus", checkStatus);
    };
  }, [checkStatus]);

  const complete = useCallback(async (result: QuienDaMasResult) => {
    const supabase = getSupabaseBrowserClient() as unknown as RpcClient | null;
    if (!supabase) throw new Error("No se ha podido conectar con el juego.");
    const { data, error } = await supabase.rpc("complete_quien_da_mas", {
      p_game_id: result.configId,
      p_picks: result.picks,
    });
    if (error) throw new Error(error.message);
    const completion = firstRow<CompletionRow>(data);
    if (!completion?.game_id || !Number.isInteger(Number(completion.score))) {
      throw new Error("La partida no ha devuelto un resultado válido.");
    }
    completedRef.current = completion.game_id;
    notifyCardsChanged();
    const awardedDropIds = Array.isArray(completion.awarded_drop_ids)
      ? completion.awarded_drop_ids
      : [];
    return {
      awardedDropIds,
      correct: Number(completion.score),
      packs: awardedDropIds.length,
    };
  }, []);

  if (!open || !config) return null;
  return (
    <QuienDaMasModal
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
