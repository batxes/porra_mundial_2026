"use client";

import Image from "next/image";
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

type RuletaRow = {
  id: string;
  title?: string | null;
  segments?: unknown;
  created_at?: string | null;
  updated_at?: string | null;
  is_active?: boolean;
  total_attempts?: number;
};

type RuletaAttemptRow = {
  display_name?: string | null;
  prize_label?: string | null;
  prize_pool?: string | null;
  awarded_drop_ids?: string[];
  spun_at?: string | null;
};

type SegmentDraft = { pool: string | null };

// Sobres elegibles por casilla (+ "Casi" sin premio). pool null = "Casi".
const SEGMENT_OPTIONS: Array<{
  value: string;
  label: string;
  image: string | null;
}> = [
  { value: "", label: "Casi (sin sobre)", image: null },
  { value: "defensas", label: "Defensas", image: "/sobre-defensas.webp" },
  { value: "medios", label: "Mediocentros", image: "/sobre-medios.webp" },
  { value: "delanteros", label: "Delanteros", image: "/sobre-delanteros.webp" },
  { value: "stars", label: "Estrellas", image: "/sobre-estrellas.webp" },
  { value: "diario", label: "Sobre diario", image: "/sobre.webp" },
  { value: "madrid", label: "Madrid", image: "/sobre-madrid.webp" },
  { value: "barcelona", label: "Barcelona", image: "/sobre-barcelona.webp" },
  { value: "sub21", label: "Promesas", image: "/sobre21.webp" },
  { value: "francia", label: "Francia", image: "/sobre-francia.webp" },
  { value: "premier", label: "Premier", image: "/sobre-premier.webp" },
];

const VALID_POOLS = new Set(
  SEGMENT_OPTIONS.map((option) => option.value).filter(Boolean),
);
const MIN_SEGMENTS = 2;
const MAX_SEGMENTS = 12;

function defaultSegments(): SegmentDraft[] {
  return [
    { pool: "defensas" },
    { pool: "medios" },
    { pool: "delanteros" },
    { pool: null },
  ];
}

function firstRow<T>(data: unknown): T | null {
  return Array.isArray(data) ? ((data[0] as T | undefined) ?? null) : (data as T);
}

function rowsOf<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

function isMissingRpcError(error: { message: string } | null | undefined) {
  const message = error?.message || "";
  return (
    message.includes("Could not find the function") ||
    message.includes("schema cache")
  );
}

function imageForPool(pool: string | null) {
  if (!pool) return null;
  return SEGMENT_OPTIONS.find((option) => option.value === pool)?.image ?? null;
}

// Etiqueta corta para la rueda (cabe en la casilla). "Casi" para sin premio.
function wheelLabelFor(pool: string | null) {
  if (!pool) return "Casi";
  return SEGMENT_OPTIONS.find((option) => option.value === pool)?.label ?? "Sobre";
}

