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
type RpcClient = {
  rpc: (fn: string, params?: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message: string } | null;
  }>;
};
const firstRow = <T,>(data: unknown) =>
  (Array.isArray(data) ? data[0] : data) as T | null;

export function AdminSanFerminTab() {
  const { usingSupabase, user } = useAppContext();
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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

  const active = Boolean(status?.active);
  return <div className="space-y-4">
    <div><h3 className="text-xl font-semibold text-white">San Fermín Rush</h3><p className="mt-1 text-sm text-zinc-400">Encierro de 160 m: 15 vallas, tres vidas y sobres privados por hito.</p></div>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {["40 m · Defensa", "80 m · Mediocentro", "120 m · Delantero", "160 m · Estrellas"].map((item) => <div key={item} className="rounded-xl border border-white/10 bg-black/18 px-3 py-3 text-sm font-bold text-white">{item}</div>)}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div><p className="text-xs font-bold uppercase tracking-[0.22em] text-zinc-500">{active ? "Activo" : "Pausado"} · {status?.active_sanfermin_title || "SAN FERMIN RUSH"}</p><p className="mt-1 text-sm text-zinc-300">{Number(status?.total_attempts || 0)} intentos completados</p></div>
      <button type="button" disabled={busy || !usingSupabase} onClick={() => void setActive(!active)} className={`rounded-lg px-4 py-2 text-xs font-bold transition disabled:opacity-60 ${active ? "border border-white/10 text-white hover:bg-white/10" : "bg-red-500 text-white hover:bg-red-400"}`}>{busy ? "Guardando..." : active ? "Pausar" : "Activar"}</button>
    </div>
    {error ? <p className="text-xs font-semibold text-rose-300">{error}</p> : null}
  </div>;
}
