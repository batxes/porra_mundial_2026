"use client";

import Link from "next/link";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  type DragEndEvent,
  type DragStartEvent,
  type DragOverEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import {
  Card,
  KnockoutBracket,
  Notice,
  PlayerAvatar,
  SectionHeading,
  TeamBadge,
  TeamFlag,
  TeamPicker,
} from "@/components/common";
import { AuthModal } from "@/components/auth-modal";
import { useAppContext } from "@/lib/app-context";
import {
  data,
  extraPredictionFields,
  playersById,
  schedule,
  sections,
  teamsById,
  xiFormations,
} from "@/lib/data";
import { translateSlot } from "@/lib/format";
import {
  groupTeamAt,
  hasMatchStarted,
  hasTournamentStarted,
  isMatchPredictionComplete,
  isMatchVisibleForPrediction,
  orderedGroupTeams,
  resolveSlot,
  scheduleUtc,
  xiCounts,
  xiRequirements,
} from "@/lib/prediction";
import type { Match, Player, Position, Prediction, Team } from "@/lib/types";

type LineupRow = {
  count: number;
  position: Position;
};

type LineupSlot = {
  id: string;
  row: number;
  index: number;
  position: Position;
  playerId?: string;
};

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => { finished: Promise<void> };
};

type AutoSaveState = "idle" | "pending" | "saving" | "saved" | "error";
type SectionId = (typeof sections)[number]["id"];
type SectionStatus = "complete" | "pending";
type SectionProgress = { done: number; status: SectionStatus; total: number };

const positionLabels: Record<Position, string> = {
  POR: "Portero",
  DEF: "Defensa",
  MED: "Centrocampista",
  DEL: "Delantero",
};

const positionTabs: Array<{ id: Position; label: string }> = [
  { id: "POR", label: "Portero" },
  { id: "DEF", label: "Defensa" },
  { id: "MED", label: "Centro" },
  { id: "DEL", label: "Delantero" },
];

const sortedPlayersByPosition = positionTabs.reduce(
  (acc, position) => {
    acc[position.id] = data.players
      .filter((player) => player.position === position.id)
      .sort((a, b) => {
        const teamCompare = (teamsById.get(a.team)?.name || "").localeCompare(
          teamsById.get(b.team)?.name || "",
        );
        return teamCompare || a.name.localeCompare(b.name);
      });
    return acc;
  },
  {} as Record<Position, Player[]>,
);

const playerSearchTextById = new Map(
  data.players.map((player) => {
    const team = teamsById.get(player.team)?.name || "";
    return [player.id, `${player.name} ${team}`.toLowerCase()];
  }),
);

const initialPlayerRenderLimit = 80;
const playerRenderBatchSize = 80;

const groupsIntroStorageKey = "porra26_groups_intro_seen";
const knockoutIntroStorageKey = "porra26_knockout_intro_seen";
const resultsIntroStorageKey = "porra26_results_intro_seen";

