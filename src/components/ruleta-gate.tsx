"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  RuletaModal,
  type RuletaConfig,
  type RuletaSegment,
  type RuletaSpinResult,
  ruletaCompletedEventName,
} from "@/components/ruleta-modal";
import { useAppContext } from "@/lib/app-context";
import { getSupabaseBrowserClient } from "@/lib/supabase";

type RuletaStatusRow = {
  active?: boolean;
  completed?: boolean;
  ruleta_id?: string;
  segments?: unknown;
  title?: string;
};

type RuletaRpcClient = {
  rpc: (
    fn: string,
    params?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

function firstRow<T>(data: unknown): T | null {
  return Array.isArray(data) ? ((data[0] as T | undefined) ?? null) : (data as T);
}

function parseSegments(value: unknown): RuletaSegment[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as { label?: unknown; pool?: unknown; title?: unknown };
      if (typeof row.label !== "string") return null;
      return {
        label: row.label,
        pool: typeof row.pool === "string" ? row.pool : null,
        title: typeof row.title === "string" ? row.title : row.label,
      } satisfies RuletaSegment;
    })
    .filter((item): item is RuletaSegment => Boolean(item));
}

function ruletaConfigFromStatus(status: RuletaStatusRow | null) {
  if (!status?.ruleta_id) return null;
  const segments = parseSegments(status.segments);
  if (segments.length < 2) return null;
  return {
    id: status.ruleta_id,
    segments,
    title: status.title || "RULETA DE SOBRES",
  } satisfies RuletaConfig;
}

export function RuletaGate() {
  const router = useRouter();
  const { ready, usingSupabase, user } = useAppContext();
  const [open, setOpen] = useState(false);
  const [ruleta, setRuleta] = useState<RuletaConfig | null>(null);
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
      | RuletaRpcClient
      | null;
    if (!supabase) return;
    const { data, error } = await supabase.rpc("ruleta_status");
    if (error) return;
    const status = firstRow<RuletaStatusRow>(data);
    const nextRuleta = ruletaConfigFromStatus(status);
    const alreadyCompletedHere =
      Boolean(nextRuleta?.id) && completedRef.current === nextRuleta?.id;
    const dismissedHere =
      Boolean(nextRuleta?.id) && dismissedRef.current === nextRuleta?.id;
    const shouldOpen = Boolean(
      status?.active &&
        !status.completed &&
        nextRuleta &&
        !alreadyCompletedHere &&
        !dismissedHere,
    );
    setRuleta(nextRuleta);
    // Un refresco de estado (intervalo/foco) NO debe cerrar un modal ya abierto:
    // tras girar, el servidor marca completed=true y el siguiente poll lo
    // desmontaba de golpe, cortando el premio. Abrimos cuando toca; si ya está
    // abierto, lo mantenemos mientras la ruleta siga activa (lo cierra el usuario
    // con closeModal/onOpenPacks, o se cierra si el admin pausa la ruleta).
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

  const handleCompleted = useCallback((result: RuletaSpinResult) => {
    completedRef.current = result.ruletaId;
    window.dispatchEvent(
      new CustomEvent(ruletaCompletedEventName, { detail: result }),
    );
  }, []);

  const closeModal = useCallback(() => {
    if (ruleta?.id) dismissedRef.current = ruleta.id;
    setOpen(false);
  }, [ruleta]);

  const goToPacks = useCallback(() => {
    setOpen(false);
    router.push("/cofres");
  }, [router]);

  if (!open || !ruleta) return null;
  return (
    <RuletaModal
      onClose={closeModal}
      onCompleted={handleCompleted}
      onOpenPacks={goToPacks}
      ruleta={ruleta}
    />
  );
}
