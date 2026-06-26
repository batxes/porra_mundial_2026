"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { useAppContext } from "@/lib/app-context";
import { playersById } from "@/lib/data";
import { getSupabaseBrowserClient } from "@/lib/supabase";

type SupabaseRpcClient = {
  rpc: (
    fn: string,
    params?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

type OakAdminStatus = {
  active?: boolean;
  active_quiz_id?: string | null;
  active_quiz_title?: string | null;
  total_attempts?: number;
  updated_at?: string | null;
};

type OakQuizRow = {
  created_at?: string | null;
  id: string;
  is_active?: boolean;
  rewards?: unknown;
  round_time_ms?: number;
  rounds?: unknown;
  title?: string | null;
  total_attempts?: number;
  updated_at?: string | null;
};

type OakRoundSummary = {
  answerId: string;
  image: string;
  label: string;
};

type OakAttemptRow = {
  answers?: unknown;
  awarded_drop_ids?: string[];
  completed_at?: string | null;
  correct_answers?: string[];
  display_name?: string | null;
  quiz_id?: string;
  quiz_title?: string | null;
  score?: number;
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

function answerIds(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => (typeof item === "string" ? item : null))
    : [];
}

function playerLabel(playerId: string | null | undefined) {
  if (!playerId) return "Sin respuesta";
  return playersById.get(playerId)?.name || playerId;
}

function parseRoundSummaries(value: unknown): OakRoundSummary[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): OakRoundSummary | null => {
      if (!item || typeof item !== "object") return null;
      const row = item as {
        answerId?: unknown;
        answerLabel?: unknown;
        image?: unknown;
      };
      if (typeof row.answerId !== "string" || typeof row.image !== "string") {
        return null;
      }
      return {
        answerId: row.answerId,
        image: row.image,
        label:
          typeof row.answerLabel === "string"
            ? row.answerLabel
            : playersById.get(row.answerId)?.name || row.answerId,
      };
    })
    .filter((item): item is OakRoundSummary => Boolean(item));
}

function formatSeconds(ms?: number) {
  const seconds = Math.round(Number(ms || 10000) / 1000);
  return `${seconds}s`;
}

function quizSummary(row: OakQuizRow) {
  const rounds = parseRoundSummaries(row.rounds);
  const labels = rounds.map((round) => round.label).join(", ");
  return `${rounds.length || 4} rondas - ${formatSeconds(
    row.round_time_ms,
  )} por ronda${labels ? ` - ${labels}` : ""}`;
}