function segmentsFromUnknown(value: unknown): SegmentDraft[] {
  if (!Array.isArray(value) || !value.length) return defaultSegments();
  return value.map((item) => {
    const pool = (item as { pool?: unknown } | null)?.pool;
    return { pool: typeof pool === "string" ? pool : null };
  });
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

function segmentSummary(value: unknown) {
  const segments = segmentsFromUnknown(value);
  const prizes = segments.filter((segment) => segment.pool).length;
  return `${segments.length} casillas · ${prizes} con sobre`;
}

export function AdminRuletaTab() {
  const { usingSupabase, user } = useAppContext();
  const [status, setStatus] = useState<RuletaAdminStatus | null>(null);
  const [ruletaRows, setRuletaRows] = useState<RuletaRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Stats
  const [statsOpen, setStatsOpen] = useState(false);
  const [attempts, setAttempts] = useState<RuletaAttemptRow[]>([]);
  const [attemptsLoading, setAttemptsLoading] = useState(false);

  // Form
  const [formOpen, setFormOpen] = useState(false);
  const [formBusy, setFormBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formTitle, setFormTitle] = useState("");
  const [segments, setSegments] = useState<SegmentDraft[]>(defaultSegments());

  const loadAll = useCallback(async () => {
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
        isMissingRpcError(statusError)
          ? "Falta aplicar la migracion de la ruleta en esta base."
          : statusError.message,
      );
      return;
    }
    setStatus(firstRow<RuletaAdminStatus>(data));

    const { data: listData, error: listError } = await supabase.rpc(
      "admin_ruleta_list",
    );
    if (listError) {
      if (isMissingRpcError(listError)) {
        setRuletaRows([]);
        setError("");
        setNotice(
          "Base local sin migracion de ruletas configurables. En produccion no afecta.",
        );
        return;
      }
      setNotice("");
      setError(listError.message);
      return;
    }
    setError("");
    setNotice("");
    setRuletaRows(rowsOf<RuletaRow>(listData));
  }, [usingSupabase, user?.isAdmin]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAll();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadAll]);

  const setActive = async (active: boolean, ruletaId: string | null) => {
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
      let { data, error: rpcError } = await supabase.rpc(
        "admin_set_ruleta_active",
        { p_active: active, p_ruleta_id: ruletaId },
      );
      if (rpcError && isMissingRpcError(rpcError)) {
        const fallback = await supabase.rpc("admin_set_ruleta_active", {
          p_active: active,
        });
        data = fallback.data;
        rpcError = fallback.error;
      }
      if (rpcError) throw new Error(rpcError.message);
      setStatus(firstRow<RuletaAdminStatus>(data));
      void loadAll();
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

  const loadAttempts = useCallback(
    async (ruletaId: string | null) => {
      if (!usingSupabase || !user?.isAdmin) return;
      const supabase = getSupabaseBrowserClient() as unknown as
        | SupabaseRpcClient
        | null;
      if (!supabase) return;
      setAttemptsLoading(true);
      try {
        const { data, error: rpcError } = await supabase.rpc(
          "admin_ruleta_attempts",
          { p_ruleta_id: ruletaId },
        );
        if (rpcError) throw new Error(rpcError.message);
        setAttempts(rowsOf<RuletaAttemptRow>(data));
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : "No se han podido cargar los giros.";
        toast.error("No se han podido cargar los giros", { description: msg });
      } finally {
        setAttemptsLoading(false);
      }
    },
    [usingSupabase, user?.isAdmin],
  );

  const openStats = (ruletaId: string | null) => {
    setStatsOpen(true);
    setAttempts([]);
    void loadAttempts(ruletaId);
  };

  // ---- Form helpers ----------------------------------------------------------
  const resetForm = () => {
    setEditingId(null);
    setFormTitle("");
    setSegments(defaultSegments());
  };
  const openCreate = () => {
    resetForm();
    setFormOpen(true);
  };
  const openEdit = (row: RuletaRow) => {
    setEditingId(row.id);
    setFormTitle(row.title || "RULETA DE SOBRES");
    setSegments(segmentsFromUnknown(row.segments));
    setFormOpen(true);
  };
  const closeForm = () => {
    setFormOpen(false);
    resetForm();
  };

  const updateSegment = (index: number, value: string) => {
    setSegments((current) =>
      current.map((segment, i) =>
        i === index ? { pool: value === "" ? null : value } : segment,
      ),
    );
  };
  const addSegment = () => {
    setSegments((current) =>
      current.length >= MAX_SEGMENTS
        ? current
        : [...current, { pool: "defensas" }],
    );
  };
  const removeSegment = (index: number) => {
    setSegments((current) =>
      current.length <= MIN_SEGMENTS
        ? current
        : current.filter((_, i) => i !== index),
    );
  };

  const saveRuleta = async () => {
    if (formBusy) return;
    if (segments.length < MIN_SEGMENTS || segments.length > MAX_SEGMENTS) {
      toast.error(
        `La ruleta debe tener entre ${MIN_SEGMENTS} y ${MAX_SEGMENTS} casillas.`,
      );
      return;
    }
    if (
      segments.some((segment) => segment.pool && !VALID_POOLS.has(segment.pool))
    ) {
      toast.error("Hay una casilla con un sobre no valido.");
      return;
    }

    setFormBusy(true);
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

      const payload = segments.map((segment) => ({
        pool: segment.pool,
        label: wheelLabelFor(segment.pool),
      }));
      const title = formTitle.trim() || "RULETA DE SOBRES";
      const { error: rpcError } = editingId
        ? await supabase.rpc("admin_update_ruleta", {
            p_ruleta_id: editingId,
            p_segments: payload,
            p_title: title,
          })
        : await supabase.rpc("admin_save_ruleta", {
            p_activate: false,
            p_segments: payload,
            p_title: title,
          });
      if (rpcError) throw new Error(rpcError.message);
      closeForm();
      toast.success(editingId ? "Ruleta actualizada" : "Ruleta creada");
      void loadAll();
    } catch (err) {
      const rawMsg =
        err instanceof Error
          ? err.message
          : "No se ha podido guardar la ruleta.";
      const missing = isMissingRpcError({ message: rawMsg });
      const msg = missing
        ? "Falta aplicar la migracion de ruletas configurables en esta base."
        : rawMsg;
      if (missing) {
        setNotice(msg);
      } else {
        setError(msg);
      }
      toast.error("No se ha podido guardar la ruleta", { description: msg });
    } finally {
      setFormBusy(false);
    }
  };

  const active = Boolean(status?.active);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-xl font-semibold text-white">Ruleta de sobres</h3>
        <p className="mt-1 text-sm text-zinc-400">
          Crea ruletas y elige el sobre de cada casilla. Cada jugador gira una
          vez y el servidor reparte el premio. Todas las casillas tienen la
          misma probabilidad.
        </p>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-zinc-500">
          {active ? "Activa" : "Pausada"} —{" "}
          {status?.active_ruleta_title || "Sin ruleta activa"} —{" "}
          {Number(status?.total_attempts || 0)} giros
        </p>
        {error ? (
          <p className="mt-2 text-xs font-semibold text-rose-300">{error}</p>
        ) : null}
        {notice ? (
          <p className="mt-2 text-xs font-semibold text-amber-200">{notice}</p>
        ) : null}

        <div className="mt-4 space-y-2">
          {ruletaRows.length ? (
            ruletaRows.map((row) => {
              const rowActive = Boolean(row.is_active);
              const canEdit =
                !rowActive && Number(row.total_attempts || 0) === 0;
              return (
                <div
                  key={row.id}
                  className="grid gap-3 rounded-xl border border-white/10 bg-black/18 p-3 md:grid-cols-[1fr_auto] md:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-bold text-white">
                        {row.title || "RULETA DE SOBRES"}
                      </p>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${
                          rowActive
                            ? "border-[#a7f600]/40 bg-[#a7f600]/12 text-[#a7f600]"
                            : "border-white/10 bg-white/[0.05] text-zinc-400"
                        }`}
                      >
                        {rowActive ? "Activa" : "Pausada"}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">
                      {segmentSummary(row.segments)}
                      {" · "}
                      {Number(row.total_attempts || 0)} giros
                      {row.created_at ? ` · ${formatDate(row.created_at)}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {!rowActive ? (
                      <button
                        type="button"
                        disabled={!canEdit}
                        onClick={() => openEdit(row)}
                        title={
                          canEdit
                            ? "Editar ruleta"
                            : "No se puede editar una ruleta con giros"
                        }
                        className="rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        Editar
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => openStats(row.id)}
                      className="rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-white transition hover:bg-white/10"
                    >
                      Ver giros
                    </button>
                    <button
                      type="button"
                      disabled={busy || !usingSupabase}
                      onClick={() => void setActive(!rowActive, row.id)}
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
            })
          ) : (
            <p className="rounded-xl border border-white/10 bg-black/18 px-3 py-4 text-sm text-zinc-400">
              No hay ruletas creadas todavia.
            </p>
          )}
        </div>
      </div>

      <div className="flex">
        <button
          type="button"
          disabled={!usingSupabase}
          onClick={openCreate}
          className="rounded-lg bg-[#a7f600] px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-black transition hover:bg-[#c7ff43] disabled:opacity-60"
        >
          Crear ruleta
        </button>
      </div>

      {/* ---- Form crear/editar ---- */}
      {formOpen ? (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 px-3 py-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ruleta-form-title"
        >
          <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#101010] text-white shadow-2xl shadow-black/70">
            <div className="min-h-0 space-y-4 overflow-auto p-4">
              <div>
                <h4
                  id="ruleta-form-title"
                  className="text-base font-semibold text-white"
                >
                  {editingId ? "Editar ruleta" : "Crear nueva ruleta"}
                </h4>
                <p className="mt-1 text-xs text-zinc-400">
                  {editingId
                    ? "Solo puedes editar ruletas pausadas y sin giros."
                    : "Guardar crea una ruleta pausada. Actívala desde el listado cuando esté lista."}
                </p>
              </div>

              <label className="block">
                <span className="text-xs font-bold uppercase tracking-[0.14em] text-zinc-400">
                  Titulo de la ruleta
                </span>
                <input
                  value={formTitle}
                  onChange={(event) => setFormTitle(event.target.value)}
                  className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm font-semibold text-white outline-none transition placeholder:text-zinc-600 focus:border-amber-200/70"
                  placeholder="RULETA DE SOBRES"
                />
              </label>

              <div className="rounded-xl border border-white/10 bg-black/18 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-zinc-400">
                    Casillas ({segments.length})
                  </p>
                  <button
                    type="button"
                    disabled={segments.length >= MAX_SEGMENTS}
                    onClick={addSegment}
                    className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-white/10 disabled:opacity-45"
                  >
                    Añadir casilla
                  </button>
                </div>
                <p className="mt-1 text-[11px] text-zinc-500">
                  Elige el sobre de cada casilla. &quot;Casi&quot; = sin premio.
                  Todas con la misma probabilidad.
                </p>

                <div className="mt-3 space-y-2">
                  {segments.map((segment, index) => {
                    const image = imageForPool(segment.pool);
                    return (
                      <div
                        key={index}
                        className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/25 p-2"
                      >
                        <div className="relative h-9 w-7 shrink-0">
                          {image ? (
                            <Image
                              src={image}
                              alt=""
                              fill
                              sizes="32px"
                              className="object-contain"
                            />
                          ) : (
                            <div className="grid h-full w-full place-items-center rounded bg-white/[0.04] text-[9px] font-bold uppercase text-zinc-500">
                              Casi
                            </div>
                          )}
                        </div>
                        <select
                          value={segment.pool ?? ""}
                          onChange={(event) =>
                            updateSegment(index, event.target.value)
                          }
                          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#111] px-3 py-2 text-sm font-bold text-white outline-none transition focus:border-amber-200/70"
                        >
                          {SEGMENT_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          disabled={segments.length <= MIN_SEGMENTS}
                          onClick={() => removeSegment(index)}
                          aria-label="Quitar casilla"
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/10 text-sm font-bold text-white transition hover:bg-white/10 disabled:opacity-40"
                        >
                          ✕
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={formBusy || !usingSupabase}
                  onClick={() => void saveRuleta()}
                  className="rounded-lg bg-[#a7f600] px-4 py-2.5 text-sm font-bold text-black transition hover:bg-[#c7ff43] disabled:opacity-60"
                >
                  {formBusy ? "Guardando..." : "Aceptar"}
                </button>
                <button
                  type="button"
                  onClick={closeForm}
                  className="rounded-lg border border-white/10 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-white/10"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* ---- Stats ---- */}
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
                <p
                  id="ruleta-stats-title"
                  className="text-xs font-bold uppercase tracking-[0.18em] text-amber-200"
                >
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
                  {attemptsLoading ? "Cargando giros..." : "Aún no hay giros."}
                </p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