export function PredictionView() {
  const {
    prediction,
    chooseMatchWinner,
    ready,
    replaceGroupOrder,
    savePrediction,
    setAuthMode,
    setPredictionExtra,
    setPredictionScore,
    setXiFormation,
    setXiSelection,
    toggleThirdQualifier,
    user,
  } = useAppContext();
  const [section, setSection] = useState<SectionId>("extras");
  const [autoSaveState, setAutoSaveState] = useState<AutoSaveState>("idle");
  const [authOpen, setAuthOpen] = useState(false);
  const [showGroupsIntroModal, setShowGroupsIntroModal] = useState(false);
  const [showKnockoutIntroModal, setShowKnockoutIntroModal] = useState(false);
  const [showResultsIntroModal, setShowResultsIntroModal] = useState(false);
  const savedSignatureRef = useRef("");
  const latestSignatureRef = useRef("");
  const userKeyRef = useRef("");
  const saveRunRef = useRef(0);
  const autoSaveTimerRef = useRef<number | null>(null);
  const hideSavedTimerRef = useRef<number | null>(null);
  const groupsIntroQueuedRef = useRef(false);
  const knockoutIntroQueuedRef = useRef(false);
  const resultsIntroQueuedRef = useRef(false);

  const visibleMatches = useMemo(
    () =>
      schedule.filter((match) =>
        isMatchVisibleForPrediction(match, prediction),
      ),
    [prediction],
  );
  const finalPhaseMatches = useMemo(
    () => schedule.filter((match) => match.number >= 73),
    [],
  );
  const sectionProgresses = useMemo(
    () => getSectionProgresses(prediction, visibleMatches, finalPhaseMatches),
    [finalPhaseMatches, prediction, visibleMatches],
  );
  const tournamentLocked = hasTournamentStarted();
  const userId = user?.id || "";
  const changeSection = (nextSection: SectionId) => {
    if (nextSection === section) return;
    setSection(nextSection);
    window.requestAnimationFrame(() =>
      window.scrollTo({ top: 0, behavior: "smooth" }),
    );
  };
  const predictionSignature = useMemo(
    () =>
      JSON.stringify({
        groups: prediction.groups,
        bracket: prediction.bracket,
        matchPredictions: prediction.matchPredictions,
        extras: prediction.extras,
        xi: prediction.xi,
        xiFormation: prediction.xiFormation,
        isDefinitive: prediction.isDefinitive,
      }),
    [prediction],
  );

  useEffect(() => {
    latestSignatureRef.current = predictionSignature;
  }, [predictionSignature]);

  useEffect(() => {
    if (!ready) return;

    if (userKeyRef.current === userId) return;

    userKeyRef.current = userId;
    savedSignatureRef.current = predictionSignature;
    setAutoSaveState("idle");
  }, [prediction.updatedAt, predictionSignature, ready, userId]);

  useEffect(() => {
    if (!ready || !userId) return;
    if (predictionSignature === savedSignatureRef.current) return;

    if (hideSavedTimerRef.current) {
      window.clearTimeout(hideSavedTimerRef.current);
      hideSavedTimerRef.current = null;
    }

    setAutoSaveState("pending");
    const timer = window.setTimeout(async () => {
      autoSaveTimerRef.current = null;
      const runId = saveRunRef.current + 1;
      saveRunRef.current = runId;
      const signatureToSave = predictionSignature;

      setAutoSaveState("saving");
      const result = await savePrediction(false);
      if (saveRunRef.current !== runId) return;

      if (!result.ok) {
        setAutoSaveState("error");
        toast.error("No se ha podido guardar", { description: result.message });
        return;
      }

      savedSignatureRef.current = signatureToSave;
      if (latestSignatureRef.current === signatureToSave) {
        setAutoSaveState("saved");
        hideSavedTimerRef.current = window.setTimeout(() => {
          if (latestSignatureRef.current === signatureToSave) {
            setAutoSaveState("idle");
          }
          hideSavedTimerRef.current = null;
        }, 1800);
      } else {
        setAutoSaveState("pending");
      }
    }, 1200);
    autoSaveTimerRef.current = timer;

    return () => {
      window.clearTimeout(timer);
      if (autoSaveTimerRef.current === timer) {
        autoSaveTimerRef.current = null;
      }
    };
  }, [predictionSignature, ready, savePrediction, userId]);

  useEffect(() => {
    if (section !== "groups" || groupsIntroQueuedRef.current) return;

    try {
      if (window.localStorage.getItem(groupsIntroStorageKey) === "1") {
        return;
      }
    } catch {
      // Ignore storage failures; the modal can still be shown this session.
    }

    groupsIntroQueuedRef.current = true;
    const frame = window.requestAnimationFrame(() => {
      setShowGroupsIntroModal(true);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [section]);

  useEffect(() => {
    if (section !== "results" || resultsIntroQueuedRef.current) return;

    try {
      if (window.localStorage.getItem(resultsIntroStorageKey) === "1") {
        return;
      }
    } catch {
      // Ignore storage failures; the modal can still be shown this session.
    }

    resultsIntroQueuedRef.current = true;
    const frame = window.requestAnimationFrame(() => {
      setShowResultsIntroModal(true);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [section]);

  useEffect(() => {
    if (section !== "knockout" || knockoutIntroQueuedRef.current) return;

    try {
      if (window.localStorage.getItem(knockoutIntroStorageKey) === "1") {
        return;
      }
    } catch {
      // Ignore storage failures; the modal can still be shown this session.
    }

    knockoutIntroQueuedRef.current = true;
    const frame = window.requestAnimationFrame(() => {
      setShowKnockoutIntroModal(true);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [section]);

  const dismissResultsIntroModal = () => {
    resultsIntroQueuedRef.current = true;
    try {
      window.localStorage.setItem(resultsIntroStorageKey, "1");
    } catch {
      // Ignore storage failures.
    }
    setShowResultsIntroModal(false);
  };
  const dismissGroupsIntroModal = () => {
    groupsIntroQueuedRef.current = true;
    try {
      window.localStorage.setItem(groupsIntroStorageKey, "1");
    } catch {
      // Ignore storage failures.
    }
    setShowGroupsIntroModal(false);
  };
  const dismissKnockoutIntroModal = () => {
    knockoutIntroQueuedRef.current = true;
    try {
      window.localStorage.setItem(knockoutIntroStorageKey, "1");
    } catch {
      // Ignore storage failures.
    }
    setShowKnockoutIntroModal(false);
  };
  const openSaveAccountModal = () => {
    setAuthMode("register");
    setAuthOpen(true);
  };

  return (
    <div className="mx-auto max-w-3xl pb-44 sm:pb-32">
      <SectionHeading eyebrow="Porra" title="Juega el Mundial" />

      <div className="space-y-4">
        {!user ? (
          <Notice tone="warm">
            Puedes rellenar cada apartado hasta el momento en el que comienza la
            fase.
          </Notice>
        ) : null}
        {tournamentLocked ? (
          <Notice>
            Elecciones, once y grupos estan cerrados. Los resultados siguen
            abiertos hasta el inicio de cada partido.
          </Notice>
        ) : null}

        <StepTabs
          section={section}
          progresses={sectionProgresses}
          onSectionChange={changeSection}
        />

        <div className="min-h-[520px]">
          {section === "extras" ? (
            <TusElecciones
              disabled={tournamentLocked}
              prediction={prediction}
              onExtraChange={setPredictionExtra}
            />
          ) : null}

          {section === "xi" ? (
            <LineupBuilder
              formation={prediction.xiFormation}
              selectedPlayerIds={prediction.xi}
              disabled={tournamentLocked}
              onFormationChange={setXiFormation}
              onSelectionChange={setXiSelection}
            />
          ) : null}

          {section === "groups" ? (
            <GroupStage
              prediction={prediction}
              disabled={tournamentLocked}
              onReplaceGroupOrder={replaceGroupOrder}
              onToggleThirdQualifier={toggleThirdQualifier}
            />
          ) : null}

          {section === "knockout" ? (
            <FinalPhaseSection
              prediction={prediction}
              matches={finalPhaseMatches}
              isMatchLocked={hasMatchStarted}
              onWinnerSelect={chooseMatchWinner}
            />
          ) : null}

          {section === "results" ? (
            <ResultsSchedule
              matches={visibleMatches}
              prediction={prediction}
              onScoreChange={setPredictionScore}
            />
          ) : null}
        </div>
      </div>

      <StepActionBar
        autoSaveState={autoSaveState === "idle" ? null : autoSaveState}
        section={section}
        progresses={sectionProgresses}
        onSectionChange={changeSection}
        onCreateAccount={openSaveAccountModal}
        hasUser={Boolean(user)}
      />

      {showResultsIntroModal ? (
        <ResultsIntroModal onClose={dismissResultsIntroModal} />
      ) : null}

      {showGroupsIntroModal ? (
        <GroupsIntroModal onClose={dismissGroupsIntroModal} />
      ) : null}

      {showKnockoutIntroModal ? (
        <KnockoutIntroModal onClose={dismissKnockoutIntroModal} />
      ) : null}

      <AuthModal
        defaultMode="register"
        open={authOpen}
        onOpenChange={setAuthOpen}
        predictionToSaveOnRegister={prediction}
      />
    </div>
  );
}

function getSectionProgresses(
  prediction: Prediction,
  visibleMatches: Match[],
  finalPhaseMatches: Match[],
): Record<SectionId, SectionProgress> {
  const completedGroups = Object.values(prediction.groups).filter((group) => {
    const positions = Object.values(group).filter(Boolean);
    return positions.length === 4 && new Set(positions).size === 4;
  }).length;
  const thirdDone = Math.min(prediction.bracket.thirdQualifiers.length, 8);
  const counts = xiCounts(prediction);
  const requirements = xiRequirements(prediction.xiFormation);
  const requiredPlayers = Object.values(requirements).reduce(
    (total, count) => total + count,
    0,
  );
  const selectedPlayers = Math.min(
    requiredPlayers,
    Object.entries(requirements).reduce(
      (total, [position, limit]) =>
        total + Math.min(counts[position as Position], limit),
      0,
    ),
  );
  const visibleKnockoutMatches = finalPhaseMatches.filter((match) =>
    isMatchVisibleForPrediction(match, prediction),
  );
  const knockoutDone = visibleKnockoutMatches.filter((match) =>
    Boolean(prediction.bracket.winners[String(match.number)]),
  ).length;
  const resultsDone = visibleMatches.filter((match) =>
    isMatchPredictionComplete(match, prediction),
  ).length;
  const extrasDone = extraPredictionFields.filter((key) =>
    Boolean(prediction.extras[key]),
  ).length;

  const makeProgress = (done: number, total: number): SectionProgress => ({
    done,
    total,
    status: total > 0 && done >= total ? "complete" : "pending",
  });

  return {
    extras: makeProgress(extrasDone, extraPredictionFields.length),
    xi: makeProgress(selectedPlayers, requiredPlayers),
    groups: makeProgress(
      completedGroups + thirdDone,
      Object.keys(prediction.groups).length + 8,
    ),
    knockout: makeProgress(knockoutDone, visibleKnockoutMatches.length),
    results: makeProgress(resultsDone, visibleMatches.length),
  };
}

function AutoSaveStatus({ state }: { state: AutoSaveState }) {
  const config = {
    idle: {
      label: "Sin guardar",
      className: "border-white/10 bg-white/[0.04] text-zinc-400",
      icon: <span className="h-2 w-2 rounded-full bg-zinc-500" />,
    },
    pending: {
      label: "Cambios pendientes",
      className: "border-yellow-300/20 bg-yellow-300/10 text-yellow-100",
      icon: (
        <span className="h-2.5 w-2.5 rounded-full bg-yellow-300 shadow-[0_0_16px_rgba(253,224,71,0.35)] animate-pulse" />
      ),
    },
    saving: {
      label: "Guardando...",
      className: "border-[#a7f600]/20 bg-[#a7f600]/10 text-zinc-100",
      icon: (
        <span className="h-4 w-4 rounded-full border-2 border-[#a7f600]/25 border-t-[#a7f600] animate-spin" />
      ),
    },
    saved: {
      label: "Guardado",
      className: "border-[#a7f600]/30 bg-[#a7f600]/12 text-white",
      icon: (
        <span className="autosave-check-pop flex h-5 w-5 items-center justify-center rounded-full bg-[#a7f600] text-black shadow-[0_0_18px_rgba(167,246,0,0.35)]">
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className="h-3.5 w-3.5"
            fill="none"
          >
            <path
              d="M3.4 8.2 6.5 11.1 12.8 4.8"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.4"
            />
          </svg>
        </span>
      ),
    },
    error: {
      label: "Error al guardar",
      className: "border-rose-400/25 bg-rose-400/10 text-rose-100",
      icon: (
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-rose-400 text-xs font-bold text-black">
          !
        </span>
      ),
    },
  } satisfies Record<
    AutoSaveState,
    { label: string; className: string; icon: ReactNode }
  >;
  const current = config[state];

  return (
    <div
      key={state}
      aria-live="polite"
      className={`autosave-status-pop inline-flex h-8 min-w-0 items-center gap-2 rounded-full border px-2.5 text-xs font-bold transition sm:h-9 sm:px-3 sm:text-sm ${current.className}`}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">
        {current.icon}
      </span>
      <span className="truncate">{current.label}</span>
    </div>
  );
}

function StepTabs({
  section,
  progresses,
  onSectionChange,
}: {
  section: SectionId;
  progresses: Record<SectionId, SectionProgress>;
  onSectionChange: (section: SectionId) => void;
}) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 py-2 sm:-mx-6 sm:px-6 md:mx-0 md:overflow-visible md:px-0">
      <div className="flex w-max max-w-none gap-1 rounded-xl border border-white/10 bg-white/[0.045] p-1 md:relative md:left-1/2 md:grid md:w-[calc(100vw-3rem)] md:max-w-5xl md:-translate-x-1/2 md:grid-cols-5">
        {sections.map((tab) => {
          const active = section === tab.id;
          const complete = progresses[tab.id].status === "complete";

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSectionChange(tab.id)}
              className={`relative flex h-12 min-w-[9.25rem] items-center justify-center gap-2 rounded-lg px-2 text-xs font-bold transition sm:h-14 sm:text-sm md:min-w-0 ${
                active
                  ? "bg-white text-black shadow-[0_0_0_1px_rgba(255,255,255,0.22)]"
                  : complete
                    ? "bg-[#a7f600]/10 text-zinc-100 hover:bg-[#a7f600]/14"
                    : "bg-white/[0.035] text-zinc-300 hover:bg-white/[0.08] hover:text-white"
              }`}
            >
              <span
                className={`flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-[11px] ${
                  active
                    ? "bg-black text-white"
                    : complete
                      ? "bg-[#a7f600]/18 text-[#a7f600]"
                      : "bg-white/10 text-zinc-400"
                }`}
              >
                {tab.step}
              </span>
              <span className="min-w-0 truncate">{tab.label}</span>
              <StepStatusBadge progress={progresses[tab.id]} active={active} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StepActionBar({
  autoSaveState,
  hasUser,
  onCreateAccount,
  section,
  progresses,
  onSectionChange,
}: {
  autoSaveState: AutoSaveState | null;
  hasUser: boolean;
  onCreateAccount: () => void;
  section: SectionId;
  progresses: Record<SectionId, SectionProgress>;
  onSectionChange: (section: SectionId) => void;
}) {
  const currentIndex = sections.findIndex((tab) => tab.id === section);
  const previous = sections[currentIndex - 1];
  const next = sections[currentIndex + 1];
  const progress = progresses[section];

  return (
    <div className="fixed bottom-2 left-2 right-2 z-40 sm:bottom-4 sm:left-4 sm:right-4">
      <div className="mx-auto flex max-w-5xl flex-col gap-2 rounded-2xl border border-white/10 bg-[#101010]/94 p-2 shadow-[0_18px_60px_rgba(0,0,0,0.42)] backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {autoSaveState ? <AutoSaveStatus state={autoSaveState} /> : null}
          <SectionProgressStatus progress={progress} />
        </div>

        <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0 sm:items-center">
          <button
            type="button"
            disabled={!previous}
            onClick={() => previous && onSectionChange(previous.id)}
            className="h-10 rounded-lg border border-white/10 bg-white/[0.06] px-2 text-sm font-semibold text-zinc-300 transition hover:bg-white/[0.10] hover:text-white disabled:cursor-not-allowed disabled:opacity-35 sm:px-3"
          >
            Anterior
          </button>

          {next ? (
            <button
              type="button"
              onClick={() => onSectionChange(next.id)}
              className="inline-flex h-10 min-w-0 items-center justify-center rounded-lg border border-white/12 bg-white/[0.10] px-2 text-sm font-semibold text-white transition hover:border-white/18 hover:bg-white/[0.14] sm:px-3"
            >
              <span>Siguiente</span>
              <span className="hidden text-zinc-400 md:inline">
                : {next.label}
              </span>
            </button>
          ) : hasUser ? (
            <Link
              href="/perfil"
              className="inline-flex h-10 items-center justify-center rounded-lg border border-white/12 bg-white/[0.10] px-2 text-sm font-semibold text-white transition hover:border-white/18 hover:bg-white/[0.14] sm:px-3"
            >
              Finalizar
            </Link>
          ) : (
            <button
              type="button"
              onClick={onCreateAccount}
              className="inline-flex h-10 items-center justify-center rounded-lg border border-white/12 bg-[#a7f600] px-2 text-sm font-semibold text-black transition hover:bg-[#c7ff43] sm:px-3"
            >
              Finalizar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function GroupsIntroModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="groups-intro-title"
    >
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-[#151515] text-white shadow-2xl shadow-black/50">
        <div className="border-b border-white/10 p-5">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#a7f600]">
            Fase de grupos
          </p>
          <h3
            id="groups-intro-title"
            className="mt-1 text-2xl font-bold tracking-tight"
          >
            Ordena y elige terceros
          </h3>
        </div>

        <div className="space-y-4 p-5">
          <div className="rounded-lg border border-white/10 bg-black/20 p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-sm font-bold text-white">Grupo A</p>
              <span className="rounded-md bg-white/[0.06] px-2 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-400">
                Ordenar
              </span>
            </div>

            <div className="relative h-44 overflow-hidden rounded-lg border border-white/10 bg-[#101010] p-2">
              <GroupIntroDemoRow
                label="ALE"
                orderIndex={0}
                rank={1}
                tone="black-red-gold"
              />
              <GroupIntroDemoRow
                className="groups-demo-row-shift-down"
                label="MEX"
                nextRank={3}
                orderIndex={1}
                rank={2}
                tone="green-white-red"
              />
              <GroupIntroDemoRow
                className="groups-demo-row-active z-10"
                label="FRA"
                nextRank={2}
                orderIndex={2}
                rank={3}
                tone="blue-white-red"
              />
              <GroupIntroDemoRow
                label="JPN"
                orderIndex={3}
                rank={4}
                tone="white-red"
              />
            </div>
          </div>

          <div className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3 rounded-lg border border-white/10 bg-white/[0.04] p-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#a7f600] text-sm font-bold text-black">
              1
            </span>
            <div>
              <p className="font-bold text-white">Arrastra los grupos</p>
              <p className="mt-1 text-sm leading-5 text-zinc-400">
                Ordena cada grupo de primero a cuarto.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3 rounded-lg border border-white/10 bg-white/[0.04] p-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-sm font-bold text-black">
              2
            </span>
            <div>
              <p className="font-bold text-white">Marca los terceros</p>
              <p className="mt-1 text-sm leading-5 text-zinc-400">
                Luego haz click mas abajo en los 8 terceros clasificados.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="mt-2 w-full rounded-lg bg-[#a7f600] px-4 py-3 text-sm font-bold text-black transition hover:bg-[#c7ff43]"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
}

function GroupIntroDemoRow({
  className = "",
  label,
  nextRank,
  orderIndex,
  rank,
  tone,
}: {
  className?: string;
  label: string;
  nextRank?: number;
  orderIndex: number;
  rank: number;
  tone:
    | "black-red-gold"
    | "blue-white-red"
    | "green-white-red"
    | "white-red";
}) {
  return (
    <div
      className={`absolute left-2 right-2 grid h-9 select-none grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-white/10 bg-white/[0.05] px-2 ${className}`}
      style={{ top: 8 + orderIndex * 42 }}
    >
      <span className="relative flex h-7 w-7 items-center justify-center overflow-hidden rounded-md bg-white/[0.08] text-xs font-bold text-[#a7f600]">
        <span className={nextRank ? "groups-demo-rank-from" : ""}>
          {rank}
        </span>
        {nextRank ? (
          <span className="groups-demo-rank-to absolute inset-0 flex items-center justify-center">
            {nextRank}
          </span>
        ) : null}
      </span>
      <div className="flex min-w-0 items-center gap-2">
        <span
          className="h-5 w-5 shrink-0 rounded-full border border-white/15"
          style={{ background: getDemoFlagBackground(tone) }}
        />
        <span className="truncate text-sm font-bold text-white">{label}</span>
      </div>
      <span className="rounded-md px-2 py-1 text-base font-bold text-zinc-500">
        ☰
      </span>
    </div>
  );
}

function KnockoutIntroModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="knockout-intro-title"
    >
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-[#151515] text-white shadow-2xl shadow-black/50">
        <div className="border-b border-white/10 p-5">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#a7f600]">
            Fase final
          </p>
          <h3
            id="knockout-intro-title"
            className="mt-1 text-2xl font-bold tracking-tight"
          >
            Elige quien pasa
          </h3>
        </div>

        <div className="space-y-4 p-5">
          <div className="rounded-lg border border-white/10 bg-black/20 p-3">
            <div className="grid grid-cols-[minmax(0,1fr)_1.5rem_minmax(0,1fr)] items-center gap-2">
              <div className="space-y-2">
                <div className="rounded-lg border border-white/10 bg-[#101010] p-2">
                  <div className="grid grid-cols-2 gap-2">
                    <KnockoutDemoTeam
                      label="ALE"
                      tone="black-red-gold"
                      className="knockout-demo-pick-first"
                    />
                    <KnockoutDemoTeam label="MEX" tone="green-white-red" />
                  </div>
                  <p className="mt-1 text-center text-[11px] font-semibold text-zinc-500">
                    29 jun
                  </p>
                </div>

                <div className="rounded-lg border border-white/10 bg-[#101010] p-2">
                  <div className="grid grid-cols-2 gap-2">
                    <KnockoutDemoTeam
                      label="FRA"
                      tone="blue-white-red"
                      className="knockout-demo-pick-second"
                    />
                    <KnockoutDemoTeam label="JPN" tone="white-red" />
                  </div>
                  <p className="mt-1 text-center text-[11px] font-semibold text-zinc-500">
                    30 jun
                  </p>
                </div>
              </div>

              <div className="relative h-full min-h-32">
                <span className="absolute left-0 top-[25%] h-px w-full bg-white/12" />
                <span className="absolute left-0 top-[75%] h-px w-full bg-white/12" />
                <span className="absolute right-0 top-[25%] h-1/2 w-px bg-white/12" />
                <span className="absolute right-0 top-1/2 h-px w-full bg-white/12" />
              </div>

              <div className="rounded-lg border border-white/10 bg-[#101010] p-2">
                <div className="grid grid-cols-2 gap-2">
                  <KnockoutDemoTeam
                    label="ALE"
                    tone="black-red-gold"
                    className="knockout-demo-next-first"
                  />
                  <KnockoutDemoTeam
                    label="FRA"
                    tone="blue-white-red"
                    className="knockout-demo-next-second"
                  />
                </div>
                <p className="mt-1 text-center text-[11px] font-semibold text-zinc-500">
                  4 jul
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
            <p className="text-sm leading-6 text-zinc-300">
              Pulsa sobre el ganador de cada cruce para elegir quien pasa de
              fase. El cuadro se ira completando con tus elecciones.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-lg bg-[#a7f600] px-4 py-3 text-sm font-bold text-black transition hover:bg-[#c7ff43]"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
}

function getDemoFlagBackground(
  tone:
    | "black-red-gold"
    | "blue-white-red"
    | "green-white-red"
    | "neutral"
    | "white-red",
) {
  return tone === "black-red-gold"
    ? "linear-gradient(180deg, #151515 0 33%, #ef4444 33% 66%, #facc15 66%)"
    : tone === "blue-white-red"
      ? "linear-gradient(90deg, #2563eb 0 33%, #f8fafc 33% 66%, #ef4444 66%)"
      : tone === "green-white-red"
        ? "linear-gradient(90deg, #15803d 0 33%, #f8fafc 33% 66%, #dc2626 66%)"
        : tone === "white-red"
          ? "radial-gradient(circle, #dc2626 0 34%, transparent 35%), #f8fafc"
          : "#3f3f46";
}

function KnockoutDemoTeam({
  className = "",
  dimmed = false,
  label,
  tone = "neutral",
}: {
  className?: string;
  dimmed?: boolean;
  label: string;
  tone?:
    | "black-red-gold"
    | "blue-white-red"
    | "green-white-red"
    | "neutral"
    | "white-red";
}) {
  const flagBackground = getDemoFlagBackground(tone);

  return (
    <div
      className={`relative flex min-w-0 flex-col items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-2 text-center ${dimmed ? "opacity-45" : ""} ${className}`}
    >
      <span
        className="h-5 w-5 rounded-full border border-white/15"
        style={{ background: flagBackground }}
      />
      <span className="max-w-full truncate text-[11px] font-black text-white">
        {label}
      </span>
    </div>
  );
}

function ResultsIntroModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="results-intro-title"
    >
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#151515] p-5 text-white shadow-2xl shadow-black/50">
        <div className="mb-4 flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-yellow-300/15 text-yellow-200">
            <span className="h-2.5 w-2.5 rounded-full bg-yellow-300" />
          </span>
          <div>
            <h3
              id="results-intro-title"
              className="text-xl font-bold tracking-tight"
            >
              Resultados abiertos
            </h3>
            <p className="mt-2 text-sm leading-6 text-zinc-300">
              Puedes volver y rellenar o cambiar cada resultado hasta la hora de
              comienzo de ese partido.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-2 w-full rounded-lg bg-white px-4 py-3 text-sm font-bold text-black transition hover:bg-zinc-200"
        >
          Entendido
        </button>
      </div>
    </div>
  );
}

function SectionProgressStatus({ progress }: { progress: SectionProgress }) {
  const complete = progress.status === "complete";

  return (
    <div
      className={`inline-flex h-8 shrink-0 items-center gap-2 rounded-full border px-2.5 text-xs font-bold sm:h-9 sm:px-3 sm:text-sm ${
        complete
          ? "border-[#a7f600]/30 bg-[#a7f600]/12 text-[#a7f600]"
          : "border-yellow-300/25 bg-yellow-300/10 text-yellow-100"
      }`}
      aria-label={
        complete
          ? "Seccion completa"
          : `Incompleto ${progress.done} de ${progress.total}`
      }
      title={
        complete
          ? "Seccion completa"
          : `Incompleto ${progress.done}/${progress.total}`
      }
    >
      {complete ? (
        <>
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#a7f600] text-black">
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              className="h-3.5 w-3.5"
              fill="none"
            >
              <path
                d="M3.4 8.2 6.5 11.1 12.8 4.8"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2.4"
              />
            </svg>
          </span>
          <span>Completo</span>
        </>
      ) : (
        <>
          <span className="h-2 w-2 rounded-full bg-yellow-300 shadow-[0_0_14px_rgba(253,224,71,0.28)]" />
          <span>
            Incompleto {progress.done}/{progress.total}
          </span>
        </>
      )}
    </div>
  );
}

function StepStatusBadge({
  progress,
  active,
}: {
  progress: SectionProgress;
  active: boolean;
}) {
  const complete = progress.status === "complete";

  return (
    <span
      aria-label={
        complete ? "Completa" : `${progress.done} de ${progress.total}`
      }
      title={complete ? "Completa" : `${progress.done}/${progress.total}`}
      className={`inline-flex h-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[10px] font-bold ${
        complete
          ? active
            ? "bg-[#a7f600] text-black"
            : "bg-[#a7f600]/14 text-[#a7f600]"
          : active
            ? "bg-yellow-300 text-black"
            : "bg-yellow-300/18 text-yellow-200"
      }`}
    >
      {complete ? (
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className="h-3 w-3"
          fill="none"
        >
          <path
            d="M3.4 8.2 6.5 11.1 12.8 4.8"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2.4"
          />
        </svg>
      ) : (
        `${progress.done}/${progress.total}`
      )}
    </span>
  );
}

function TusElecciones({
  disabled,
  prediction,
  onExtraChange,
}: {
  disabled: boolean;
  prediction: Prediction;
  onExtraChange: (key: keyof Prediction["extras"], value: string) => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-white">
          Tus elecciones
        </h2>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <ChoiceBlock points={25}>
          <TeamPicker
            label="Ganador del mundial"
            value={prediction.extras.worldChampion}
            disabled={disabled}
            controlClassName="mt-4"
            onChange={(value) => onExtraChange("worldChampion", value)}
          />
        </ChoiceBlock>
        <ChoiceBlock points={10}>
          <TeamPicker
            label="Equipo mas goleador"
            value={prediction.extras.highestScoringTeam}
            disabled={disabled}
            controlClassName="mt-4"
            onChange={(value) => onExtraChange("highestScoringTeam", value)}
          />
        </ChoiceBlock>
        <ChoiceBlock points={10}>
          <TeamPicker
            label="Equipo mas goleado"
            value={prediction.extras.mostConcededTeam}
            disabled={disabled}
            controlClassName="mt-4"
            onChange={(value) => onExtraChange("mostConcededTeam", value)}
          />
        </ChoiceBlock>
        <ChoiceBlock points={10}>
          <TeamPicker
            label="Equipo con mas rojas"
            value={prediction.extras.mostRedsTeam}
            disabled={disabled}
            controlClassName="mt-4"
            onChange={(value) => onExtraChange("mostRedsTeam", value)}
          />
        </ChoiceBlock>
        <ChoiceBlock points={20}>
          <ExtraPlayerField
            label="Maximo goleador"
            value={prediction.extras.topScorer}
            disabled={disabled}
            onChange={(value) => onExtraChange("topScorer", value)}
            initialPosition="DEL"
          />
        </ChoiceBlock>
        <ChoiceBlock points={20}>
          <ExtraPlayerField
            label="MVP"
            value={prediction.extras.mvp}
            disabled={disabled}
            onChange={(value) => onExtraChange("mvp", value)}
            initialPosition="MED"
          />
        </ChoiceBlock>
      </div>
    </div>
  );
}

function ChoiceBlock({
  points,
  children,
}: {
  points: number;
  children: React.ReactNode;
}) {
  return (
    <div className="relative rounded-lg border border-white/10 bg-[#151515] p-4">
      <span className="absolute right-3 top-3 rounded-md bg-[#a7f600] px-2 py-0.5 text-[11px] font-semibold text-black">
        {points} pts
      </span>
      <div className="pr-16">{children}</div>
    </div>
  );
}

function ExtraPlayerField({
  label,
  value,
  disabled,
  initialPosition,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  initialPosition: Position;
  onChange: (value: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const player = value ? playersById.get(value) : null;

  return (
    <div className="text-sm text-zinc-300">
      <span>{label}</span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(true)}
        className="mt-4 grid min-h-14 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-white/10 bg-[#0f0f0f] px-3 py-2 text-left text-white outline-none ring-[#a7f600] transition hover:border-white/20 focus:ring-2 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {player ? (
          <PlayerAvatar
            player={player}
            className="h-9 w-9 rounded-full bg-zinc-900 text-xs text-lime-100"
          />
        ) : (
          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-lg font-bold text-zinc-500">
            +
          </span>
        )}
        <span className="min-w-0">
          <span
            className={`block truncate text-sm font-bold ${player ? "text-white" : "text-zinc-500"}`}
          >
            {player?.name || "Elige un jugador"}
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs font-semibold text-zinc-500">
            {player ? (
              <TeamFlag teamId={player.team} className="h-3.5 w-5 rounded-sm" />
            ) : null}
            <span className="truncate">
              {player
                ? teamsById.get(player.team)?.name || "Sin pais"
                : "Portero, defensa, centro o delantero"}
            </span>
          </span>
        </span>
        <span className="rounded-md bg-white/[0.06] px-2 py-1 text-[11px] font-bold text-zinc-300">
          {player ? positionLabels[player.position] : "Elegir"}
        </span>
      </button>

      {isOpen ? (
        <ExtraPlayerPickerModal
          title={label}
          currentPlayer={player || undefined}
          initialPosition={player?.position || initialPosition}
          onClose={() => setIsOpen(false)}
          onRemove={() => {
            onChange("");
            setIsOpen(false);
          }}
          onSelect={(playerId) => {
            onChange(playerId);
            setIsOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

function ExtraPlayerPickerModal({
  title,
  currentPlayer,
  initialPosition,
  onClose,
  onRemove,
  onSelect,
}: {
  title: string;
  currentPlayer?: Player;
  initialPosition: Position;
  onClose: () => void;
  onRemove: () => void;
  onSelect: (playerId: string) => void;
}) {
  const [activePosition, setActivePosition] =
    useState<Position>(initialPosition);
  const [query, setQuery] = useState("");

  const visiblePlayers = useMemo(() => {
    const normalized = query.trim().toLowerCase();

    return data.players
      .filter((player) => player.position === activePosition)
      .filter((player) => {
        if (!normalized) return true;
        const team = teamsById.get(player.team)?.name || "";
        return `${player.name} ${team}`.toLowerCase().includes(normalized);
      })
      .sort((a, b) => {
        const teamCompare = (teamsById.get(a.team)?.name || "").localeCompare(
          teamsById.get(b.team)?.name || "",
        );
        return teamCompare || a.name.localeCompare(b.name);
      });
  }, [activePosition, query]);

  const groupedPlayers = useMemo(() => {
    const groups = new Map<string, Player[]>();

    visiblePlayers.forEach((player) => {
      const country = teamsById.get(player.team)?.name || "Sin pais";
      groups.set(country, [...(groups.get(country) || []), player]);
    });

    return Array.from(groups.entries());
  }, [visiblePlayers]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-3 py-5 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="flex max-h-[78vh] w-full max-w-[440px] flex-col overflow-hidden rounded-2xl bg-white text-slate-950 shadow-2xl">
        <div className="border-b border-slate-100 p-3">
          <div className="grid grid-cols-4 rounded-xl bg-slate-100 p-1">
            {positionTabs.map((position) => (
              <button
                key={position.id}
                type="button"
                aria-pressed={activePosition === position.id}
                onClick={() => setActivePosition(position.id)}
                className={`h-9 rounded-lg px-1 text-[11px] font-bold transition sm:text-xs ${
                  activePosition === position.id
                    ? "bg-white text-emerald-700 shadow-sm"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {position.label}
              </button>
            ))}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <label className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-slate-100 px-3 py-2">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={`Buscar ${positionLabels[activePosition].toLowerCase()}`}
                className="min-w-0 flex-1 bg-transparent text-base font-medium text-slate-900 outline-none placeholder:text-slate-400"
              />
            </label>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full px-2 py-1 text-sm font-semibold text-emerald-700"
            >
              Cancelar
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-3 pt-2">
          {currentPlayer ? (
            <button
              type="button"
              onClick={onRemove}
              className="mb-3 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700"
            >
              Quitar jugador
            </button>
          ) : null}

          <div className="space-y-2">
            {groupedPlayers.map(([country, countryPlayers]) => (
              <div key={country} className="space-y-1">
                <div className="flex items-center gap-2 py-1 text-xs font-bold uppercase text-slate-500">
                  <TeamFlag
                    teamId={countryPlayers[0]?.team}
                    className="h-4 w-5 rounded-sm"
                  />
                  <span>{country}</span>
                </div>
                {countryPlayers.map((player) => {
                  const selected = player.id === currentPlayer?.id;

                  return (
                    <button
                      key={player.id}
                      type="button"
                      onClick={() => onSelect(player.id)}
                      className={`grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-xl px-2 py-1.5 text-left transition ${
                        selected ? "bg-emerald-50" : "hover:bg-slate-100"
                      }`}
                    >
                      <PlayerAvatar
                        player={player}
                        className="h-8 w-8 rounded-full bg-slate-100 text-[10px] text-emerald-900"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold leading-4 text-slate-950">
                          {player.name}
                        </p>
                        <p className="text-xs leading-4 text-slate-500">
                          {teamsById.get(player.team)?.name || "Sin pais"}
                        </p>
                      </div>
                      {selected ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                          Elegido
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ))}

            {!visiblePlayers.length ? (
              <p className="rounded-xl bg-slate-100 px-3 py-4 text-sm text-slate-500">
                No hay jugadores para esa busqueda.
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function GroupStage({
  prediction,
  disabled,
  onReplaceGroupOrder,
  onToggleThirdQualifier,
}: {
  prediction: Prediction;
  disabled: boolean;
  onReplaceGroupOrder: (group: string, teamIds: string[]) => void;
  onToggleThirdQualifier: (group: string) => void;
}) {
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 220, tolerance: 10 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const [activeGroupTeam, setActiveGroupTeam] = useState<{
    group: string;
    teamId: string;
  } | null>(null);
  const [overGroupTeam, setOverGroupTeam] = useState<{
    group: string;
    teamId: string;
  } | null>(null);
  const groups = Object.keys(prediction.groups);
  const selectedThirdGroups = prediction.bracket.thirdQualifiers.filter(
    (group, index, list) =>
      groups.includes(group) && list.indexOf(group) === index,
  );
  const thirdRows = groups.map((group) => ({
    group,
    teamId: groupTeamAt(group, 3, prediction),
    selected: selectedThirdGroups.includes(group),
  }));
  const thirdLimitReached = selectedThirdGroups.length >= 8;

  const handleGroupDragStart = (group: string, event: DragStartEvent) => {
    setActiveGroupTeam({ group, teamId: String(event.active.id) });
  };

  const handleGroupDragOver = (group: string, event: DragOverEvent) => {
    setOverGroupTeam(
      event.over ? { group, teamId: String(event.over.id) } : null,
    );
  };

  const handleGroupDragEnd = (group: string, event: DragEndEvent) => {
    const activeTeamId = String(event.active.id);
    const overTeamId = event.over ? String(event.over.id) : "";
    setActiveGroupTeam(null);
    setOverGroupTeam(null);

    if (!overTeamId || activeTeamId === overTeamId) return;

    const ordered = orderedGroupTeams(group, prediction).map((team) => team.id);
    const from = ordered.indexOf(activeTeamId);
    const to = ordered.indexOf(overTeamId);

    if (from >= 0 && to >= 0) {
      onReplaceGroupOrder(group, arrayMove(ordered, from, to));
    }
  };

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold tracking-tight text-white">
          Fase de grupos
        </h2>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium leading-5 text-zinc-400">
          <span>Equipo que pasa acertado:</span>
          <span className="rounded-md bg-[#a7f600] px-2 py-0.5 text-[11px] font-semibold text-black">
            +2 pts
          </span>
          <span>Tercer clasificado acertado:</span>
          <span className="rounded-md bg-[#a7f600] px-2 py-0.5 text-[11px] font-semibold text-black">
            +1 pt
          </span>
          <span>Orden exacto en el grupo:</span>
          <span className="rounded-md bg-[#a7f600] px-2 py-0.5 text-[11px] font-semibold text-black">
            +3 pts
          </span>
        </p>
        <p className="text-sm text-zinc-500">
          Arrastra desde el asa de la derecha para ordenar primero, segundo,
          tercero y cuarto. Despues elige los 8 terceros que pasan.
        </p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {groups.map((group) => {
          const ordered = orderedGroupTeams(group, prediction);
          const orderedIds = ordered.map((team) => team.id);
          const completedCount = Object.values(prediction.groups[group]).filter(
            Boolean,
          ).length;
          return (
            <Card key={group} className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-white">Grupo {group}</h3>
                <span
                  className={`text-sm font-semibold ${
                    completedCount === 4 ? "text-[#a7f600]" : "text-zinc-500"
                  }`}
                >
                  {completedCount}/4
                </span>
              </div>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={(event) => handleGroupDragStart(group, event)}
                onDragOver={(event) => handleGroupDragOver(group, event)}
                onDragEnd={(event) => handleGroupDragEnd(group, event)}
                onDragCancel={() => {
                  setActiveGroupTeam(null);
                  setOverGroupTeam(null);
                }}
              >
                <SortableContext
                  items={orderedIds}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-2">
                    {ordered.map((team, index) => (
                      <SortableGroupTeamRow
                        key={team.id}
                        team={team}
                        index={index}
                        disabled={disabled}
                        isDropTarget={
                          overGroupTeam?.group === group &&
                          overGroupTeam.teamId === team.id &&
                          activeGroupTeam?.teamId !== team.id
                        }
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </Card>
          );
        })}
      </div>

      <Card className="space-y-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="text-xl font-bold tracking-tight text-white">
              Terceros clasificados
            </h3>
            <p className="text-sm text-zinc-400">
              Elige los 8 terceros que pasan. El orden no cuenta.
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-sm font-bold ${
              prediction.bracket.thirdQualifiers.length === 8
                ? "bg-[#a7f600] text-black"
                : "bg-yellow-300/15 text-yellow-200"
            }`}
          >
            {prediction.bracket.thirdQualifiers.length}/8
          </span>
        </div>

        <div className="space-y-3">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">
            Lista de terceros
          </p>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {thirdRows.map((row) => (
              <ThirdQualifierButton
                key={row.group}
                row={row}
                disabled={disabled}
                limitReached={thirdLimitReached}
                onToggle={onToggleThirdQualifier}
              />
            ))}
          </div>
        </div>

        {prediction.bracket.thirdQualifiers.length === 8 ? (
          <Notice>
            Los terceros ya estan completos. El cuadro de eliminacion puede
            resolver sus emparejamientos.
          </Notice>
        ) : (
          <Notice tone="warm">
            El cuadro se completara cuando haya 8 terceros clasificados
            seleccionados.
          </Notice>
        )}
      </Card>
    </div>
  );
}

function SortableGroupTeamRow({
  team,
  index,
  disabled,
  isDropTarget,
}: {
  team: Team;
  index: number;
  disabled: boolean;
  isDropTarget: boolean;
}) {
  const {
    attributes,
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: team.id, disabled });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? "none" : transition,
  };
  const isDirectQualifier = index < 2;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`grid touch-pan-y select-none grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border px-3 py-2 transition-colors ${
        isDropTarget
          ? "border-[#a7f600] bg-[#a7f600]/15 shadow-[0_0_0_1px_rgba(167,246,0,0.35),0_0_24px_rgba(167,246,0,0.12)]"
          : isDirectQualifier
            ? "border-[#a7f600]/25 bg-[#a7f600]/10"
            : "border-white/10 bg-white/[0.06]"
      } ${
        disabled
          ? "cursor-not-allowed opacity-50"
          : isDragging
            ? "cursor-grabbing opacity-60"
            : ""
      }`}
    >
      <span
        className={`text-sm font-bold ${
          isDirectQualifier ? "text-[#a7f600]" : "text-white"
        }`}
      >
        {index + 1}
      </span>
      <TeamBadge teamId={team.id} />
      <span
        ref={setActivatorNodeRef}
        aria-label={`Mover ${team.name}`}
        className={`flex h-9 w-9 touch-none items-center justify-center rounded-lg border border-white/10 bg-white/[0.06] text-lg font-bold text-zinc-400 transition ${
          disabled
            ? "cursor-not-allowed opacity-50"
            : isDragging
              ? "cursor-grabbing bg-white/10 text-white"
              : "cursor-grab hover:border-[#a7f600]/45 hover:bg-[#a7f600]/10 hover:text-white"
        }`}
        {...attributes}
        {...listeners}
      >
        ☰
      </span>
    </div>
  );
}

type ThirdQualifierRow = {
  group: string;
  selected: boolean;
  teamId: string;
};

function ThirdQualifierButton({
  row,
  disabled,
  limitReached,
  onToggle,
}: {
  row: ThirdQualifierRow;
  disabled: boolean;
  limitReached: boolean;
  onToggle: (group: string) => void;
}) {
  const isDisabled = disabled || !row.teamId || (!row.selected && limitReached);
  const toggle = () => {
    if (!isDisabled) onToggle(row.group);
  };
  const actionLabel = row.selected
    ? "Quitar"
    : limitReached
      ? "Completo"
      : "Elegir";

  return (
    <button
      type="button"
      disabled={isDisabled}
      aria-pressed={row.selected}
      onClick={toggle}
      className={`grid w-full grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
        row.selected
          ? "border-[#a7f600]/70 bg-[#a7f600]/12"
          : "border-white/10 bg-white/[0.04]"
      } ${
        isDisabled
          ? "cursor-not-allowed opacity-45"
          : "cursor-pointer hover:border-[#a7f600]/45 hover:bg-[#a7f600]/10"
      }`}
    >
      <span
        className={`flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold ${
          row.selected ? "bg-[#a7f600] text-black" : "bg-white/10 text-zinc-400"
        }`}
      >
        {row.group}
      </span>
      {row.teamId ? (
        <TeamBadge teamId={row.teamId} />
      ) : (
        <span className="text-sm text-zinc-500">Ordena el grupo primero</span>
      )}
      <span
        className={`text-xs font-bold ${
          row.selected ? "text-[#a7f600]" : "text-zinc-500"
        }`}
      >
        {actionLabel}
      </span>
    </button>
  );
}

function formationRows(formation: string): LineupRow[] {
  const parts = formation.split("-").map(Number).filter(Boolean);
  const defense = parts[0] || 4;
  const attack = parts[parts.length - 1] || 2;
  const midfield = parts.slice(1, -1).reverse();

  return [
    { position: "DEL", count: attack },
    ...midfield.map((count) => ({ position: "MED" as const, count })),
    { position: "DEF", count: defense },
    { position: "POR", count: 1 },
  ];
}

function lineupSlots(formation: string) {
  return formationRows(formation).flatMap((row, rowIndex) =>
    Array.from({ length: row.count }, (_, index) => ({
      id: `${rowIndex}-${index}-${row.position}`,
      row: rowIndex,
      index,
      position: row.position,
    })),
  );
}

function assignPlayersToSlots(
  playerIds: string[],
  formation: string,
): LineupSlot[] {
  const baseSlots = lineupSlots(formation);
  const isPositionalSelection =
    playerIds.length >= baseSlots.length ||
    playerIds.some((playerId) => !playerId);

  if (isPositionalSelection) {
    return baseSlots.map((slot, index) => {
      const playerId = playerIds[index];
      const player = playerId ? playersById.get(playerId) : null;

      return {
        ...slot,
        playerId: player?.position === slot.position ? playerId : undefined,
      };
    });
  }

  const used = new Set<string>();

  return baseSlots.map((slot) => {
    const playerId = playerIds.find(
      (id) => !used.has(id) && playersById.get(id)?.position === slot.position,
    );
    if (playerId) used.add(playerId);
    return { ...slot, playerId };
  });
}

function slotSelection(slots: LineupSlot[]) {
  return slots.map((slot) => slot.playerId || "");
}

function LineupBuilder({
  formation,
  selectedPlayerIds,
  disabled,
  onFormationChange,
  onSelectionChange,
}: {
  formation: string;
  selectedPlayerIds: string[];
  disabled: boolean;
  onFormationChange: (formation: string) => void;
  onSelectionChange: (playerIds: string[]) => void;
}) {
  const [activeSlotId, setActiveSlotId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const slots = useMemo(
    () => assignPlayersToSlots(selectedPlayerIds, formation),
    [formation, selectedPlayerIds],
  );
  const activeSlot = slots.find((slot) => slot.id === activeSlotId) || null;
  const filledCount = slots.filter((slot) => slot.playerId).length;
  const rows = formationRows(formation);
  const [isFormationAnimating, setIsFormationAnimating] = useState(false);
  const [animatedSlotId, setAnimatedSlotId] = useState<string | null>(null);
  const animatedSlotTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (animatedSlotTimerRef.current) {
        window.clearTimeout(animatedSlotTimerRef.current);
      }
    };
  }, []);

  const closeModal = () => {
    setActiveSlotId(null);
    setQuery("");
  };

  const selectPlayer = (playerId: string) => {
    if (!activeSlot) return;
    if (selectedPlayerIds.includes(playerId)) return;
    const nextAnimatedSlotId = activeSlot.id;
    const nextSlots = slots.map((slot) => {
      if (slot.id === activeSlot.id) return { ...slot, playerId };
      return slot;
    });
    if (animatedSlotTimerRef.current) {
      window.clearTimeout(animatedSlotTimerRef.current);
    }
    setAnimatedSlotId(nextAnimatedSlotId);
    animatedSlotTimerRef.current = window.setTimeout(() => {
      setAnimatedSlotId((current) =>
        current === nextAnimatedSlotId ? null : current,
      );
      animatedSlotTimerRef.current = null;
    }, 520);
    onSelectionChange(slotSelection(nextSlots));
    closeModal();
  };

  const removePlayer = () => {
    if (!activeSlot) return;
    onSelectionChange(
      slotSelection(
        slots.map((slot) =>
          slot.id === activeSlot.id ? { ...slot, playerId: undefined } : slot,
        ),
      ),
    );
    closeModal();
  };

  const changeFormation = (nextFormation: string) => {
    if (nextFormation === formation) return;

    const documentWithTransition = document as ViewTransitionDocument;

    if (documentWithTransition.startViewTransition) {
      documentWithTransition.startViewTransition(() => {
        flushSync(() => onFormationChange(nextFormation));
      });
      return;
    }

    setIsFormationAnimating(true);
    onFormationChange(nextFormation);
    window.setTimeout(() => setIsFormationAnimating(false), 260);
  };

  return (
    <div className="mx-auto w-full max-w-[620px] space-y-5">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold tracking-tight text-white">
          Tu once
        </h2>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium leading-6 text-zinc-400">
          <span>Gol delantero</span>
          <span className="rounded-md bg-[#a7f600] px-2 py-0.5 text-[11px] font-semibold text-black">
            +2 pts
          </span>
          <span>centrocampista</span>
          <span className="rounded-md bg-[#a7f600] px-2 py-0.5 text-[11px] font-semibold text-black">
            +6 pts
          </span>
          <span>defensa</span>
          <span className="rounded-md bg-[#a7f600] px-2 py-0.5 text-[11px] font-semibold text-black">
            +11 pts
          </span>
          <span>portero</span>
          <span className="rounded-md bg-[#a7f600] px-2 py-0.5 text-[11px] font-semibold text-black">
            +35 pts
          </span>
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-emerald-300/15 bg-emerald-600 shadow-2xl shadow-emerald-950/30 sm:rounded-3xl">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-emerald-950/20 px-4 py-3">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-50/75">
            Alineacion
          </p>
          <div className="flex items-center gap-2">
            <label className="relative w-32">
              <span className="sr-only">Formacion</span>
              <select
                value={formation}
                disabled={disabled}
                onChange={(event) => changeFormation(event.target.value)}
                className="h-9 w-full appearance-none rounded-full border border-white/10 bg-emerald-800/70 px-3 pr-8 text-sm font-semibold text-white outline-none ring-white/30 transition focus:ring-2 disabled:opacity-40"
              >
                {xiFormations.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-emerald-100">
                v
              </span>
            </label>
            <div className="rounded-full bg-emerald-950/35 px-3 py-1.5 text-sm font-semibold text-emerald-50">
              {filledCount}/11
            </div>
          </div>
        </div>

        <div
          className={`relative mx-2 my-4 aspect-[7/8] overflow-hidden rounded-2xl border border-emerald-200/20 bg-emerald-600 sm:mx-3 sm:my-6 sm:rounded-3xl ${isFormationAnimating ? "lineup-field-animating" : ""}`}
        >
          <PitchLines />
          <div className="relative z-10 flex h-full flex-col justify-between px-2 py-4 sm:px-5 sm:py-5">
            {rows.map((row, rowIndex) => {
              const rowSlots = slots.filter((slot) => slot.row === rowIndex);
              return (
                <div
                  key={`${row.position}-${rowIndex}`}
                  className="grid items-center gap-1"
                  style={{
                    gridTemplateColumns: `repeat(${row.count}, minmax(0, 1fr))`,
                  }}
                >
                  {rowSlots.map((slot) => (
                    <LineupPlayerButton
                      key={slot.id}
                      slot={slot}
                      disabled={disabled}
                      animatePlayer={animatedSlotId === slot.id}
                      onClick={() => {
                        if (!disabled) setActiveSlotId(slot.id);
                      }}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {activeSlot ? (
        <PlayerPickerModal
          key={activeSlot.id}
          slot={activeSlot}
          query={query}
          currentPlayer={
            activeSlot.playerId
              ? playersById.get(activeSlot.playerId)
              : undefined
          }
          selectedPlayerIds={selectedPlayerIds}
          onQueryChange={setQuery}
          onClose={closeModal}
          onRemove={removePlayer}
          onSelect={selectPlayer}
        />
      ) : null}
    </div>
  );
}

function PitchLines() {
  return (
    <div className="pointer-events-none absolute inset-0 text-emerald-100/35">
      <div className="absolute inset-0 border-2 border-current" />
      <div className="absolute left-0 right-0 top-1/2 border-t-2 border-current" />
      <div className="absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-current sm:h-32 sm:w-32" />
      <div className="absolute left-1/2 top-0 h-16 w-32 -translate-x-1/2 rounded-b-2xl border-2 border-t-0 border-current sm:h-24 sm:w-48" />
      <div className="absolute left-1/2 top-0 h-8 w-16 -translate-x-1/2 rounded-b-xl border-2 border-t-0 border-current sm:h-12 sm:w-24" />
      <div className="absolute bottom-0 left-1/2 h-16 w-32 -translate-x-1/2 rounded-t-2xl border-2 border-b-0 border-current sm:h-24 sm:w-48" />
      <div className="absolute bottom-0 left-1/2 h-8 w-16 -translate-x-1/2 rounded-t-xl border-2 border-b-0 border-current sm:h-12 sm:w-24" />
    </div>
  );
}

function LineupPlayerButton({
  animatePlayer,
  slot,
  disabled,
  onClick,
}: {
  animatePlayer: boolean;
  slot: LineupSlot;
  disabled: boolean;
  onClick: () => void;
}) {
  const player = slot.playerId ? playersById.get(slot.playerId) : null;
  const transitionStyle: CSSProperties & { viewTransitionName?: string } = {
    viewTransitionName: player
      ? `lineup-player-${player.id}`
      : `lineup-slot-${slot.id}`,
  };

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={transitionStyle}
      className="lineup-slot-button mx-auto flex w-12 flex-col items-center gap-0.5 text-center transition hover:scale-105 disabled:opacity-60 sm:w-[4.5rem]"
    >
      <span className="relative inline-flex">
        {player ? (
          <PlayerAvatar
            player={player}
            className={`h-9 w-9 rounded-full border-2 border-white bg-white text-xs text-emerald-900 shadow-lg sm:h-11 sm:w-11 ${
              animatePlayer ? "lineup-player-bounce-in" : ""
            }`}
          />
        ) : (
          <span className="relative flex h-9 w-9 items-center justify-center rounded-full border-2 border-emerald-300 bg-emerald-600 shadow-[0_0_0_3px_#10b981] sm:h-11 sm:w-11">
            <span className="h-6 w-6 rounded-full border border-emerald-100 bg-emerald-700 sm:h-7 sm:w-7" />
          </span>
        )}
        {player ? (
          <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center overflow-hidden rounded-full border border-white bg-white shadow">
            <TeamFlag
              teamId={player.team}
              className="h-full w-full rounded-full"
            />
          </span>
        ) : (
          <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-emerald-500 text-sm font-bold leading-none text-white shadow">
            +
          </span>
        )}
      </span>
      <span className="max-w-full truncate text-[10px] font-bold leading-tight text-white drop-shadow sm:text-xs">
        {player?.name || positionLabels[slot.position]}
      </span>
    </button>
  );
}

function PlayerPickerModal({
  slot,
  query,
  currentPlayer,
  selectedPlayerIds,
  onQueryChange,
  onClose,
  onRemove,
  onSelect,
}: {
  slot: LineupSlot;
  query: string;
  currentPlayer?: Player;
  selectedPlayerIds: string[];
  onQueryChange: (value: string) => void;
  onClose: () => void;
  onRemove: () => void;
  onSelect: (playerId: string) => void;
}) {
  const [listReady, setListReady] = useState(false);
  const [renderLimit, setRenderLimit] = useState(initialPlayerRenderLimit);
  const selectedPlayerSet = useMemo(
    () => new Set(selectedPlayerIds),
    [selectedPlayerIds],
  );
  const players = useMemo(() => {
    if (!listReady) return [];

    const normalized = query.trim().toLowerCase();
    const positionPlayers = sortedPlayersByPosition[slot.position];

    if (!normalized) return positionPlayers;

    return positionPlayers.filter((player) =>
      playerSearchTextById.get(player.id)?.includes(normalized),
    );
  }, [listReady, query, slot.position]);
  const renderedPlayers = useMemo(
    () => players.slice(0, renderLimit),
    [players, renderLimit],
  );
  const groupedPlayers = useMemo(() => {
    const groups = new Map<string, Player[]>();

    renderedPlayers.forEach((player) => {
      const country = teamsById.get(player.team)?.name || "Sin pais";
      const countryPlayers = groups.get(country);

      if (countryPlayers) {
        countryPlayers.push(player);
      } else {
        groups.set(country, [player]);
      }
    });

    return Array.from(groups.entries()).map(([country, countryPlayers]) => ({
      country,
      players: countryPlayers,
    }));
  }, [renderedPlayers]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setListReady(true);
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!listReady || renderLimit >= players.length) return;

    const timer = window.setTimeout(() => {
      setRenderLimit((current) =>
        Math.min(current + playerRenderBatchSize, players.length),
      );
    }, 45);

    return () => window.clearTimeout(timer);
  }, [listReady, players.length, renderLimit]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-3 py-5 backdrop-blur-sm">
      <div className="flex max-h-[76vh] w-full max-w-[420px] flex-col overflow-hidden rounded-2xl bg-white text-slate-950 shadow-2xl">
        <div className="flex items-center gap-2 border-b border-slate-100 p-3">
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-slate-100 px-3 py-2">
            <input
              value={query}
              onChange={(event) => {
                setRenderLimit(initialPlayerRenderLimit);
                onQueryChange(event.target.value);
              }}
              placeholder={`Buscar ${positionLabels[slot.position].toLowerCase()}`}
              className="min-w-0 flex-1 bg-transparent text-base font-medium text-slate-900 outline-none placeholder:text-slate-400"
            />
          </label>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-2 py-1 text-sm font-semibold text-emerald-700"
          >
            Cancelar
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-3 pt-2">
          {currentPlayer ? (
            <button
              type="button"
              onClick={onRemove}
              className="mb-3 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700"
            >
              Quitar jugador
            </button>
          ) : null}

          <div className="space-y-2">
            {!listReady ? (
              <p className="rounded-xl bg-slate-100 px-3 py-4 text-sm text-slate-500">
                Cargando jugadores...
              </p>
            ) : null}

            {groupedPlayers.map((group) => (
              <div key={group.country} className="space-y-1">
                <div className="flex items-center gap-2 py-1 text-xs font-bold uppercase text-slate-500">
                  <TeamFlag
                    teamId={group.players[0]?.team}
                    className="h-4 w-5 rounded-sm"
                  />
                  <span>{group.country}</span>
                </div>
                {group.players.map((player) => {
                  const alreadySelected = selectedPlayerSet.has(player.id);
                  const current = player.id === currentPlayer?.id;
                  return (
                    <button
                      key={player.id}
                      type="button"
                      disabled={alreadySelected}
                      onClick={() => onSelect(player.id)}
                      className={`grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-xl px-2 py-1.5 text-left transition ${
                        alreadySelected
                          ? "cursor-not-allowed bg-slate-50 opacity-45"
                          : "hover:bg-slate-100"
                      }`}
                    >
                      <PlayerAvatar
                        player={player}
                        className="h-8 w-8 rounded-full bg-slate-100 text-[10px] text-emerald-900"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold leading-4 text-slate-950">
                          {player.name}
                        </p>
                        <p className="text-xs leading-4 text-slate-500">
                          {positionLabels[player.position]}
                        </p>
                      </div>
                      {alreadySelected ? (
                        <span className="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                          {current ? "Actual" : "Ya en tu once"}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ))}

            {listReady && players.length > renderedPlayers.length ? (
              <p className="rounded-xl bg-slate-100 px-3 py-3 text-center text-xs font-semibold text-slate-500">
                Cargando mas jugadores...
              </p>
            ) : null}

            {listReady && !players.length ? (
              <p className="rounded-xl bg-slate-100 px-3 py-4 text-sm text-slate-500">
                No hay jugadores para esa busqueda.
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function FinalPhaseSection({
  isMatchLocked,
  prediction,
  matches,
  onWinnerSelect,
}: {
  isMatchLocked: (match: Match) => boolean;
  prediction: Prediction;
  matches: Match[];
  onWinnerSelect: (matchNumber: number, teamId: string) => void;
}) {
  return (
    <div className="relative left-1/2 w-[calc(100vw-2rem)] max-w-[1380px] -translate-x-1/2 space-y-5 sm:w-[calc(100vw-3rem)]">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-white">
          Fase final
        </h2>
      </div>
      <KnockoutBracket
        isMatchLocked={isMatchLocked}
        prediction={prediction}
        matches={matches}
        onWinnerSelect={onWinnerSelect}
      />
    </div>
  );
}

function ResultsSchedule({
  matches,
  prediction,
  onScoreChange,
}: {
  matches: Match[];
  prediction: Prediction;
  onScoreChange: (
    matchNumber: number,
    side: "homeScore" | "awayScore",
    value: string,
  ) => void;
}) {
  const matchesByDate = useMemo(() => {
    return matches.reduce<Record<string, Match[]>>((grouped, match) => {
      const dateKey = resultDateKey(match);
      grouped[dateKey] ||= [];
      grouped[dateKey].push(match);
      return grouped;
    }, {});
  }, [matches]);
  const dateKeys = useMemo(
    () => Array.from(new Set(matches.map(resultDateKey))).sort(),
    [matches],
  );
  const completedMatches = matches.filter((match) =>
    isMatchPredictionComplete(match, prediction),
  ).length;

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <h2 className="text-2xl font-bold tracking-tight text-white">
            Resultados
          </h2>
          <span className="text-sm font-semibold text-zinc-500 sm:pb-1">
            {completedMatches}/{matches.length}
          </span>
        </div>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium leading-6 text-zinc-400">
          <span>Eleccion acertada</span>
          <span className="rounded-md bg-[#a7f600] px-2 py-0.5 text-[11px] font-semibold text-black">
            +1 punto
          </span>
          <span>Resultado exacto suma el valor de todos los</span>
          <span className="rounded-md bg-[#a7f600] px-2 py-0.5 text-[11px] font-semibold text-black">
            goles del partido
          </span>
        </p>
        <p className="text-sm font-medium text-yellow-100">
          Puedes meter o cambiar cada resultado hasta justo antes de que
          comience ese partido.
        </p>
      </div>

      <div className="space-y-3">
        {dateKeys.map((dateKey) => {
          const dayMatches = matchesByDate[dateKey] || [];

          return (
            <section key={dateKey} className="scroll-mt-28">
              <h4 className="flex min-h-14 items-center gap-2 pb-3 pt-5 text-xl/6 font-semibold not-first-of-type:mt-4 md:scroll-mt-24">
                <span className="first-letter:capitalize">
                  {formatResultsDay(dateKey)}
                </span>
              </h4>
              <div className="space-y-3">
                {dayMatches.map((match) => (
                  <ResultMatchCard
                    key={match.number}
                    match={match}
                    prediction={prediction}
                    onScoreChange={onScoreChange}
                  />
                ))}
              </div>
            </section>
          );
        })}

        {!dateKeys.length ? (
          <div className="rounded-lg border border-white/10 bg-[#151515] px-4 py-6 text-sm text-zinc-400">
            Completa la fase de grupos para desbloquear mas partidos.
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ResultMatchCard({
  match,
  prediction,
  onScoreChange,
}: {
  match: Match;
  prediction: Prediction;
  onScoreChange: (
    matchNumber: number,
    side: "homeScore" | "awayScore",
    value: string,
  ) => void;
}) {
  const current = prediction.matchPredictions[String(match.number)] || {
    homeScore: "",
    awayScore: "",
  };
  const locked = hasMatchStarted(match);
  const home = resolveSlot(match.home, match.number, prediction);
  const away = resolveSlot(match.away, match.number, prediction);
  const complete = isMatchPredictionComplete(match, prediction);

  return (
    <article
      className="overflow-hidden rounded-[22px] text-white"
      style={{
        background:
          "radial-gradient(250px at 0% 0%, rgba(0, 99, 75, 0.2) 0%, rgba(47, 47, 47, 0) 70%), radial-gradient(250px at 100% 0%, rgba(216, 159, 40, 0.2) 0%, rgba(47, 47, 47, 0) 70%), rgb(47, 47, 47)",
      }}
    >
      <div className="flex justify-center px-4 pb-0 pt-4">
        <time className="inline-flex items-center text-sm font-semibold text-zinc-200">
          {formatResultTime(match)}
        </time>
      </div>
      <div className="grid min-h-[124px] w-full grid-cols-[minmax(0,1fr)_104px_minmax(0,1fr)] items-start py-2 pb-4 sm:min-h-[128px] sm:grid-cols-[minmax(0,1fr)_120px_minmax(0,1fr)]">
        <ResultTeamColumn teamId={home} fallback={translateSlot(match.home)} />
        <div className="relative flex items-center justify-center gap-2 pt-2">
          <ResultScoreStepper
            label="Goles local"
            value={current.homeScore}
            disabled={locked}
            onChange={(value) =>
              onScoreChange(match.number, "homeScore", value)
            }
          />
          <span
            aria-label={
              complete ? "Resultado rellenado" : "Resultado pendiente"
            }
            className={`absolute left-1/2 top-10 z-10 flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded-full border text-sm font-bold ${
              complete
                ? "result-pending-check border-[#ffe66d] bg-[#ffdd44] text-black"
                : "border-white/20 bg-[#3a3a3a] text-zinc-500"
            }`}
          >
            {complete ? "✓" : ""}
          </span>
          <ResultScoreStepper
            label="Goles visitante"
            value={current.awayScore}
            disabled={locked}
            onChange={(value) =>
              onScoreChange(match.number, "awayScore", value)
            }
          />
        </div>
        <ResultTeamColumn teamId={away} fallback={translateSlot(match.away)} />
      </div>
    </article>
  );
}

function ResultTeamColumn({
  teamId,
  fallback,
}: {
  teamId?: string;
  fallback: string;
}) {
  const teamName = teamId ? teamsById.get(teamId)?.name || fallback : fallback;

  return (
    <div className="flex h-full w-full min-w-0 flex-col items-center justify-start gap-2 px-2 pt-4 sm:gap-3 sm:px-3">
      {teamId ? (
        <TeamFlag
          teamId={teamId}
          className="h-7 w-7 rounded-full border border-white/15 object-cover sm:h-8 sm:w-8"
        />
      ) : (
        <span className="flex h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-white/10 text-[9px] font-bold text-zinc-300 sm:h-8 sm:w-8 sm:text-[10px]">
          TBD
        </span>
      )}
      <span className="line-clamp-2 w-full min-w-0 text-center text-[11px] font-bold leading-4 text-white sm:text-xs">
        {teamName}
      </span>
    </div>
  );
}

function ResultScoreStepper({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const numericValue = Number(value || 0);
  const increment = () => onChange(String(Math.min(99, numericValue + 1)));
  const decrement = () => onChange(String(Math.max(0, numericValue - 1)));

  return (
    <div className="flex w-12 flex-col overflow-hidden rounded-md sm:w-14">
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        onClick={increment}
        className="flex h-6 items-center justify-center bg-[#454545] text-base font-bold leading-none text-zinc-100 transition hover:bg-[#555] disabled:text-zinc-600 sm:h-7 sm:text-lg"
        aria-label={`Subir ${label}`}
      >
        +
      </button>
      <input
        name={label}
        type="number"
        inputMode="numeric"
        min="0"
        max="99"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="score-number-input h-9 w-12 appearance-none bg-[#222] text-center text-lg font-bold text-white outline-none placeholder:text-zinc-600 disabled:opacity-60 sm:h-10 sm:w-14 sm:text-xl"
        placeholder="?"
        aria-label={label}
      />
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        onClick={decrement}
        className="flex h-6 items-center justify-center bg-[#454545] text-base font-bold leading-none text-zinc-100 transition hover:bg-[#555] disabled:text-zinc-600 sm:h-7 sm:text-lg"
        aria-label={`Bajar ${label}`}
      >
        -
      </button>
    </div>
  );
}

function resultDateKey(match: Match) {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Madrid",
    year: "numeric",
  }).format(new Date(scheduleUtc(match)));
}

function formatResultTime(match: Match) {
  return new Intl.DateTimeFormat("es-ES", {
    hour: "2-digit",
    hour12: false,
    hourCycle: "h23",
    minute: "2-digit",
    timeZone: "Europe/Madrid",
  }).format(new Date(scheduleUtc(match)));
}

function formatResultsDay(dateKey: string) {
  return new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "long",
    timeZone: "Europe/Madrid",
    weekday: "long",
  }).format(new Date(`${dateKey}T12:00:00Z`));
}