export function AdminOakTab() {
  const { usingSupabase, user } = useAppContext();
  const [status, setStatus] = useState<OakAdminStatus | null>(null);
  const [quizRows, setQuizRows] = useState<OakQuizRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [statsOpen, setStatsOpen] = useState(false);
  const [statsQuizId, setStatsQuizId] = useState<string | null>(null);
  const [statsTitle, setStatsTitle] = useState("Adivina el crack");
  const [attempts, setAttempts] = useState<OakAttemptRow[]>([]);
  const [attemptsLoading, setAttemptsLoading] = useState(false);

  const loadAll = useCallback(async () => {
    if (!usingSupabase || !user?.isAdmin) return;
    const supabase = getSupabaseBrowserClient() as unknown as
      | SupabaseRpcClient
      | null;
    if (!supabase) return;

    const { data, error: statusError } = await supabase.rpc(
      "admin_oak_quiz_status",
    );
    if (statusError) {
      setError(
        isMissingRpcError(statusError)
          ? "Falta aplicar la migracion de Oak en esta base."
          : statusError.message,
      );
      return;
    }
    setStatus(firstRow<OakAdminStatus>(data));

    const { data: listData, error: listError } = await supabase.rpc(
      "admin_oak_quiz_list",
    );
    if (listError) {
      if (isMissingRpcError(listError)) {
        setQuizRows([]);
        setError("");
        setNotice(
          "Falta aplicar la migracion del selector de quizzes de Oak.",
        );
        return;
      }
      setError(listError.message);
      return;
    }

    setError("");
    setNotice("");
    setQuizRows(rows<OakQuizRow>(listData));
  }, [usingSupabase, user?.isAdmin]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAll();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadAll]);

  const setActive = async (active: boolean, quizId: string | null) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (!usingSupabase || !user?.isAdmin) {
        throw new Error("Solo disponible con Supabase y usuario admin.");
      }
      const supabase = getSupabaseBrowserClient() as unknown as
        | SupabaseRpcClient
        | null;
      if (!supabase) throw new Error("No se ha podido conectar con Supabase.");
      const params: Record<string, unknown> = { p_active: active };
      if (quizId) params.p_quiz_id = quizId;
      const { data, error: rpcError } = await supabase.rpc(
        "admin_set_oak_quiz_active",
        params,
      );
      if (rpcError) throw new Error(rpcError.message);
      setStatus(firstRow<OakAdminStatus>(data));
      void loadAll();
      toast.success(active ? "Oak activado" : "Oak pausado");
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "No se ha podido actualizar Oak.";
      setError(msg);
      toast.error("No se ha podido actualizar Oak", { description: msg });
    } finally {
      setBusy(false);
    }
  };

  const loadAttempts = useCallback(
    async (quizId: string | null) => {
      if (!usingSupabase || !user?.isAdmin) return;
      const supabase = getSupabaseBrowserClient() as unknown as
        | SupabaseRpcClient
        | null;
      if (!supabase) return;
      setAttemptsLoading(true);
      try {
        const { data, error: rpcError } = await supabase.rpc(
          "admin_oak_quiz_attempts",
          { p_quiz_id: quizId },
        );
        if (rpcError) throw new Error(rpcError.message);
        setAttempts(rows<OakAttemptRow>(data));
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : "No se han podido cargar los intentos.";
        toast.error("No se han podido cargar los intentos", { description: msg });
      } finally {
        setAttemptsLoading(false);
      }
    },
    [usingSupabase, user?.isAdmin],
  );

  const openStats = (quizId: string | null, title: string) => {
    setStatsOpen(true);
    setStatsQuizId(quizId);
    setStatsTitle(title);
    setAttempts([]);
    void loadAttempts(quizId);
  };

  const active = Boolean(status?.active);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-xl font-semibold text-white">Oak</h3>
          <p className="mt-1 text-sm text-zinc-400">
            Modal Adivina el crack: cada jugador completa un intento por ronda y
            el servidor reparte los sobres privados segun sus aciertos.
          </p>
        </div>
        <Link
          href="/oak-cracks-demo"
          className="inline-flex w-max rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-white transition hover:bg-white/10"
        >
          Ver demo nueva
        </Link>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <PrizeCard title="Sobre Defensas" subtitle="1 acierto" />
        <PrizeCard title="Sobre Mediocentros" subtitle="2 aciertos" />
        <PrizeCard title="Sobre Barcelona" subtitle="4 aciertos" />
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-zinc-500">
          {active ? "Activo" : "Pausado"} -{" "}
          {status?.active_quiz_title || "Sin quiz activo"} -{" "}
          {Number(status?.total_attempts || 0)} intentos
        </p>
        {error ? (
          <p className="mt-2 text-xs font-semibold text-rose-300">{error}</p>
        ) : null}
        {notice ? (
          <p className="mt-2 text-xs font-semibold text-amber-200">{notice}</p>
        ) : null}

        <div className="mt-4 space-y-2">
          {quizRows.length ? (
            quizRows.map((row) => (
              <OakQuizCard
                busy={busy || !usingSupabase}
                key={row.id}
                onSetActive={(nextActive) => void setActive(nextActive, row.id)}
                onStats={() =>
                  openStats(row.id, row.title || "Adivina el crack")
                }
                row={row}
              />
            ))
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/18 p-3">
              <div className="min-w-0">
                <p className="text-sm font-bold text-white">
                  {status?.active_quiz_title || "ADIVINA EL CRACK"}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  {Number(status?.total_attempts || 0)} intentos completados
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    openStats(
                      status?.active_quiz_id || null,
                      status?.active_quiz_title || "Adivina el crack",
                    )
                  }
                  className="rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-white transition hover:bg-white/10"
                >
                  Ver intentos
                </button>
                <button
                  type="button"
                  disabled={busy || !usingSupabase}
                  onClick={() =>
                    void setActive(!active, status?.active_quiz_id || null)
                  }
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
          )}
        </div>
      </div>

      {statsOpen ? (
        <OakStatsModal
          attempts={attempts}
          loading={attemptsLoading}
          onClose={() => setStatsOpen(false)}
          onRefresh={() => void loadAttempts(statsQuizId)}
          title={statsTitle}
        />
      ) : null}
    </div>
  );
}

function PrizeCard({ subtitle, title }: { subtitle: string; title: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/18 px-3 py-3">
      <p className="text-sm font-bold text-white">{title}</p>
      <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.14em] text-lime-200">
        {subtitle}
      </p>
    </div>
  );
}

