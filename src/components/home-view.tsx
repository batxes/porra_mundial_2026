"use client";

import Image from "next/image";
import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import {
  Avatar,
  Card,
  FinishedMatchCard,
  hasFinishedScore,
  matchStageLabel,
  PrimaryLink,
  ProBadge,
  Spinner,
  TeamBadge,
  TeamFlag,
  useDelayedFlag,
} from "@/components/common";
import { useAppContext } from "@/lib/app-context";
import { extraPredictionFields, schedule, teamsById } from "@/lib/data";
import { formatDate, translateSlot } from "@/lib/format";
import {
  isMatchPredictionComplete,
  isMatchVisibleForPrediction,
  resolveSlot,
  scheduleUtc,
  xiCounts,
  xiRequirements,
} from "@/lib/prediction";
import type {
  AdminResult,
  Match,
  Position,
  Prediction,
  UserProfile,
} from "@/lib/types";

type HomeSaveState = "idle" | "pending" | "saving" | "saved" | "error";

const matchdayVisibleAfterLastStartMs = 3 * 60 * 60 * 1000;

function madridTodayKey() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Madrid",
    year: "numeric",
  }).formatToParts(new Date());
  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

const resultsReminderKey = "porra26_results_reminder_date";

export function HomeView() {
  const {
    adminResults,
    leaderboard,
    prediction,
    ready,
    savePrediction,
    setPredictionScore,
    user,
  } = useAppContext();
  const [homeSaveState, setHomeSaveState] =
    useState<HomeSaveState>("idle");
  const [reminderMatches, setReminderMatches] = useState<Match[]>([]);

  useEffect(() => {
    if (!ready || !user) return;

    const todayKey = madridTodayKey();
    let lastShown = "";
    try {
      lastShown = window.localStorage.getItem(resultsReminderKey) || "";
    } catch {
      lastShown = "";
    }
    if (lastShown === todayKey) return;

    const now = Date.now();
    const horizon = now + 24 * 60 * 60 * 1000;
    const pending = schedule
      .filter((match) => {
        const kickoff = new Date(scheduleUtc(match)).getTime();
        return (
          kickoff > now &&
          kickoff <= horizon &&
          isMatchVisibleForPrediction(match, prediction) &&
          !isMatchPredictionComplete(match, prediction)
        );
      })
      .sort(
        (a, b) =>
          new Date(scheduleUtc(a)).getTime() -
          new Date(scheduleUtc(b)).getTime(),
      )
      .slice(0, 2);

    if (!pending.length) return;

    try {
      window.localStorage.setItem(resultsReminderKey, todayKey);
    } catch {
      // Ignore storage failures.
    }
    const frame = window.requestAnimationFrame(() =>
      setReminderMatches(pending),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [prediction, ready, user]);
  const homeEditPendingRef = useRef(false);
  const homeSaveTimerRef = useRef<number | null>(null);
  const homeSaveRunRef = useRef(0);
  const hideHomeSaveTimerRef = useRef<number | null>(null);
  const todayKey = madridTodayKey();
  const nextMatchdayKey = getNextMatchdayKey();
  const upcomingMatches = nextMatchdayKey
    ? schedule
        .filter((match) => match.date === nextMatchdayKey)
        .sort(
          (a, b) =>
            new Date(scheduleUtc(a)).getTime() -
              new Date(scheduleUtc(b)).getTime() || a.number - b.number,
        )
    : [];
  const missingSections = useMemo(
    () => getMissingSections(prediction, todayKey),
    [prediction, todayKey],
  );
  const changeHomePredictionScore = (
    matchNumber: number,
    side: "homeScore" | "awayScore",
    value: string,
  ) => {
    if (!user) return;
    homeEditPendingRef.current = true;
    setPredictionScore(matchNumber, side, value);
  };

  useEffect(() => {
    if (!user?.id || !homeEditPendingRef.current) return;

    if (homeSaveTimerRef.current) {
      window.clearTimeout(homeSaveTimerRef.current);
    }
    if (hideHomeSaveTimerRef.current) {
      window.clearTimeout(hideHomeSaveTimerRef.current);
      hideHomeSaveTimerRef.current = null;
    }

    setHomeSaveState("pending");
    homeSaveTimerRef.current = window.setTimeout(async () => {
      homeSaveTimerRef.current = null;
      const runId = homeSaveRunRef.current + 1;
      homeSaveRunRef.current = runId;
      setHomeSaveState("saving");

      const result = await savePrediction(false);
      if (homeSaveRunRef.current !== runId) return;

      if (!result.ok) {
        setHomeSaveState("error");
        return;
      }

      homeEditPendingRef.current = false;
      setHomeSaveState("saved");
      hideHomeSaveTimerRef.current = window.setTimeout(() => {
        setHomeSaveState("idle");
        hideHomeSaveTimerRef.current = null;
      }, 1600);
    }, 900);

    return () => {
      if (homeSaveTimerRef.current) {
        window.clearTimeout(homeSaveTimerRef.current);
        homeSaveTimerRef.current = null;
      }
    };
  }, [prediction.matchPredictions, savePrediction, user?.id]);

  useEffect(() => {
    return () => {
      if (homeSaveTimerRef.current) {
        window.clearTimeout(homeSaveTimerRef.current);
      }
      if (hideHomeSaveTimerRef.current) {
        window.clearTimeout(hideHomeSaveTimerRef.current);
      }
    };
  }, []);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 py-6 sm:py-8">
      <section className="flex flex-col items-center text-center">
        <Image
          src="/logo.png"
          alt=""
          width={88}
          height={88}
          className="mb-4 h-16 w-16 object-contain sm:h-20 sm:w-20"
          priority
        />
        <h1 className="text-4xl font-black tracking-tight text-white sm:text-6xl">
          Triliporra
        </h1>
        <p className="mt-3 max-w-xl text-base text-zinc-400 sm:text-lg">
          Adivina el Mundial 2026 y compite con tus amigos.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <PrimaryLink href="/porra">Jugar</PrimaryLink>
          <Link
            href="/como-funciona"
            className="inline-flex items-center justify-center rounded-lg border border-white/10 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
          >
            Ver reglas
          </Link>
        </div>
      </section>

      {missingSections.length ? (
        <div className="home-missing-alert flex items-start gap-3 rounded-lg border border-yellow-300/25 bg-yellow-300/10 px-4 py-3 text-sm font-medium leading-5 text-yellow-100">
          <span className="relative mt-1.5 flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inline-flex h-full w-full rounded-full bg-yellow-300 opacity-60 animate-ping" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-yellow-300" />
          </span>
          <span>{formatMissingSections(missingSections)}</span>
        </div>
      ) : null}

      <section className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-2xl font-black tracking-tight text-white">
              Clasificacion
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              {ready ? `${leaderboard.length} participantes` : " "}
            </p>
          </div>
          <Link
            href="/clasificacion"
            className="w-fit shrink-0 rounded-lg border border-white/10 px-3 py-2 text-sm font-bold text-white transition hover:bg-white/10"
          >
            Ver mas
          </Link>
        </div>

        <Card className="overflow-hidden p-0">
          {!ready ? (
            <HomeLeaderboardLoading />
          ) : leaderboard.length ? (
            <div className="divide-y divide-white/10">
              {leaderboard.slice(0, 5).map((profile, index) => (
                <LeaderboardRow
                  key={profile.id}
                  profile={profile}
                  position={index + 1}
                />
              ))}
            </div>
          ) : (
            <div className="px-4 py-8 text-center text-sm text-zinc-400">
              Aun no hay participantes.
            </div>
          )}
        </Card>
      </section>

      <section className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-2xl font-black tracking-tight text-white">
              Proxima jornada
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              {nextMatchdayKey
                ? `${formatDate(nextMatchdayKey)} - ${upcomingMatches.length} ${upcomingMatches.length === 1 ? "partido" : "partidos"}`
                : "No quedan partidos programados"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {user && homeSaveState !== "idle" ? (
              <HomeSaveStatus state={homeSaveState} />
            ) : null}
            <Link
              href="/porra?section=results"
              className="w-fit shrink-0 rounded-lg border border-white/10 px-3 py-2 text-sm font-bold text-white transition hover:bg-white/10"
            >
              Ver todos
            </Link>
          </div>
        </div>

        {upcomingMatches.length ? (
          <div className="grid gap-3">
            {upcomingMatches.map((match) => (
              <UpcomingMatchCard
                key={match.number}
                match={match}
                hasUser={Boolean(user)}
                prediction={prediction}
                result={adminResults[String(match.number)]}
                onScoreChange={changeHomePredictionScore}
              />
            ))}
          </div>
        ) : (
          <Card className="space-y-2 text-sm">
            <p className="font-semibold text-white">
              No quedan partidos programados.
            </p>
          </Card>
        )}
      </section>

      {reminderMatches.length ? (
        <ResultsReminderModal
          matches={reminderMatches}
          prediction={prediction}
          onClose={() => setReminderMatches([])}
        />
      ) : null}
    </div>
  );
}

function ResultsReminderModal({
  matches,
  prediction,
  onClose,
}: {
  matches: Match[];
  prediction: Prediction;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="results-reminder-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#151515] p-5 text-white shadow-2xl shadow-black/50">
        <div className="mb-4 flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#a7f600]/15 text-[#a7f600]">
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </span>
          <div>
            <h3
              id="results-reminder-title"
              className="text-xl font-bold tracking-tight"
            >
              {matches.length === 1
                ? "Tienes un partido pronto"
                : "Tienes partidos pronto"}
            </h3>
            <p className="mt-2 text-sm leading-6 text-zinc-300">
              Empiezan en menos de 24 horas y aún no has puesto tu resultado.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          {matches.map((match) => {
            const home = resolveSlot(match.home, match.number, prediction);
            const away = resolveSlot(match.away, match.number, prediction);
            return (
              <div
                key={match.number}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <TeamFlag
                    teamId={home}
                    className="h-5 w-5 shrink-0 rounded-full border border-white/15 object-cover"
                  />
                  <span className="shrink-0 text-xs font-bold text-zinc-400">
                    vs
                  </span>
                  <TeamFlag
                    teamId={away}
                    className="h-5 w-5 shrink-0 rounded-full border border-white/15 object-cover"
                  />
                  <span className="min-w-0 truncate text-sm font-semibold text-white">
                    {teamsById.get(home)?.name || translateSlot(match.home)} ·{" "}
                    {teamsById.get(away)?.name || translateSlot(match.away)}
                  </span>
                </div>
                <span className="shrink-0 text-xs font-bold text-zinc-300">
                  {reminderMatchWhen(match)}
                </span>
              </div>
            );
          })}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/12 bg-white/[0.06] px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
          >
            Ahora no
          </button>
          <Link
            href="/porra?section=results"
            onClick={onClose}
            className="inline-flex items-center justify-center rounded-lg bg-[#a7f600] px-4 py-3 text-sm font-semibold text-black transition hover:bg-[#c7ff43]"
          >
            Pronosticar
          </Link>
        </div>
      </div>
    </div>
  );
}

function reminderMatchWhen(match: Match) {
  const kickoff = new Date(scheduleUtc(match));
  const time = new Intl.DateTimeFormat("es-ES", {
    hour: "2-digit",
    hour12: false,
    hourCycle: "h23",
    minute: "2-digit",
    timeZone: "Europe/Madrid",
  }).format(kickoff);
  const dayKey = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Madrid",
    year: "numeric",
  }).format(kickoff);
  return dayKey === madridTodayKey() ? `Hoy ${time}` : `Mañana ${time}`;
}

