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
  active_quiz_id?: string | null;
  active_quiz_title?: string | null;
  total_attempts?: number;
  updated_at?: string | null;
};

type QuizAttemptRow = {
  answers?: unknown;
  awarded_drop_ids?: string[];
  completed_at?: string | null;
  correct_answers?: number[];
  display_name?: string | null;
  quiz_id?: string;
  quiz_title?: string | null;
  score?: number;
  user_id?: string;
};

type QuizRow = {
  created_at?: string | null;
  id: string;
  is_active?: boolean;
  question_time_ms?: number;
  questions?: unknown;
  rewards?: unknown;
  title?: string | null;
  total_attempts?: number;
  updated_at?: string | null;
};

type QuizQuestionDraft = {
  correctIndex: number;
  options: string[];
  question: string;
};

type QuizRewardDraft = {
  minScore: number;
  pool: string;
};

const LEGACY_CORRECT_ANSWERS = [1, 2, 2, 1];

function createBlankQuestions() {
  return Array.from({ length: 4 }, () => ({
    correctIndex: 0,
    options: ["", "", "", ""],
    question: "",
  }));
}

const DEFAULT_QUIZ_REWARDS: QuizRewardDraft[] = [
  { minScore: 1, pool: "defensas" },
  { minScore: 2, pool: "medios" },
  { minScore: 4, pool: "delanteros" },
];

function firstRow<T>(data: unknown): T | null {
  return Array.isArray(data) ? ((data[0] as T | undefined) ?? null) : (data as T);
}

function isMissingRpcError(error: { message: string } | null | undefined) {
  const message = error?.message || "";
  return (
    message.includes("Could not find the function") ||
    message.includes("schema cache")
  );
}

function rows<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

function formatQuizDate(value?: string | null) {
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

function quizAnswerIndexes(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => (typeof item === "number" ? item : null))
    : [];
}

function answerLabel(index: number) {
  return ["A", "B", "C", "D"][index] || String(index + 1);
}

function cloneDefaultRewards() {
  return DEFAULT_QUIZ_REWARDS.map((reward) => ({ ...reward }));
}

function cleanQuestionDrafts(questions: QuizQuestionDraft[]) {
  return questions.map((question) => ({
    correctIndex: Math.max(0, Math.min(3, question.correctIndex)),
    options: question.options.slice(0, 4).map((option) => option.trim()),
    question: question.question.trim(),
  }));
}