function OakQuizCard({
  busy,
  onSetActive,
  onStats,
  row,
}: {
  busy: boolean;
  onSetActive: (active: boolean) => void;
  onStats: () => void;
  row: OakQuizRow;
}) {
  const rowActive = Boolean(row.is_active);
  const rounds = parseRoundSummaries(row.rounds);
  return (
    <div className="grid gap-3 rounded-xl border border-white/10 bg-black/18 p-3 md:grid-cols-[1fr_auto] md:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-bold text-white">
            {row.title || "ADIVINA EL CRACK"}
          </p>
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${
              rowActive
                ? "border-[#a7f600]/40 bg-[#a7f600]/12 text-[#a7f600]"
                : "border-white/10 bg-white/[0.05] text-zinc-400"
            }`}
          >
            {rowActive ? "Activo" : "Pausado"}
          </span>
        </div>
        <p className="mt-1 text-xs text-zinc-500">
          {quizSummary(row)}
          {" - "}
          {Number(row.total_attempts || 0)} intentos
          {row.created_at ? ` - ${formatDate(row.created_at)}` : ""}
        </p>
        {rounds.length ? (
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {rounds.map((round) => (
              <div
                key={`${row.id}-${round.answerId}`}
                className="flex min-w-[116px] items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-2"
              >
                <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md bg-[#10230b]">
                  <Image
                    src={round.image}
                    alt=""
                    fill
                    sizes="40px"
                    className="object-contain"
                  />
                </div>
                <span className="min-w-0 truncate text-xs font-bold text-zinc-200">
                  {round.label}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onStats}
          className="rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-white transition hover:bg-white/10"
        >
          Ver intentos
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onSetActive(!rowActive)}
          className={`rounded-lg px-3 py-2 text-xs font-bold transition disabled:opacity-60 ${
            rowActive
              ? "border border-white/10 text-white hover:bg-white/10"
              : "bg-[#a7f600] text-black hover:bg-[#c7ff43]"
          }`}
        >
          {busy ? "Guardando..." : rowActive ? "Pausar" : "Activar"}
        </button>
      </div>
    </div>
  );
}

function OakStatsModal({
  attempts,
  loading,
  onClose,
  onRefresh,
  title,
}: {
  attempts: OakAttemptRow[];
  loading: boolean;
  onClose: () => void;
  onRefresh: () => void;
  title: string;
}) {
  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 px-3 py-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="oak-stats-title"
    >
      <div className="flex max-h-[86vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#101010] text-white shadow-2xl shadow-black/70">
        <div className="flex flex-col gap-3 border-b border-white/10 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-lime-200">
              Stats Oak
            </p>
            <h4 id="oak-stats-title" className="mt-1 text-xl font-bold text-white">
              {title}
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
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="sticky top-0 bg-[#171717] text-[11px] uppercase tracking-[0.12em] text-zinc-400">
                <tr>
                  <th className="px-3 py-2 font-bold">Usuario</th>
                  <th className="px-3 py-2 font-bold">Aciertos</th>
                  <th className="px-3 py-2 font-bold">Detalle</th>
                  <th className="px-3 py-2 font-bold">Premios</th>
                  <th className="px-3 py-2 font-bold">Fecha</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {attempts.map((attempt) => (
                  <OakAttemptRowView
                    attempt={attempt}
                    key={`${attempt.user_id}-${attempt.completed_at}`}
                  />
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

function OakAttemptRowView({ attempt }: { attempt: OakAttemptRow }) {
  const answers = answerIds(attempt.answers);
  const correctAnswers = attempt.correct_answers || [];
  return (
    <tr>
      <td className="px-3 py-2 font-semibold text-white">
        {attempt.display_name || "Usuario"}
      </td>
      <td className="px-3 py-2 font-bold text-[#a7f600]">
        {Number(attempt.score || 0)}/{correctAnswers.length || 4}
      </td>
      <td className="px-3 py-2">
        <div className="flex gap-1">
          {correctAnswers.map((correct, index) => {
            const selected = answers[index] ?? null;
            const hit = selected === correct;
            return (
              <span
                key={`${correct}-${index}`}
                className={`grid h-6 w-6 place-items-center rounded-md text-[11px] font-bold ${
                  hit
                    ? "bg-[#a7f600] text-black"
                    : "bg-white/[0.06] text-zinc-400"
                }`}
                title={`Ronda ${index + 1}: ${playerLabel(selected)} / ${playerLabel(correct)}`}
              >
                {index + 1}
              </span>
            );
          })}
        </div>
      </td>
      <td className="px-3 py-2 text-zinc-300">
        {formatAwardCount(attempt.awarded_drop_ids)}
      </td>
      <td className="px-3 py-2 text-zinc-400">
        {formatDate(attempt.completed_at)}
      </td>
    </tr>
  );
}