function getMissingSections(prediction: Prediction, todayKey: string) {
  const missing: string[] = [];
  const extrasDone = extraPredictionFields.filter((key) =>
    Boolean(prediction.extras[key]),
  ).length;
  if (extrasDone < extraPredictionFields.length) {
    missing.push("Tus elecciones");
  }

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
  if (selectedPlayers < requiredPlayers) {
    missing.push("Tu once");
  }

  const completedGroups = Object.values(prediction.groups).filter((group) => {
    const positions = Object.values(group).filter(Boolean);
    return positions.length === 4 && new Set(positions).size === 4;
  }).length;
  const thirdDone = Math.min(prediction.bracket.thirdQualifiers.length, 8);
  const groupTotal = Object.keys(prediction.groups).length + 8;
  if (completedGroups + thirdDone < groupTotal) {
    missing.push("Fase de grupos");
  }

  if (hasMissingNextMatchdayResults(prediction, todayKey)) {
    missing.push("Resultados");
  }

  return missing;
}

function hasMissingNextMatchdayResults(
  prediction: Prediction,
  todayKey: string,
) {
  const nextDate = schedule
    .filter((match) => match.number < 73 && match.date >= todayKey)
    .filter((match) => isMatchVisibleForPrediction(match, prediction))
    .sort(
      (a, b) => a.date.localeCompare(b.date) || a.number - b.number,
    )[0]?.date;

  if (!nextDate) return false;

  return schedule
    .filter((match) => match.number < 73 && match.date === nextDate)
    .filter((match) => isMatchVisibleForPrediction(match, prediction))
    .some((match) => !isMatchPredictionComplete(match, prediction));
}

