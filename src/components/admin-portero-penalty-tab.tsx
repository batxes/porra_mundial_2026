"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { useAppContext } from "@/lib/app-context";
import { getSupabaseBrowserClient } from "@/lib/supabase";

type SupabaseRpcClient = {
  rpc: (
    fn: string,
    params?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

type PorteroPenaltyAdminStatus = {
  active?: boolean;
  active_portero_penalty_id?: string | null;
  active_portero_penalty_title?: string | null;
  total_attempts?: number;
  updated_at?: string | null;
};

type PorteroPenaltyAttemptRow = {
  awarded_drop_ids?: string[];
  completed_at?: string | null;
  display_name?: string | null;
  goals?: number;
  packs_awarded?: number;
  portero_penalty_id?: string;
  portero_penalty_title?: string | null;
  saves?: number;
  shots?: unknown;
  total_shots?: number;
  user_id?: string;
};

function firstRow<T>(data: unknown): T | null {
  return Array.isArray(data) ? ((data[0] as T | undefined) ?? null) : (data as T);
}

function rows<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

function isMissingRpcError(error: { message: string } | null | undefined) {
  const message = error?.message || "";
  return (
    message.includes("Could not find the function") ||
    message.includes("schema cache")
  );
}

function formatDate(value?: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  }).format(new Date(value));
}

function formatAwardCount(ids?: string[]) {
  const count = ids?.length || 0;
  return `${count} sobre${count === 1 ? "" : "s"}`;
}

const DIRECTION_LABELS: Record<string, string> = {
  center: "Centro",
  left: "Izq.",
  right: "Der.",
};

function formatShots(shots?: unknown) {
  if (!Array.isArray(shots) || !shots.length) return "-";
  return shots
    .map((shot, index) => {
      if (!shot || typeof shot !== "object") return `${index + 1}: ?`;
      const row = shot as { choice?: unknown; saved?: unknown; shot?: unknown };
      const target =
        typeof row.shot === "string"
          ? DIRECTION_LABELS[row.shot] || row.shot
          : "?";
      const choice =
        typeof row.choice === "string"
          ? DIRECTION_LABELS[row.choice] || row.choice
          : "?";
      const result = row.saved === true ? "Parada" : "Gol";
      return `${index + 1}: ${result} (${choice} vs ${target})`;
    })
    .join(" / ");
}

export function AdminPorteroPenaltyTab() {
  const { usingSupabase, user } = useAppContext();
  const [status, setStatus] = useState<PorteroPenaltyAdminStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [statsOpen, setStatsOpen] = useState(false);
  const [attempts, setAttempts] = useState<PorteroPenaltyAttemptRow[]>([]);
  const [attemptsLoading, setAttemptsLoading] = useState(false);

  const loadStatus = useCallback(async () => {
    if (!usingSupabase || !user?.isAdmin) return;
    const supabase = getSupabaseBrowserClient() as unknown as
      | SupabaseRpcClient
      | null;
    if (!supabase) return;
    const { data, error: statusError } = await supabase.rpc(
      "admin_portero_penalty_status",
    );
    if (statusError) {
      setError(
        isMissingRpcError(statusError)
          ? "Falta aplicar la migracion de Portero en esta base."
          : statusError.message,
      );
      return;
    }
    setError("");
    setStatus(firstRow<PorteroPenaltyAdminStatus>(data));
  }, [usingSupabase, user?.isAdmin]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadStatus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadStatus]);

  const setActive = async (active: boolean) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (!usingSupabase || !user?.isAdmin) {
        throw new Error("Solo disponible con Supabase y usuario admin.");
      }
      const supabase = getSupabaseBrowserClient() as unknown as
        | SupabaseRpcClient
        | null;
      if (!supabase) throw new Error("No se ha podido conectar con Supabase.");
      const { data, error: rpcError } = await supabase.rpc(
        "admin_set_portero_penalty_active",
        { p_active: active },
      );
      if (rpcError) throw new Error(rpcError.message);
      setStatus(firstRow<PorteroPenaltyAdminStatus>(data));
      toast.success(active ? "Portero activado" : "Portero pausado");
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "No se ha podido actualizar Portero.";
      setError(msg);
      toast.error("No se ha podido actualizar Portero", {
        description: msg,
      });
    } finally {
      setBusy(false);
    }
  };

  const loadAttempts = useCallback(async () => {
    if (!usingSupabase || !user?.isAdmin) return;
    const supabase = getSupabaseBrowserClient() as unknown as
      | SupabaseRpcClient
      | null;
    if (!supabase) return;
    setAttemptsLoading(true);
    try {
      const { data, error: rpcError } = await supabase.rpc(
        "admin_portero_penalty_attempts",
        { p_portero_penalty_id: null },
      );
      if (rpcError) throw new Error(rpcError.message);
      setAttempts(rows<PorteroPenaltyAttemptRow>(data));
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "No se han podido cargar los intentos.";
      toast.error("No se han podido cargar los intentos", { description: msg });
    } finally {
      setAttemptsLoading(false);
    }
  }, [usingSupabase, user?.isAdmin]);

  const openStats = () => {
    setStatsOpen(true);
    setAttempts([]);
    void loadAttempts();
  };

  const active = Boolean(status?.active);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-xl font-semibold text-white">Portero</h3>
        <p className="mt-1 text-sm text-zinc-400">
          Minijuego Marrero bajo palos: cada jugador tiene una tanda de 5
          penaltis y el servidor reparte sobres de portero segun sus paradas.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <PrizeCard title="Sobre Porteros" subtitle="1+ paradas" />
        <PrizeCard title="Sobre Porteros" subtitle="2+ paradas" />
        <PrizeCard title="Sobre Porteros" subtitle="4+ paradas" />
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-zinc-500">
              {active ? "Activo" : "Pausado"} -{" "}
              {status?.active_portero_penalty_title || "MARRERO BAJO PALOS"}
            </p>
            <p className="mt-1 text-sm text-zinc-300">
              {Number(status?.total_attempts || 0)} intentos completados
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={openStats}
              className="rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-white transition hover:bg-white/10"
            >
              Ver intentos
            </button>
            <button
              type="button"
              disabled={busy || !usingSupabase}
              onClick={() => void setActive(!active)}
              className={`rounded-lg px-4 py-2 text-xs font-bold transition disabled:opacity-60 ${
                active
                  ? "border border-white/10 text-white hover:bg-white/10"
                  : "bg-[#7dd3fc] text-black hover:bg-white"
              }`}
            >
              {busy ? "Guardando..." : active ? "Pausar" : "Activar"}
            </button>
          </div>
        </div>
        {error ? (
          <p className="mt-3 text-xs font-semibold text-rose-300">{error}</p>
        ) : null}
      </div>

      {statsOpen ? (
        <PorteroPenaltyStatsModal
          attempts={attempts}
          loading={attemptsLoading}
          onClose={() => setStatsOpen(false)}
          onRefresh={() => void loadAttempts()}
        />
      ) : null}
    </div>
  );
}