function cleanRewardDrafts(rewards: QuizRewardDraft[]) {
  return rewards.map((reward) => ({
    minScore: Math.max(1, Math.min(4, Math.floor(reward.minScore))),
    pool: reward.pool,
  }));
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

const REWARD_POOL_OPTIONS = DROP_OPTIONS.filter(
  (option): option is (typeof DROP_OPTIONS)[number] & { pool: string } =>
    typeof option.pool === "string",
);

export function AdminDropTab() {
  const { usingSupabase, user } = useAppContext();
  const [selectedKey, setSelectedKey] = useState(DROP_OPTIONS[0].key);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [quizStatus, setQuizStatus] = useState<QuizAdminStatus | null>(null);
  const [quizAttempts, setQuizAttempts] = useState<QuizAttemptRow[]>([]);
  const [quizRows, setQuizRows] = useState<QuizRow[]>([]);
  const [selectedStatsQuizId, setSelectedStatsQuizId] = useState<string | null>(
    null,
  );
  const [quizTitle, setQuizTitle] = useState("");
  const [questionDrafts, setQuestionDrafts] = useState<QuizQuestionDraft[]>(
    () => createBlankQuestions(),
  );
  const [rewardDrafts, setRewardDrafts] = useState<QuizRewardDraft[]>(() =>
    cloneDefaultRewards(),
  );
  const [quizBusy, setQuizBusy] = useState(false);
  const [quizError, setQuizError] = useState("");
  const [quizNotice, setQuizNotice] = useState("");
  const [quizFormBusy, setQuizFormBusy] = useState(false);

  const resetQuizForm = () => {
    setQuizTitle("");
    setQuestionDrafts(createBlankQuestions());
    setRewardDrafts(cloneDefaultRewards());
  };

  const loadQuizStatus = useCallback(async () => {
    if (!usingSupabase || !user?.isAdmin) return;
    const supabase = getSupabaseBrowserClient() as unknown as
      | SupabaseRpcClient
      | null;
    if (!supabase) return;
    const { data, error } = await supabase.rpc("admin_sobera_quiz_status");
    if (error) {
      setQuizNotice("");
      setQuizError(error.message);
      return;
    }
    const status = firstRow<QuizAdminStatus>(data);
    const { data: listData, error: listError } = await supabase.rpc(
      "admin_sobera_quiz_list",
    );
    if (listError) {
      if (isMissingRpcError(listError)) {
        const { data: attemptsData, error: attemptsError } = await supabase.rpc(
          "admin_sobera_quiz_attempts",
        );
        setQuizStatus(
          status
            ? {
                ...status,
                active_quiz_title:
                  status.active_quiz_title ||
                  (status.active ? "Quiz actual" : null),
              }
            : status,
        );
        setQuizRows([]);
        if (!attemptsError) {
          setQuizAttempts(rows<QuizAttemptRow>(attemptsData));
        }
        setQuizError("");
        setQuizNotice(
          "Base local sin migracion de rondas configurables. En produccion no afecta.",
        );
        return;
      }
      setQuizNotice("");
      setQuizError(listError.message);
      return;
    }
    const list = rows<QuizRow>(listData);
    const statsQuizId =
      selectedStatsQuizId && list.some((row) => row.id === selectedStatsQuizId)
        ? selectedStatsQuizId
        : status?.active_quiz_id || list[0]?.id || null;
    const { data: attemptsData, error: attemptsError } = await supabase.rpc(
      "admin_sobera_quiz_attempts",
      { p_quiz_id: statsQuizId },
    );
    if (attemptsError) {
      setQuizNotice("");
      setQuizError(attemptsError.message);
      return;
    }
    setQuizError("");
    setQuizNotice("");
    setQuizStatus(status);
    setQuizRows(list);
    setQuizAttempts(rows<QuizAttemptRow>(attemptsData));
  }, [selectedStatsQuizId, usingSupabase, user?.isAdmin]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadQuizStatus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadQuizStatus]);

  const setQuizActive = async (active: boolean, quizId?: string | null) => {
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
      let { data, error } = await supabase.rpc(
        "admin_set_sobera_quiz_active",
        { p_active: active, p_quiz_id: quizId || null },
      );
      if (error && isMissingRpcError(error)) {
        const fallback = await supabase.rpc("admin_set_sobera_quiz_active", {
          p_active: active,
        });
        data = fallback.data;
        error = fallback.error;
      }
      if (error) throw new Error(error.message);
      setQuizStatus(firstRow<QuizAdminStatus>(data));
      void loadQuizStatus();
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

  const updateQuestionDraft = (
    questionIndex: number,
    updater: (question: QuizQuestionDraft) => QuizQuestionDraft,
  ) => {
    setQuestionDrafts((current) =>
      current.map((question, index) =>
        index === questionIndex ? updater(question) : question,
      ),
    );
  };

  const updateQuestionOption = (
    questionIndex: number,
    optionIndex: number,
    value: string,
  ) => {
    updateQuestionDraft(questionIndex, (question) => ({
      ...question,
      options: question.options.map((option, index) =>
        index === optionIndex ? value : option,
      ),
    }));
  };

  const updateRewardDraft = (
    rewardIndex: number,
    patch: Partial<QuizRewardDraft>,
  ) => {
    setRewardDrafts((current) =>
      current.map((reward, index) =>
        index === rewardIndex ? { ...reward, ...patch } : reward,
      ),
    );
  };

  const saveQuiz = async () => {
    if (quizFormBusy) return;
    const questions = cleanQuestionDrafts(questionDrafts);
    const rewards = cleanRewardDrafts(rewardDrafts);
    if (
      questions.length !== 4 ||
      questions.some(
        (question) =>
          !question.question || question.options.some((option) => !option),
      )
    ) {
      toast.error("Completa las 4 preguntas y sus 4 respuestas.");
      return;
    }
    if (
      rewards.some(
        (reward) =>
          !REWARD_POOL_OPTIONS.some((option) => option.pool === reward.pool),
      )
    ) {
      toast.error("Hay un sobre de premio no valido.");
      return;
    }

    setQuizFormBusy(true);
    setQuizError("");
    setQuizNotice("");
    try {
      if (!usingSupabase || !user?.isAdmin) {
        throw new Error("Solo disponible con Supabase y usuario admin.");
      }
      const supabase = getSupabaseBrowserClient() as unknown as
        | SupabaseRpcClient
        | null;
      if (!supabase) throw new Error("No se ha podido conectar con Supabase.");
      const { data, error } = await supabase.rpc("admin_save_sobera_quiz", {
        p_activate: false,
        p_questions: questions,
        p_rewards: rewards,
        p_title: quizTitle.trim() || "SOBRE EXTRA",
      });
      if (error) throw new Error(error.message);
      const row = firstRow<QuizRow>(data);
      if (row?.id) setSelectedStatsQuizId(row.id);
      resetQuizForm();
      toast.success("Ronda creada");
      void loadQuizStatus();
    } catch (error) {
      const rawMsg =
        error instanceof Error
          ? error.message
          : "No se ha podido guardar la ronda.";
      const msg =
        rawMsg.includes("Could not find the function") ||
        rawMsg.includes("schema cache")
          ? "Falta aplicar la migracion de quizzes configurables en esta base."
          : rawMsg;
      if (isMissingRpcError({ message: rawMsg })) {
        setQuizNotice(msg);
        setQuizError("");
      } else {
        setQuizError(msg);
      }
      toast.error("No se ha podido guardar la ronda", { description: msg });
    } finally {
      setQuizFormBusy(false);
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

  const activeQuiz = quizRows.find(
    (row) => row.id === quizStatus?.active_quiz_id,
  );
  const statsQuizId =
    selectedStatsQuizId || quizStatus?.active_quiz_id || quizRows[0]?.id || "";
  const selectedQuiz = quizRows.find((row) => row.id === statsQuizId) || null;
  const statsQuiz = selectedQuiz;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-xl font-semibold text-white">Quiz Sobera</h3>
            <p className="mt-1 text-sm text-zinc-400">
              Crea una ronda, activala cuando quieras y cada usuario solo podra
              jugarla una vez. Si activas otra, podran jugar la nueva.
            </p>
            <p className="mt-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
              {quizStatus?.active ? "Activo" : "Pausado"} -{" "}
              {activeQuiz?.title ||
                quizStatus?.active_quiz_title ||
                (quizStatus?.active ? "Quiz actual" : "Sin ronda activa")}{" "}
              - {Number(quizStatus?.total_attempts || 0)} completados
            </p>
            {quizError ? (
              <p className="mt-2 text-xs font-semibold text-rose-300">
                {quizError}
              </p>
            ) : null}
          </div>
        </div>
        <div className="mt-4 space-y-2">
          {quizRows.length ? (
            quizRows.map((row) => {
              const rowActive = Boolean(
                quizStatus?.active && row.id === activeQuiz?.id,
              );
              const selected = row.id === statsQuizId;
              return (
                <div
                  key={row.id}
                  className={`grid gap-3 rounded-xl border bg-black/18 p-3 md:grid-cols-[1fr_auto] md:items-center ${
                    selected
                      ? "border-amber-200/50"
                      : "border-white/10"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedStatsQuizId(row.id)}
                    className="min-w-0 text-left"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-bold text-white">
                        {row.title || "SOBRE EXTRA"}
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
                      {Number(row.total_attempts || 0)} completados
                      {row.created_at ? ` - ${formatQuizDate(row.created_at)}` : ""}
                    </p>
                  </button>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedStatsQuizId(row.id)}
                      className="rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-white transition hover:bg-white/10"
                    >
                      Ver stats
                    </button>
                    <button
                      type="button"
                      disabled={quizBusy || !usingSupabase}
                      onClick={() =>
                        void setQuizActive(rowActive ? false : true, row.id)
                      }
                      className={`rounded-lg px-3 py-2 text-xs font-bold transition disabled:opacity-60 ${
                        rowActive
                          ? "border border-white/10 text-white hover:bg-white/10"
                          : "bg-amber-300 text-black hover:bg-amber-200"
                      }`}
                    >
                      {quizBusy ? "Guardando..." : rowActive ? "Pausar" : "Activar"}
                    </button>
                  </div>
                </div>
              );
            })
          ) : (
            <p className="rounded-xl border border-white/10 bg-black/18 px-3 py-4 text-sm text-zinc-400">
              No hay rondas creadas todavia.
            </p>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <div className="space-y-4">
          <div>
            <h4 className="text-base font-semibold text-white">
              Crear nueva ronda
            </h4>
            <p className="mt-1 text-xs text-zinc-400">
              Guardar crea siempre un quiz nuevo. No modifica el quiz que ya
              este lanzado.
            </p>
            {quizNotice ? (
              <p className="mt-2 text-xs font-semibold text-amber-200">
                {quizNotice}
              </p>
            ) : null}
          </div>
          <label className="block">
            <span className="text-xs font-bold uppercase tracking-[0.14em] text-zinc-400">
              Titulo de la ronda
            </span>
            <input
              value={quizTitle}
              onChange={(event) => setQuizTitle(event.target.value)}
              className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm font-semibold text-white outline-none transition placeholder:text-zinc-600 focus:border-amber-200/70"
              placeholder="SOBRE EXTRA"
            />
          </label>

          <div className="space-y-3">
            {questionDrafts.map((question, questionIndex) => (
              <div
                key={questionIndex}
                className="rounded-xl border border-white/10 bg-black/18 p-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-amber-200">
                    Pregunta {questionIndex + 1}
                  </p>
                  <p className="text-[11px] font-semibold text-zinc-500">
                    Correcta: {answerLabel(question.correctIndex)}
                  </p>
                </div>
                <input
                  value={question.question}
                  onChange={(event) =>
                    updateQuestionDraft(questionIndex, (current) => ({
                      ...current,
                      question: event.target.value,
                    }))
                  }
                  className="mt-2 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-white outline-none transition placeholder:text-zinc-600 focus:border-amber-200/70"
                  placeholder="Pregunta"
                />
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {question.options.map((option, optionIndex) => {
                    const correct = question.correctIndex === optionIndex;
                    return (
                      <div
                        key={optionIndex}
                        className="flex min-w-0 items-center gap-2"
                      >
                        <button
                          type="button"
                          aria-pressed={correct}
                          onClick={() =>
                            updateQuestionDraft(questionIndex, (current) => ({
                              ...current,
                              correctIndex: optionIndex,
                            }))
                          }
                          className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg border text-xs font-black transition ${
                            correct
                              ? "border-[#a7f600] bg-[#a7f600] text-black"
                              : "border-white/10 bg-black/30 text-amber-200 hover:bg-white/10"
                          }`}
                        >
                          {answerLabel(optionIndex)}
                        </button>
                        <input
                          value={option}
                          onChange={(event) =>
                            updateQuestionOption(
                              questionIndex,
                              optionIndex,
                              event.target.value,
                            )
                          }
                          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-white outline-none transition placeholder:text-zinc-600 focus:border-amber-200/70"
                          placeholder={`Respuesta ${answerLabel(optionIndex)}`}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-white/10 bg-black/18 p-3">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-zinc-400">
              Premios
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {rewardDrafts.map((reward, index) => (
                <label key={index} className="block">
                  <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500">
                    {reward.minScore}{" "}
                    {reward.minScore === 1 ? "acierto" : "aciertos"}
                  </span>
                  <select
                    value={reward.pool}
                    onChange={(event) =>
                      updateRewardDraft(index, { pool: event.target.value })
                    }
                    className="mt-1 w-full rounded-lg border border-white/10 bg-[#111] px-3 py-2 text-sm font-bold text-white outline-none transition focus:border-amber-200/70"
                  >
                    {REWARD_POOL_OPTIONS.map((option) => (
                      <option key={option.pool} value={option.pool}>
                        {option.title}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={quizFormBusy || !usingSupabase}
              onClick={() => void saveQuiz()}
              className="rounded-lg bg-[#a7f600] px-4 py-2.5 text-sm font-bold text-black transition hover:bg-[#c7ff43] disabled:opacity-60"
            >
              {quizFormBusy ? "Creando..." : "Crear ronda"}
            </button>
          </div>

        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h4 className="text-base font-semibold text-white">
              Stats Sobera
            </h4>
            <p className="mt-1 text-xs text-zinc-400">
              {statsQuiz
                ? `${statsQuiz.title || "SOBRE EXTRA"} - ${quizAttempts.length} intentos`
                : `Ultimos ${quizAttempts.length} intentos completados`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadQuizStatus()}
            className="rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-white transition hover:bg-white/10"
          >
            Actualizar
          </button>
        </div>
        <div className="mt-3 max-h-72 overflow-auto rounded-lg border border-white/10">
          {quizAttempts.length ? (
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="sticky top-0 bg-[#171717] text-[11px] uppercase tracking-[0.12em] text-zinc-400">
                <tr>
                  <th className="px-3 py-2 font-bold">Usuario</th>
                  <th className="px-3 py-2 font-bold">Ronda</th>
                  <th className="px-3 py-2 font-bold">Aciertos</th>
                  <th className="px-3 py-2 font-bold">Detalle</th>
                  <th className="px-3 py-2 font-bold">Premios</th>
                  <th className="px-3 py-2 font-bold">Fecha</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {quizAttempts.map((attempt) => (
                  <QuizAttemptRowView
                    attempt={attempt}
                    key={`${attempt.user_id}-${attempt.completed_at}`}
                  />
                ))}
              </tbody>
            </table>
          ) : (
            <p className="px-3 py-4 text-sm text-zinc-400">
              Aún no hay intentos completados.
            </p>
          )}
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

function QuizAttemptRowView({ attempt }: { attempt: QuizAttemptRow }) {
  const answers = quizAnswerIndexes(attempt.answers);
  const correctAnswers =
    attempt.correct_answers?.length ? attempt.correct_answers : LEGACY_CORRECT_ANSWERS;
  return (
    <tr>
      <td className="px-3 py-2 font-semibold text-white">
        {attempt.display_name || "Usuario"}
      </td>
      <td className="px-3 py-2 text-zinc-300">
        {attempt.quiz_title || "SOBRE EXTRA"}
      </td>
      <td className="px-3 py-2 font-bold text-[#a7f600]">
        {Number(attempt.score || 0)}/{correctAnswers.length}
      </td>
      <td className="px-3 py-2">
        <div className="flex gap-1">
          {correctAnswers.map((correct, index) => {
            const hit = answers[index] === correct;
            return (
              <span
                key={index}
                className={`grid h-6 w-6 place-items-center rounded-md text-[11px] font-bold ${
                  hit
                    ? "bg-[#a7f600] text-black"
                    : "bg-white/[0.06] text-zinc-400"
                }`}
                title={`Pregunta ${index + 1}: ${hit ? "acertada" : "fallada"}`}
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
        {formatQuizDate(attempt.completed_at)}
      </td>
    </tr>
  );
}