function formatMissingSections(sections: string[]) {
  const displaySections = sections.map((section) =>
    section === "Resultados" ? "Resultados de la proxima jornada" : section,
  );
  const label =
    displaySections.length === 1
      ? displaySections[0]
      : `${displaySections.slice(0, -1).join(", ")} y ${
          displaySections[displaySections.length - 1]
        }`;

  return `Te falta completar: ${label}.`;
}

function HomeLeaderboardLoading() {
  const visible = useDelayedFlag();
  if (!visible) return null;

  return (
    <div className="flex items-center justify-center gap-3 px-4 py-8 text-sm text-zinc-400">
      <Spinner className="h-5 w-5" />
      <span>Cargando clasificacion...</span>
    </div>
  );
}

function LeaderboardRow({
  profile,
  position,
}: {
  profile: UserProfile;
  position: number;
}) {
  return (
    <Link
      href={`/perfil/${encodeURIComponent(profile.id)}`}
      className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 transition hover:bg-white/5"
    >
      <span
        className={`flex h-8 w-8 items-center justify-center text-sm font-black ${rankTextClass(position)}`}
        aria-label={`Puesto ${position}`}
      >
        {rankLabel(position)}
      </span>
      <span className="flex min-w-0 items-center gap-3">
        <Avatar
          name={profile.name}
          avatarUrl={profile.avatarUrl}
          className="size-10"
        />
        <span className="min-w-0">
          <strong className="flex min-w-0 items-center gap-1.5 text-sm text-white">
            <span className="truncate">{profile.name}</span>
            {profile.isPro ? <ProBadge /> : null}
          </strong>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-zinc-500">
            {profile.champion ? (
              <TeamBadge
                teamId={profile.champion}
                className="text-xs text-zinc-400"
              />
            ) : (
              <span>Pendiente</span>
            )}
          </span>
        </span>
      </span>
      <span className="text-right">
        <strong className="block text-lg font-black text-white">
          {profile.points}
        </strong>
        <span className="text-xs font-semibold text-zinc-500">pts</span>
      </span>
    </Link>
  );
}

