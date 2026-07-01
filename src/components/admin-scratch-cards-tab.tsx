"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { scratchCardsStatusChangedEventName } from "@/components/scratch-cards-gate";
import { useAppContext } from "@/lib/app-context";
import { getSupabaseBrowserClient } from "@/lib/supabase";

type SupabaseRpcClient = {
  rpc: (
    fn: string,
    params?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

type ScratchCardsAdminStatus = {
  active?: boolean;
  active_scratch_card_id?: string | null;
  active_scratch_card_title?: string | null;
  card_count?: number;
  total_attempts?: number;
  updated_at?: string | null;
  win_chance?: number;
};

type ScratchCardsAttemptRow = {
  awarded_drop_ids?: string[];
  cards?: unknown;
  completed_at?: string | null;
  display_name?: string | null;
  packs_awarded?: number;
  scratch_card_id?: string;
  scratch_card_title?: string | null;
  user_id?: string;
  wins?: number;
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

function formatCards(value?: unknown) {
  if (!Array.isArray(value) || !value.length) return "-";
  return value
    .map((card, index) => {
      if (!card || typeof card !== "object") return `R${index + 1}: ?`;
      const row = card as { slots?: unknown; won?: unknown };
      const slots = Array.isArray(row.slots)
        ? row.slots
            .map((slot) => (typeof slot === "string" ? slot : "?"))
            .join("/")
        : "?";
      return `R${index + 1}: ${row.won === true ? "Premio" : "Nada"} (${slots})`;
    })
    .join(" / ");
}

function percent(value?: number) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

export function AdminScratchCardsTab() {
  const { usingSupabase, user } = useAppContext();
  const [status, setStatus] = useState<ScratchCardsAdminStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [statsOpen, setStatsOpen] = useState(false);
  const [attempts, setAttempts] = useState<ScratchCardsAttemptRow[]>([]);
  const [attemptsLoading, setAttemptsLoading] = useState(false);

  const loadStatus = useCallback(async () => {
    if (!usingSupabase || !user?.isAdmin) return;
    const supabase = getSupabaseBrowserClient() as unknown as
      | SupabaseRpcClient
      | null;
    if (!supabase) return;
    const { data, error: statusError } = await supabase.rpc(
      "admin_scratch_cards_status",
    );
    if (statusError) {
      setError(
        isMissingRpcError(statusError)
          ? "Falta aplicar la migracion de Rasca en esta base."
          : statusError.message,
      );
      return;
    }
    setError("");
    setStatus(firstRow<ScratchCardsAdminStatus>(data));
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
        "admin_set_scratch_cards_active",
        { p_active: active },
      );
      if (rpcError) throw new Error(rpcError.message);
      setStatus(firstRow<ScratchCardsAdminStatus>(data));
      window.dispatchEvent(new Event(scratchCardsStatusChangedEventName));
      toast.success(active ? "Rasca activado" : "Rasca pausado");
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "No se ha podido actualizar Rasca.";
      setError(msg);
      toast.error("No se ha podido actualizar Rasca", {
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
        "admin_scratch_cards_attempts",
        { p_scratch_card_id: null },
      );
      if (rpcError) throw new Error(rpcError.message);
      setAttempts(rows<ScratchCardsAttemptRow>(data));
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
        <h3 className="text-xl font-semibold text-white">Rasca sobres</h3>
        <p className="mt-1 text-sm text-zinc-400">
          Scratch cards: cada jugador rasca 5 tarjetas de 3 huecos. Si salen 3
          sobres iguales, el servidor reparte ese sobre privado.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <PrizeCard title="5 rascas" subtitle="Por usuario" />
        <PrizeCard title="3 huecos" subtitle="Match exacto" />
        <PrizeCard
          title={percent(status?.win_chance || 0.33)}
          subtitle="Por rasca"
        />
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-zinc-500">
              {active ? "Activo" : "Pausado"} -{" "}
              {status?.active_scratch_card_title || "RASCA SOBRES"}
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
        <ScratchCardsStatsModal
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

function ScratchCardsStatsModal({
  attempts,
  loading,
  onClose,
  onRefresh,
}: {
  attempts: ScratchCardsAttemptRow[];
  loading: boolean;
  onClose: () => void;
  onRefresh: () => void;
}) {
  return (
    <div
      aria-labelledby="scratch-cards-stats-title"
      aria-modal="true"
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 px-3 py-4 backdrop-blur-sm"
      role="dialog"
    >
      <div className="flex max-h-[86vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#101010] text-white shadow-2xl shadow-black/70">
        <div className="flex flex-col gap-3 border-b border-white/10 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-sky-200">
              Stats Rasca
            </p>
            <h4
              className="mt-1 text-xl font-bold text-white"
              id="scratch-cards-stats-title"
            >
              Rasca sobres
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
                  <th className="px-3 py-2 font-bold">Premios</th>
                  <th className="px-3 py-2 font-bold">Rascas</th>
                  <th className="px-3 py-2 font-bold">Sobres</th>
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
                      {Number(attempt.wins || 0)}
                    </td>
                    <td className="max-w-[420px] px-3 py-2 text-xs text-zinc-300">
                      {formatCards(attempt.cards)}
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
