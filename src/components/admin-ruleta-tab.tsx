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

type RuletaAdminStatus = {
  active?: boolean;
  active_ruleta_id?: string | null;
  active_ruleta_title?: string | null;
  total_attempts?: number;
  updated_at?: string | null;
};

type RuletaAttemptRow = {
  display_name?: string | null;
  prize_label?: string | null;
  prize_pool?: string | null;
  awarded_drop_ids?: string[];
  spun_at?: string | null;
};

function firstRow<T>(data: unknown): T | null {
  return Array.isArray(data) ? ((data[0] as T | undefined) ?? null) : (data as T);
}

function rows<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
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

export function AdminRuletaTab() {
  const { usingSupabase, user } = useAppContext();
  const [status, setStatus] = useState<RuletaAdminStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [statsOpen, setStatsOpen] = useState(false);
  const [attempts, setAttempts] = useState<RuletaAttemptRow[]>([]);
  const [attemptsLoading, setAttemptsLoading] = useState(false);

  const loadStatus = useCallback(async () => {
    if (!usingSupabase || !user?.isAdmin) return;
    const supabase = getSupabaseBrowserClient() as unknown as
      | SupabaseRpcClient
      | null;
    if (!supabase) return;
    const { data, error: statusError } = await supabase.rpc(
      "admin_ruleta_status",
    );
    if (statusError) {
      setError(
        statusError.message.includes("Could not find the function") ||
          statusError.message.includes("schema cache")
          ? "Falta aplicar la migracion de la ruleta en esta base."
          : statusError.message,
      );
      return;
    }
    setError("");
    setStatus(firstRow<RuletaAdminStatus>(data));
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
        "admin_set_ruleta_active",
        { p_active: active },
      );
      if (rpcError) throw new Error(rpcError.message);
      setStatus(firstRow<RuletaAdminStatus>(data));
      toast.success(active ? "Ruleta activada" : "Ruleta pausada");
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "No se ha podido actualizar la ruleta.";
      setError(msg);
      toast.error("No se ha podido actualizar la ruleta", { description: msg });
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
        "admin_ruleta_attempts",
        { p_ruleta_id: null },
      );
      if (rpcError) throw new Error(rpcError.message);
      setAttempts(rows<RuletaAttemptRow>(data));
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "No se han podido cargar los giros.";
      toast.error("No se han podido cargar los giros", { description: msg });
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
        <h3 className="text-xl font-semibold text-white">Ruleta de sobres</h3>
        <p className="mt-1 text-sm text-zinc-400">
          Minijuego que lanzas tú: cada jugador gira una vez y el servidor
          reparte el sobre. Aparece como modal mientras esté activa.
        </p>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-zinc-500">
              {active ? "Activa" : "Pausada"} —{" "}
              {status?.active_ruleta_title || "Ruleta de sobres"}
            </p>
            <p className="mt-1 text-sm text-zinc-300">
              {Number(status?.total_attempts || 0)} giros completados
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={openStats}
              className="rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-white transition hover:bg-white/10"
            >
              Ver giros
            </button>
            <button
              type="button"
              disabled={busy || !usingSupabase}
              onClick={() => void setActive(!active)}
              className={`rounded-lg px-4 py-2 text-xs font-bold transition disabled:opacity-60 ${
                active
                  ? "border border-white/10 text-white hover:bg-white/10"
                  : "bg-[#a7f600] text-black hover:bg-[#c7ff43]"
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
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 px-3 py-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ruleta-stats-title"
        >
          <div className="flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#101010] text-white shadow-2xl shadow-black/70">
            <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-200">
                  Stats ruleta
                </p>
                <p className="mt-1 text-xs text-zinc-400">
                  {attemptsLoading
                    ? "Cargando giros..."
                    : `${attempts.length} giro${attempts.length === 1 ? "" : "s"}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setStatsOpen(false)}
                className="rounded-lg bg-white px-3 py-2 text-xs font-bold text-black transition hover:bg-zinc-200"
              >
                Cerrar
              </button>
            </div>
            <div className="min-h-0 overflow-auto">
              {attempts.length ? (
                <table className="w-full min-w-[480px] text-left text-sm">
                  <thead className="sticky top-0 bg-[#171717] text-[11px] uppercase tracking-[0.12em] text-zinc-400">
                    <tr>
                      <th className="px-3 py-2 font-bold">Usuario</th>
                      <th className="px-3 py-2 font-bold">Premio</th>
                      <th className="px-3 py-2 font-bold">Fecha</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {attempts.map((attempt, index) => {
                      const won = Boolean(attempt.prize_pool);
                      return (
                        <tr key={`${attempt.display_name}-${index}`}>
                          <td className="px-3 py-2 font-semibold text-white">
                            {attempt.display_name || "Usuario"}
                          </td>
                          <td
                            className={`px-3 py-2 font-bold ${
                              won ? "text-[#a7f600]" : "text-zinc-500"
                            }`}
                          >
                            {won ? attempt.prize_label || "Sobre" : "Casi"}
                          </td>
                          <td className="px-3 py-2 text-zinc-400">
                            {formatDate(attempt.spun_at)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <p className="px-4 py-8 text-center text-sm text-zinc-400">
                  {attemptsLoading
                    ? "Cargando giros..."
                    : "Aún no hay giros."}
                </p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