function rankTextClass(position: number) {
  if (position === 1) {
    return "text-[#f7c948]";
  }

  if (position === 2) {
    return "text-zinc-200";
  }

  if (position === 3) {
    return "text-[#b7791f]";
  }

  return "text-zinc-300";
}

function rankLabel(position: number) {
  if (position === 1) return "🥇";
  if (position === 2) return "🥈";
  if (position === 3) return "🥉";
  return position;
}

function HomeSaveStatus({ state }: { state: HomeSaveState }) {
  const label = {
    pending: "Cambios pendientes",
    saving: "Guardando...",
    saved: "Guardado",
    error: "Error al guardar",
    idle: "",
  }[state];

  return (
    <span
      className={`inline-flex h-9 items-center rounded-lg border px-3 text-xs font-bold ${
        state === "saved"
          ? "border-[#a7f600]/30 bg-[#a7f600]/12 text-[#a7f600]"
          : state === "error"
            ? "border-rose-400/25 bg-rose-400/10 text-rose-100"
            : "border-yellow-300/25 bg-yellow-300/10 text-yellow-100"
      }`}
    >
      {label}
    </span>
  );
}

function getNextMatchdayKey() {
  const now = Date.now();
  const dateKeys = Array.from(new Set(schedule.map((match) => match.date))).sort();
  const nextMatchday = dateKeys.find((dateKey) => {
    const dayMatches = schedule.filter((match) => match.date === dateKey);
    const lastStart = Math.max(
      ...dayMatches.map((match) => new Date(scheduleUtc(match)).getTime()),
    );

    return lastStart + matchdayVisibleAfterLastStartMs >= now;
  });

  return nextMatchday || "";
}