function PrizeCard({ subtitle, title }: { subtitle: string; title: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/18 px-3 py-3">
      <p className="text-sm font-bold text-white">{title}</p>
      <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.14em] text-sky-200">
        {subtitle}
      </p>
    </div>
  );
}

function PorteroPenaltyStatsModal({
  attempts,
  loading,
  onClose,
  onRefresh,
}: {
  attempts: PorteroPenaltyAttemptRow[];
  loading: boolean;
  onClose: () => void;
  onRefresh: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 px-3 py-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="portero-penalty-stats-title"
    >
      <div className="flex max-h-[86vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#101010] text-white shadow-2xl shadow-black/70">
        <div className="flex flex-col gap-3 border-b border-white/10 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-sky-200">
              Stats Portero
            </p>
            <h4
              id="portero-penalty-stats-title"
              className="mt-1 text-xl font-bold text-white"
            >
              Marrero bajo palos
            </h4>
            <p className="mt-1 text-xs text-zinc-400">
              {loading
                ? "Cargando intentos..."
                : `${attempts.length} intento${attempts.length === 1 ? "" : "s"}`}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={loading}
              onClick={onRefresh}
              className="rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-white transition hover:bg-white/10 disabled:opacity-60"
            >
              Actualizar
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-white px-3 py-2 text-xs font-bold text-black transition hover:bg-zinc-200"
            >
              Cerrar
            </button>
          </div>
        </div>

        <div className="min-h-0 overflow-auto">
          {attempts.length ? (
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="sticky top-0 bg-[#171717] text-[11px] uppercase tracking-[0.12em] text-zinc-400">
                <tr>
                  <th className="px-3 py-2 font-bold">Usuario</th>
                  <th className="px-3 py-2 font-bold">Paradas</th>
                  <th className="px-3 py-2 font-bold">Tanda</th>
                  <th className="px-3 py-2 font-bold">Premios</th>
                  <th className="px-3 py-2 font-bold">Fecha</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {attempts.map((attempt) => (
                  <tr key={`${attempt.user_id}-${attempt.completed_at}`}>
                    <td className="px-3 py-2 font-semibold text-white">
                      {attempt.display_name || "Usuario"}
                    </td>
                    <td className="px-3 py-2 font-bold text-[#7dd3fc]">
                      {Number(attempt.saves || 0)}/
                      {Number(attempt.total_shots || 5)}
                    </td>
                    <td className="max-w-[360px] px-3 py-2 text-xs text-zinc-300">
                      {formatShots(attempt.shots)}
                    </td>
                    <td className="px-3 py-2 text-zinc-300">
                      {formatAwardCount(attempt.awarded_drop_ids)}
                    </td>
                    <td className="px-3 py-2 text-zinc-400">
                      {formatDate(attempt.completed_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="px-4 py-8 text-center text-sm text-zinc-400">
              {loading
                ? "Cargando intentos..."
                : "Aun no hay intentos completados."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
