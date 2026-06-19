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

type MaintenanceStatus = {
  maintenance?: boolean;
  maintenance_message?: string | null;
};

function firstRow<T>(data: unknown): T | null {
  return Array.isArray(data) ? ((data[0] as T | undefined) ?? null) : (data as T);
}

export function AdminMaintenanceTab() {
  const { usingSupabase, user } = useAppContext();
  const [status, setStatus] = useState<MaintenanceStatus | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadStatus = useCallback(async () => {
    if (!usingSupabase || !user?.isAdmin) return;
    const supabase = getSupabaseBrowserClient() as unknown as
      | SupabaseRpcClient
      | null;
    if (!supabase) return;
    const { data, error: statusError } = await supabase.rpc(
      "maintenance_status",
    );
    if (statusError) {
      setError(
        statusError.message.includes("Could not find the function") ||
          statusError.message.includes("schema cache")
          ? "Falta aplicar la migración de mantenimiento en esta base."
          : statusError.message,
      );
      return;
    }
    setError("");
    const row = firstRow<MaintenanceStatus>(data);
    setStatus(row);
    setMessage(row?.maintenance_message || "");
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
        "admin_set_maintenance",
        { p_active: active, p_message: message.trim() || null },
      );
      if (rpcError) throw new Error(rpcError.message);
      setStatus(firstRow<MaintenanceStatus>(data));
      toast.success(active ? "Mantenimiento activado" : "Web reactivada");
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "No se ha podido actualizar el mantenimiento.";
      setError(msg);
      toast.error("No se ha podido actualizar", { description: msg });
    } finally {
      setBusy(false);
    }
  };

  const active = Boolean(status?.maintenance);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-xl font-semibold text-white">Modo mantenimiento</h3>
        <p className="mt-1 text-sm text-zinc-400">
          Con esto activo, todos los usuarios (menos tú, admin) ven una pantalla
          de mantenimiento y no pueden usar la web. Úsalo si algo falla en
          producción.
        </p>
      </div>

      <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p
            className={`text-xs font-bold uppercase tracking-[0.18em] ${
              active ? "text-rose-300" : "text-zinc-500"
            }`}
          >
            {active
              ? "Activo · la web está caída para los usuarios"
              : "Inactivo · la web funciona con normalidad"}
          </p>
          <button
            type="button"
            disabled={busy || !usingSupabase}
            onClick={() => void setActive(!active)}
            className={`rounded-lg px-4 py-2 text-xs font-bold transition disabled:opacity-60 ${
              active
                ? "bg-[#a7f600] text-black hover:bg-[#c7ff43]"
                : "bg-rose-600 text-white hover:bg-rose-500"
            }`}
          >
            {busy
              ? "Guardando..."
              : active
                ? "Reactivar web"
                : "Activar mantenimiento"}
          </button>
        </div>

        <div>
          <label
            htmlFor="maintenance-message"
            className="text-xs font-semibold text-zinc-400"
          >
            Mensaje para los usuarios (opcional)
          </label>
          <input
            id="maintenance-message"
            type="text"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Volvemos enseguida…"
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-white/25"
          />
          <p className="mt-1 text-[11px] text-zinc-500">
            Se guarda al activar o reactivar.
          </p>
        </div>

        {error ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xs font-semibold text-rose-300">{error}</p>
            <button
              type="button"
              onClick={() => void loadStatus()}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-white/10"
            >
              Reintentar
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