function UpcomingMatchCard({
  hasUser,
  match,
  prediction,
  result,
  onScoreChange,
}: {
  hasUser: boolean;
  match: Match;
  prediction: Prediction;
  result?: AdminResult;
  onScoreChange: (
    matchNumber: number,
    side: "homeScore" | "awayScore",
    value: string,
  ) => void;
}) {
  const matchPrediction = prediction.matchPredictions[String(match.number)] || {
    homeScore: "",
    awayScore: "",
  };
  const locked = hasMatchStarted(match);
  const predictionComplete = isMatchPredictionComplete(match, prediction);
  const hasLiveScore = hasAdminScore(result);

  if (result && isFinishedResult(result) && hasFinishedScore(result)) {
    return (
      <FinishedMatchCard
        match={match}
        result={result}
        pickHome={matchPrediction.homeScore}
        pickAway={matchPrediction.awayScore}
        hasPick={predictionComplete}
        showPick={hasUser}
        homeTeamId={result.homeTeamId || (teamsById.has(match.home) ? match.home : undefined)}
        awayTeamId={result.awayTeamId || (teamsById.has(match.away) ? match.away : undefined)}
      />
    );
  }

  return (
    <article
      className="overflow-hidden rounded-[22px] text-white"
      style={{
        background:
          "radial-gradient(250px at 0% 0%, rgba(0, 99, 75, 0.2) 0%, rgba(47, 47, 47, 0) 70%), radial-gradient(250px at 100% 0%, rgba(216, 159, 40, 0.2) 0%, rgba(47, 47, 47, 0) 70%), rgb(47, 47, 47)",
      }}
    >
      <div className="flex items-center justify-between gap-3 px-3 pb-0 pt-3 sm:justify-center sm:px-4 sm:pt-4">
        <span>{matchStageLabel(match)}</span>
        <time className="inline-flex items-center text-sm font-semibold text-zinc-200">
          {formatResultTime(match)}
        </time>
        {hasUser ? (
          <HomeResultStatusBadge
            complete={predictionComplete}
            locked={locked}
            className="sm:hidden"
          />
        ) : null}
      </div>

      <div className="space-y-2 px-3 py-3 sm:hidden">
        <HomeResultTeamScoreRow
          teamId={match.home}
          fallback={translateSlot(match.home)}
          scoreControl={
            hasUser ? (
              <HomeResultScoreStepper
                label="Goles local"
                value={matchPrediction.homeScore}
                disabled={locked}
                compact
                onChange={(value) =>
                  onScoreChange(match.number, "homeScore", value)
                }
              />
            ) : (
              <HomeVsPill />
            )
          }
        />
        <HomeResultTeamScoreRow
          teamId={match.away}
          fallback={translateSlot(match.away)}
          scoreControl={
            hasUser ? (
              <HomeResultScoreStepper
                label="Goles visitante"
                value={matchPrediction.awayScore}
                disabled={locked}
                compact
                onChange={(value) =>
                  onScoreChange(match.number, "awayScore", value)
                }
              />
            ) : null
          }
        />
      </div>

      <div className="hidden min-h-[124px] w-full grid-cols-[minmax(0,1fr)_104px_minmax(0,1fr)] items-start py-2 pb-4 sm:grid sm:min-h-[128px] sm:grid-cols-[minmax(0,1fr)_120px_minmax(0,1fr)]">
        <HomeResultTeamColumn
          teamId={match.home}
          fallback={translateSlot(match.home)}
        />
        {hasUser ? (
          <div className="relative flex items-center justify-center gap-2 pt-2">
            <HomeResultScoreStepper
              label="Goles local"
              value={matchPrediction.homeScore}
              disabled={locked}
              onChange={(value) =>
                onScoreChange(match.number, "homeScore", value)
              }
            />
            <span
              aria-label={
                predictionComplete
                  ? "Resultado rellenado"
                  : "Resultado pendiente"
              }
              className={`absolute left-1/2 top-10 z-10 flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded-full border text-sm font-bold ${
                predictionComplete
                  ? "result-pending-check border-[#ffe66d] bg-[#ffdd44] text-black"
                  : "border-white/20 bg-[#3a3a3a] text-zinc-500"
              }`}
            >
              {predictionComplete ? <CheckIcon className="h-3.5 w-3.5" /> : null}
            </span>
            <HomeResultScoreStepper
              label="Goles visitante"
              value={matchPrediction.awayScore}
              disabled={locked}
              onChange={(value) =>
                onScoreChange(match.number, "awayScore", value)
              }
            />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center pt-7">
            <HomeVsPill />
          </div>
        )}
        <HomeResultTeamColumn
          teamId={match.away}
          fallback={translateSlot(match.away)}
        />
      </div>

      <div className="border-t border-white/10 px-3 py-2 sm:px-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 truncate text-xs text-zinc-400">{match.venue}</p>
          {hasLiveScore ? (
            <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-xs font-bold text-white">
              {matchStatusLabel(result)}: {result?.homeScore ?? "-"} -{" "}
              {result?.awayScore ?? "-"}
            </span>
          ) : hasUser ? (
            <span className="text-xs font-medium text-zinc-500">
              {locked
                ? predictionComplete
                  ? "Prediccion cerrada"
                  : "No rellenaste este resultado"
                : "Editable hasta el inicio"}
            </span>
          ) : (
            <span className="text-xs font-medium text-zinc-500">
              Entra para guardar tu prediccion
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

function HomeResultTeamColumn({
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

function HomeResultTeamScoreRow({
  teamId,
  fallback,
  scoreControl,
}: {
  teamId?: string;
  fallback: string;
  scoreControl: ReactNode;
}) {
  const teamName = teamId ? teamsById.get(teamId)?.name || fallback : fallback;

  return (
    <div className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-white/10 bg-black/15 px-3 py-2">
      <div className="flex min-w-0 items-center gap-3">
        {teamId ? (
          <TeamFlag
            teamId={teamId}
            className="h-8 w-8 shrink-0 rounded-full border border-white/15 object-cover"
          />
        ) : (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/10 text-[10px] font-bold text-zinc-300">
            TBD
          </span>
        )}
        <span className="min-w-0 truncate text-sm font-bold text-white">
          {teamName}
        </span>
      </div>
      {scoreControl}
    </div>
  );
}

function HomeResultStatusBadge({
  complete,
  locked,
  className = "",
}: {
  complete: boolean;
  locked: boolean;
  className?: string;
}) {
  return (
    <span
      aria-label={complete ? "Resultado rellenado" : "Resultado pendiente"}
      className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2 text-[11px] font-bold ${
        complete
          ? "border-[#ffe66d]/35 bg-[#ffdd44]/18 text-yellow-100"
          : "border-white/15 bg-white/[0.06] text-zinc-400"
      } ${className}`}
    >
      <span
        className={`flex h-4 w-4 items-center justify-center rounded-full ${
          complete ? "bg-[#ffdd44] text-black" : "bg-white/12"
        }`}
      >
        {complete ? <CheckIcon className="h-3 w-3" /> : null}
      </span>
      {complete ? (locked ? "Cerrado" : "Listo") : "Pendiente"}
    </span>
  );
}

function HomeResultScoreStepper({
  compact = false,
  disabled,
  label,
  onChange,
  value,
}: {
  compact?: boolean;
  disabled: boolean;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  const numericValue = Number(value || 0);
  const increment = () => onChange(String(Math.min(99, numericValue + 1)));
  const decrement = () => onChange(String(Math.max(0, numericValue - 1)));

  return (
    <div
      className={`flex flex-col overflow-hidden rounded-md ${
        compact ? "w-11" : "w-12 sm:w-14"
      }`}
    >
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        onClick={increment}
        className={`flex items-center justify-center bg-[#454545] font-bold leading-none text-zinc-100 transition hover:bg-[#555] disabled:text-zinc-600 ${
          compact ? "h-6 text-base" : "h-6 text-base sm:h-7 sm:text-lg"
        }`}
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
        className={`score-number-input appearance-none bg-[#222] text-center font-bold text-white outline-none placeholder:text-zinc-600 disabled:opacity-60 ${
          compact
            ? "h-9 w-11 text-base"
            : "h-9 w-12 text-lg sm:h-10 sm:w-14 sm:text-xl"
        }`}
        placeholder="?"
        aria-label={label}
      />
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        onClick={decrement}
        className={`flex items-center justify-center bg-[#454545] font-bold leading-none text-zinc-100 transition hover:bg-[#555] disabled:text-zinc-600 ${
          compact ? "h-6 text-base" : "h-6 text-base sm:h-7 sm:text-lg"
        }`}
        aria-label={`Bajar ${label}`}
      >
        -
      </button>
    </div>
  );
}

function HomeVsPill() {
  return (
    <span className="rounded-lg bg-white/10 px-3 py-2 text-sm font-black text-white">
      vs
    </span>
  );
}

function CheckIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className={className}
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
  );
}

function hasMatchStarted(match: Match) {
  return Date.now() >= new Date(scheduleUtc(match)).getTime();
}

function hasAdminScore(result?: AdminResult) {
  return (
    result?.homeScore !== undefined &&
    result.homeScore !== "" &&
    result?.awayScore !== undefined &&
    result.awayScore !== ""
  );
}

function isFinishedResult(result?: AdminResult) {
  const status = String(result?.status || "").toLowerCase();
  return (
    status.includes("final") ||
    status.includes("finished") ||
    status === "ft" ||
    status === "validated"
  );
}

function matchStatusLabel(result?: AdminResult) {
  if (isFinishedResult(result)) return "Finalizado";
  const status = String(result?.status || "").trim();
  return status && status !== "validated" ? status : "En directo";
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
