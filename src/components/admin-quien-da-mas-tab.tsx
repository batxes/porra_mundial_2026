"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { useAppContext } from "@/lib/app-context";
import { getSupabaseBrowserClient } from "@/lib/supabase";

type Status = {
  active?: boolean;
  active_game_title?: string | null;
  total_attempts?: number;
};

type Attempt = {
  awarded_drop_ids?: string[];
  completed_at?: string | null;
  display_name?: string | null;
  score?: number;
  user_id?: string;
};

type RpcClient = {
  rpc: (fn: string, params?: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message: string } | null;
  }>;
};

const firstRow = <T,>(data: unknown) =>
  (Array.isArray(data) ? data[0] : data) as T | null;

const rows = <T,>(data: unknown): T[] =>
  Array.isArray(data) ? (data as T[]) : [];

function formatDate(value?: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  }).format(new Date(value));
}

function awardCount(ids?: string[]) {
  const count = ids?.length || 0;
  return `${count} sobre${count === 1 ? "" : "s"}`;
}

export function AdminQuienDaMasTab() {
  const { usingSupabase, user } = useAppContext();
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [statsOpen, setStatsOpen] = useState(false);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [attemptsLoading, setAttemptsLoading] = useState(false);

  const load = useCallback(async () => {
    if (!usingSupabase || !user?.isAdmin) return;
    const supabase = getSupabaseBrowserClient() as unknown as RpcClient | null;
    if (!supabase) return;
    const { data, error: rpcError } = await supabase.rpc("admin_quien_da_mas_status");
    if (rpcError) {
      setError(rpcError.message.includes("Could not find") ? "Falta aplicar la migración de Quién da más." : rpcError.message);
      return;
    }
    setError("");
    setStatus(firstRow<Status>(data));
  }, [usingSupabase, user?.isAdmin]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const setActive = async (active: boolean) => {
    if (busy) return;
    setBusy(true);
    const supabase = getSupabaseBrowserClient() as unknown as RpcClient | null;
    if (!supabase) return;
    const { data, error: rpcError } = await supabase.rpc("admin_set_quien_da_mas_active", { p_active: active });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      toast.error("No se ha podido actualizar Quién da más", { description: rpcError.message });
      return;
    }
    setStatus(firstRow<Status>(data));
    toast.success(active ? "Quién da más activado" : "Quién da más pausado");
  };

  const loadAttempts = useCallback(async () => {
    if (!usingSupabase || !user?.isAdmin) return;
    const supabase = getSupabaseBrowserClient() as unknown as RpcClient | null;
    if (!supabase) return;
    setAttemptsLoading(true);
    try {
      const { data, error: rpcError } = await supabase.rpc("admin_quien_da_mas_attempts", { p_game_id: null });
      if (rpcError) throw new Error(rpcError.message);
      setAttempts(rows<Attempt>(data));
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se han podido cargar los intentos.";
      toast.error("No se han podido cargar los intentos", { description: message });
    } finally {
      setAttemptsLoading(false);
    }
  }, [usingSupabase, user?.isAdmin]);

  const active = Boolean(status?.active);
  return <div className="space-y-4">
    <div><h3 className="text-xl font-semibold text-white">¿Quién da más?</h3><p className="mt-1 text-sm text-zinc-400">12 comparaciones, 10 segundos por duelo, sin vidas y sobres privados cada 3 aciertos.</p></div>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {["3 · Medios", "6 · Delanteros", "9 · Defensas", "12 · Estrellas"].map((item) => <div key={item} className="rounded-xl border border-white/10 bg-black/18 px-3 py-3 text-sm font-bold text-white">{item}</div>)}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div><p className="text-xs font-bold uppercase tracking-[0.22em] text-zinc-500">{active ? "Activo" : "Pausado"} · {status?.active_game_title || "¿QUIÉN DA MÁS?"}</p><p className="mt-1 text-sm text-zinc-300">{Number(status?.total_attempts || 0)} intentos completados</p></div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => { setStatsOpen(true); setAttempts([]); void loadAttempts(); }} className="rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-white transition hover:bg-white/10">Ver intentos</button>
        <button type="button" disabled={busy || !usingSupabase} onClick={() => void setActive(!active)} className={`rounded-lg px-4 py-2 text-xs font-bold transition disabled:opacity-60 ${active ? "border border-white/10 text-white hover:bg-white/10" : "bg-lime-300 text-black hover:bg-lime-200"}`}>{busy ? "Guardando..." : active ? "Pausar" : "Activar"}</button>
      </div>
    </div>
    {error ? <p className="text-xs font-semibold text-rose-300">{error}</p> : null}
    {statsOpen ? <QuienDaMasStatsModal attempts={attempts} loading={attemptsLoading} onClose={() => setStatsOpen(false)} onRefresh={() => void loadAttempts()} /> : null}
  </div>;
}

function QuienDaMasStatsModal({ attempts, loading, onClose, onRefresh }: { attempts: Attempt[]; loading: boolean; onClose: () => void; onRefresh: () => void }) {
  return <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 px-3 py-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="quiendamas-stats-title">
    <div className="flex max-h-[86vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-lime-300/20 bg-[#091006] text-white shadow-2xl shadow-black/70">
      <div className="flex flex-col gap-3 border-b border-white/10 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-lime-200">Stats Quién da más</p><h4 id="quiendamas-stats-title" className="mt-1 text-xl font-bold text-white">Intentos del juego</h4><p className="mt-1 text-xs text-zinc-400">{loading ? "Cargando intentos..." : `${attempts.length} intento${attempts.length === 1 ? "" : "s"}`}</p></div>
        <div className="flex gap-2"><button type="button" disabled={loading} onClick={onRefresh} className="rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-white transition hover:bg-white/10 disabled:opacity-60">Actualizar</button><button type="button" onClick={onClose} className="rounded-lg bg-white px-3 py-2 text-xs font-bold text-black transition hover:bg-zinc-200">Cerrar</button></div>
      </div>
      <div className="min-h-0 overflow-auto">
        {attempts.length ? <table className="w-full min-w-[590px] text-left text-sm"><thead className="sticky top-0 bg-[#12210b] text-[11px] uppercase tracking-[0.12em] text-zinc-400"><tr><th className="px-3 py-2 font-bold">Usuario</th><th className="px-3 py-2 font-bold">Aciertos</th><th className="px-3 py-2 font-bold">Premios</th><th className="px-3 py-2 font-bold">Fecha</th></tr></thead><tbody className="divide-y divide-white/10">{attempts.map((attempt) => <tr key={`${attempt.user_id}-${attempt.completed_at}`}><td className="px-3 py-2 font-semibold text-white">{attempt.display_name || "Usuario"}</td><td className="px-3 py-2 font-bold text-lime-200">{Number(attempt.score || 0)}/12</td><td className="px-3 py-2 text-zinc-300">{awardCount(attempt.awarded_drop_ids)}</td><td className="px-3 py-2 text-zinc-400">{formatDate(attempt.completed_at)}</td></tr>)}</tbody></table> : <p className="px-4 py-8 text-center text-sm text-zinc-400">{loading ? "Cargando intentos..." : "Aún no hay intentos completados."}</p>}
      </div>
    </div>
  </div>;
}
