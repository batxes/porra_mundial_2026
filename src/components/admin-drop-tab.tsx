"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { packDropEventName } from "@/components/pack-drop-notice";
import { useAppContext } from "@/lib/app-context";
import { getSupabaseBrowserClient } from "@/lib/supabase";

// El cliente de Supabase no tiene tipos de la BBDD generados, así que tipamos el
// rpc de forma laxa para poder pasarle parámetros (igual que hace cofres-view).
type SupabaseRpcClient = {
  rpc: (
    fn: string,
    params?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

type QuizAdminStatus = {
  active?: boolean;
  total_attempts?: number;
  updated_at?: string | null;
};

function firstRow<T>(data: unknown): T | null {
  return Array.isArray(data) ? ((data[0] as T | undefined) ?? null) : (data as T);
}

// Tipos de sobre que un admin puede soltar a todos. En Supabase se crean con el
// RPC admin_create_card_drop. Los pools curados y por puesto sueltan 1 carta;
// "diario" suelta 3 cartas con tiering. `pool` null =
// drop diario tiered.
const DROP_OPTIONS = [
  {
    key: "estrellas",
    title: "Sobre Estrellas",
    image: "/sobre-estrellas.webp",
    pool: "stars",
  },
  {
    key: "madrid",
    title: "Sobre Madrid",
    image: "/sobre-madrid.webp",
    pool: "madrid",
  },
  {
    key: "sub21",
    title: "Sobre Promesas",
    image: "/sobre21.webp",
    pool: "sub21",
  },
  {
    key: "francia",
    title: "Sobre Francia",
    image: "/sobre-francia.webp",
    pool: "francia",
  },
  {
    key: "defensas",
    title: "Sobre Defensas",
    image: "/sobre-defensas.webp",
    pool: "defensas",
  },
  {
    key: "medios",
    title: "Sobre Mediocentros",
    image: "/sobre-medios.webp",
    pool: "medios",
  },
  {
    key: "delanteros",
    title: "Sobre Delanteros",
    image: "/sobre-delanteros.webp",
    pool: "delanteros",
  },
  {
    key: "diario",
    title: "Sobre diario",
    image: "/sobre.webp",
    pool: null as string | null,
  },
];

export function AdminDropTab() {
  const { usingSupabase, user } = useAppContext();
  const [selectedKey, setSelectedKey] = useState(DROP_OPTIONS[0].key);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [quizStatus, setQuizStatus] = useState<QuizAdminStatus | null>(null);
  const [quizBusy, setQuizBusy] = useState(false);
  const [quizError, setQuizError] = useState("");

  const loadQuizStatus = useCallback(async () => {
    if (!usingSupabase || !user?.isAdmin) return;
    const supabase = getSupabaseBrowserClient() as unknown as
      | SupabaseRpcClient
      | null;
    if (!supabase) return;
    const { data, error } = await supabase.rpc("admin_sobera_quiz_status");
    if (error) {
      setQuizError(error.message);
      return;
    }
    setQuizError("");
    setQuizStatus(firstRow<QuizAdminStatus>(data));
  }, [usingSupabase, user?.isAdmin]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadQuizStatus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadQuizStatus]);

  const setQuizActive = async (active: boolean) => {
    if (quizBusy) return;
    setQuizBusy(true);
    setQuizError("");
    try {
      if (!usingSupabase || !user?.isAdmin) {
        throw new Error("Solo disponible con Supabase y usuario admin.");
      }
      const supabase = getSupabaseBrowserClient() as unknown as
        | SupabaseRpcClient
        | null;
      if (!supabase) throw new Error("No se ha podido conectar con Supabase.");
      const { data, error } = await supabase.rpc(
        "admin_set_sobera_quiz_active",
        { p_active: active },
      );
      if (error) throw new Error(error.message);
      setQuizStatus(firstRow<QuizAdminStatus>(data));
      toast.success(active ? "Quiz Sobera activado" : "Quiz Sobera pausado");
    } catch (error) {
      const msg =
        error instanceof Error
          ? error.message
          : "No se ha podido actualizar el quiz.";
      setQuizError(msg);
      toast.error("No se ha podido actualizar el quiz", { description: msg });
    } finally {
      setQuizBusy(false);
    }
  };

  const release = async () => {
    if (busy) return;
    const option = DROP_OPTIONS.find((item) => item.key === selectedKey);
    if (!option) return;
    const count = Math.max(1, Math.min(50, Math.floor(qty) || 1));
    setBusy(true);
    try {
      if (usingSupabase && user) {
        const supabase = getSupabaseBrowserClient() as unknown as
          | SupabaseRpcClient
          | null;
        if (!supabase) throw new Error("No se ha podido conectar con Supabase.");
        for (let i = 0; i < count; i += 1) {
          const { error } = await supabase.rpc("admin_create_card_drop", {
            p_label: option.title,
            p_pool: option.pool,
          });
          if (error) throw new Error(error.message);
        }
      }
      // Aviso "Florentino te regala fichajes" (lo recoge PackDropWatcher).
      window.dispatchEvent(
        new CustomEvent(packDropEventName, {
          detail: {
            items: [{ title: option.title, image: option.image, qty: count }],
          },
        }),
      );
      toast.success("¡Drop soltado!", {
        description: `${count} × ${option.title} ${
          count === 1 ? "disponible" : "disponibles"
        } para todos.`,
      });
    } catch (error) {
      const msg =
        error instanceof Error
          ? error.message
          : "No se ha podido soltar el drop.";
      toast.error("No se ha podido soltar el drop", { description: msg });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-xl font-semibold text-white">Quiz Sobera</h3>
            <p className="mt-1 text-sm text-zinc-400">
              Al activarlo, el modal aparece a los usuarios que todavia no lo
              hayan completado. Cada usuario solo puede reclamarlo una vez.
            </p>
            <p className="mt-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
              {quizStatus?.active ? "Activo" : "Pausado"} ·{" "}
              {Number(quizStatus?.total_attempts || 0)} completados
            </p>
            {quizError ? (
              <p className="mt-2 text-xs font-semibold text-rose-300">
                {quizError}
              </p>
            ) : null}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={quizBusy || !usingSupabase}
              onClick={() => void setQuizActive(!quizStatus?.active)}
              className={`rounded-lg px-5 py-3 text-sm font-bold transition disabled:opacity-60 ${
                quizStatus?.active
                  ? "border border-white/10 text-white hover:bg-white/10"
                  : "bg-[#a7f600] text-black hover:bg-[#c7ff43]"
              }`}
            >
              {quizBusy
                ? "Guardando..."
                : quizStatus?.active
                  ? "Pausar quiz"
                  : "Activar quiz"}
            </button>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-xl font-semibold text-white">Soltar sobres</h3>
        <p className="mt-1 text-sm text-zinc-400">
          Suelta sobres a todos los jugadores.{" "}
          {usingSupabase
            ? "Se crean en Supabase y aparecen en /cofres."
            : "En modo demo solo se lanza el aviso (no se persiste)."}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2.5 sm:max-w-xl sm:grid-cols-5">
        {DROP_OPTIONS.map((option) => {
          const sel = option.key === selectedKey;
          return (
            <button
              key={option.key}
              type="button"
              aria-pressed={sel}
              onClick={() => setSelectedKey(option.key)}
              className={`flex flex-col items-center gap-2 rounded-xl border p-2.5 transition ${
                sel
                  ? "border-[#ffd252] bg-[#ffd252]/10 ring-1 ring-[#ffd252]/40"
                  : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.07]"
              }`}
            >
              <span className="relative block aspect-[818/1206] w-full overflow-hidden rounded-md">
                <Image
                  src={option.image}
                  alt=""
                  fill
                  sizes="100px"
                  className="object-contain"
                />
              </span>
              <span className="text-[11px] font-bold leading-tight text-white">
                {option.title.replace(/^Sobre\s+/i, "")}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5">
          <span className="text-sm font-semibold text-zinc-300">Cantidad</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Menos"
              onClick={() => setQty((value) => Math.max(1, value - 1))}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.06] text-lg font-bold text-white transition hover:bg-white/10"
            >
              −
            </button>
            <span className="w-8 text-center text-lg font-bold tabular-nums text-white">
              {qty}
            </span>
            <button
              type="button"
              aria-label="Más"
              onClick={() => setQty((value) => Math.min(50, value + 1))}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.06] text-lg font-bold text-white transition hover:bg-white/10"
            >
              +
            </button>
          </div>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void release()}
          className="rounded-lg bg-[#ffd252] px-5 py-3 text-sm font-bold text-black transition hover:bg-[#ffdd7a] disabled:opacity-60"
        >
          {busy ? "Soltando..." : `Soltar ${qty} sobre${qty === 1 ? "" : "s"}`}
        </button>
      </div>
    </div>
  );
}
