"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { useAppContext } from "@/lib/app-context";
import { getSupabaseBrowserClient } from "@/lib/supabase";

type Status = {
  active?: boolean;
  active_sanfermin_title?: string | null;
  total_attempts?: number;
};

type Attempt = {
  awarded_drop_ids?: string[];
  completed_at?: string | null;
  display_name?: string | null;
  meters_reached?: number;
  reached_goal?: boolean;
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

export function AdminSanFerminTab() {
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
    const { data, error: rpcError } = await supabase.rpc("admin_sanfermin_status");
    if (rpcError) {
      setError(rpcError.message.includes("Could not find") ? "Falta aplicar la migración de San Fermín." : rpcError.message);
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
    const { data, error: rpcError } = await supabase.rpc("admin_set_sanfermin_active", { p_active: active });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      toast.error("No se ha podido actualizar San Fermín", { description: rpcError.message });
      return;
    }
    setStatus(firstRow<Status>(data));
    toast.success(active ? "San Fermín activado" : "San Fermín pausado");
  };

  const loadAttempts = useCallback(async () => {
    if (!usingSupabase || !user?.isAdmin) return;
    const supabase = getSupabaseBrowserClient() as unknown as RpcClient | null;
    if (!supabase) return;
    setAttemptsLoading(true);
    try {
      const { data, error: rpcError } = await supabase.rpc("admin_sanfermin_attempts", { p_sanfermin_id: null });
      if (rpcError) throw new Error(rpcError.message);
      setAttempts(rows<Attempt>(data));
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se han podido cargar los intentos.";
      toast.error("No se han podido cargar los intentos", { description: message });
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
  return <div className="space-y-4">
    <div><h3 className="text-xl font-semibold text-white">San Fermín Rush</h3><p className="mt-1 text-sm text-zinc-400">Encierro de 160 m: 15 vallas, cinco vidas y sobres privados por hito.</p></div>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {["40 m · Defensa", "80 m · Mediocentro", "120 m · Delantero", "160 m · Estrellas"].map((item) => <div key={item} className="rounded-xl border border-white/10 bg-black/18 px-3 py-3 text-sm font-bold text-white">{item}</div>)}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div><p className="text-xs font-bold uppercase tracking-[0.22em] text-zinc-500">{active ? "Activo" : "Pausado"} · {status?.active_sanfermin_title || "SAN FERMIN RUSH"}</p><p className="mt-1 text-sm text-zinc-300">{Number(status?.total_attempts || 0)} intentos completados</p></div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={openStats} className="rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-white transition hover:bg-white/10">Ver intentos</button>
        <button type="button" disabled={busy || !usingSupabase} onClick={() => void setActive(!active)} className={`rounded-lg px-4 py-2 text-xs font-bold transition disabled:opacity-60 ${active ? "border border-white/10 text-white hover:bg-white/10" : "bg-red-500 text-white hover:bg-red-400"}`}>{busy ? "Guardando..." : active ? "Pausar" : "Activar"}</button>
      </div>
    </div>
    {error ? <p className="text-xs font-semibold text-rose-300">{error}</p> : null}
    {statsOpen ? <SanFerminStatsModal attempts={attempts} loading={attemptsLoading} onClose={() => setStatsOpen(false)} onRefresh={() => void loadAttempts()} /> : null}
  </div>;
}

function SanFerminStatsModal({ attempts, loading, onClose, onRefresh }: { attempts: Attempt[]; loading: boolean; onClose: () => void; onRefresh: () => void }) {
  return <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 px-3 py-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="sanfermin-stats-title">
    <div className="flex max-h-[86vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#160809] text-white shadow-2xl shadow-black/70">
      <div className="flex flex-col gap-3 border-b border-white/10 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-red-200">Stats San Fermín</p><h4 id="sanfermin-stats-title" className="mt-1 text-xl font-bold text-white">Intentos del encierro</h4><p className="mt-1 text-xs text-zinc-400">{loading ? "Cargando intentos..." : `${attempts.length} intento${attempts.length === 1 ? "" : "s"}`}</p></div>
        <div className="flex gap-2"><button type="button" disabled={loading} onClick={onRefresh} className="rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-white transition hover:bg-white/10 disabled:opacity-60">Actualizar</button><button type="button" onClick={onClose} className="rounded-lg bg-white px-3 py-2 text-xs font-bold text-black transition hover:bg-zinc-200">Cerrar</button></div>
      </div>
      <div className="min-h-0 overflow-auto">
        {attempts.length ? <table className="w-full min-w-[620px] text-left text-sm"><thead className="sticky top-0 bg-[#211010] text-[11px] uppercase tracking-[0.12em] text-zinc-400"><tr><th className="px-3 py-2 font-bold">Usuario</th><th className="px-3 py-2 font-bold">Distancia</th><th className="px-3 py-2 font-bold">Meta</th><th className="px-3 py-2 font-bold">Premios</th><th className="px-3 py-2 font-bold">Fecha</th></tr></thead><tbody className="divide-y divide-white/10">{attempts.map((attempt) => <tr key={`${attempt.user_id}-${attempt.completed_at}`}><td className="px-3 py-2 font-semibold text-white">{attempt.display_name || "Usuario"}</td><td className="px-3 py-2 font-bold text-red-200">{Number(attempt.meters_reached || 0)} m</td><td className="px-3 py-2 text-zinc-300">{attempt.reached_goal ? "Sí" : "-"}</td><td className="px-3 py-2 text-zinc-300">{awardCount(attempt.awarded_drop_ids)}</td><td className="px-3 py-2 text-zinc-400">{formatDate(attempt.completed_at)}</td></tr>)}</tbody></table> : <p className="px-4 py-8 text-center text-sm text-zinc-400">{loading ? "Cargando intentos..." : "Aún no hay intentos completados."}</p>}
      </div>
    </div>
  </div>;
}
