"use client";

import Image from "next/image";
import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import {
  Avatar,
  Card,
  FinishedMatchCard,
  hasFinishedScore,
  MatchEventLine,
  matchEventIcons,
  MatchCountdown,
  matchStageLabel,
  PlayerAvatar,
  PrimaryLink,
  ProBadge,
  Skeleton,
  TeamFlag,
  WolfBadge,
} from "@/components/common";
import { useAppContext } from "@/lib/app-context";
import { data, playersById, schedule, teamsById } from "@/lib/data";
import { formatDate, translateSlot } from "@/lib/format";
import {
  calculatePlayerStandings,
  type PlayerStandingRow,
} from "@/lib/scoring";
import {
  isMatchPredictionComplete,
  isMatchVisibleForPrediction,
  resolveSlot,
  scheduleUtc,
} from "@/lib/prediction";
import type {
  AdminResult,
  AdminResults,
  Match,
  Prediction,
  ScoreEntry,
  UserProfile,
} from "@/lib/types";

type HomeSaveState = "idle" | "pending" | "saving" | "saved" | "error";

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
const resultsRecapKey = "porra26_results_recap_seen";
const resultsRecapRankKey = "porra26_results_recap_rank";

type RecapRank = { current: number; previous: number | null; total: number };
type RecapBreakdownPart = { label: string; points: number };
type RecapItem = {
  match: Match;
  result: AdminResult;
  points: number;
  breakdown: RecapBreakdownPart[];
};

const matchPointCategories: Array<{
  label: string;
  match: (ruleCode: string) => boolean;
}> = [
  { label: "Resultado exacto", match: (rc) => rc === "match_exact_score" },
  { label: "Resultado acertado", match: (rc) => rc === "match_outcome_hit" },
  { label: "Tu once", match: (rc) => rc.startsWith("player_") },
  { label: "Pasa de ronda", match: (rc) => rc === "team_progression_hit" },
  { label: "Campeon", match: (rc) => rc === "tournament_champion_hit" },
];

function matchPointBreakdown(entries: ScoreEntry[]): RecapBreakdownPart[] {
  const totals = new Map<string, number>();
  entries.forEach((entry) => {
    const category = matchPointCategories.find((item) =>
      item.match(entry.ruleCode),
    );
    const label = category ? category.label : "Otros";
    totals.set(label, (totals.get(label) || 0) + entry.points);
  });

  const order = [...matchPointCategories.map((item) => item.label), "Otros"];
  return order
    .map((label) => ({ label, points: totals.get(label) || 0 }))
    .filter((part) => part.points !== 0);
}

export function HomeView() {
  const {
    adminResults,
    currentScorecard,
    leaderboard: fullLeaderboard,
    prediction,
    ready,
    savePrediction,
    setPredictionScore,
    user,
  } = useAppContext();
  const leaderboard = useMemo(
    () => fullLeaderboard.filter((profile) => !profile.isHidden),
    [fullLeaderboard],
  );
  const topPlayers = useMemo(
    () => calculatePlayerStandings(adminResults, data.players).slice(0, 10),
    [adminResults],
  );
  const [homeSaveState, setHomeSaveState] = useState<HomeSaveState>("idle");
  const [reminderMatches, setReminderMatches] = useState<Match[]>([]);
  const [recapMatches, setRecapMatches] = useState<RecapItem[]>([]);
  const [recapRank, setRecapRank] = useState<RecapRank | null>(null);

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

  useEffect(() => {
    if (!ready || !user) return;

    const finished = schedule
      .map((match) => ({ match, result: adminResults[String(match.number)] }))
      .filter((item): item is { match: Match; result: AdminResult } =>
        Boolean(
          item.result &&
          isFinishedResult(item.result) &&
          hasFinishedScore(item.result),
        ),
      );
    if (!finished.length) return;

    const storageKey = `${resultsRecapKey}_${user.id}`;
    const rankKey = `${resultsRecapRankKey}_${user.id}`;
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(storageKey);
    } catch {
      raw = null;
    }

    const currentRank =
      leaderboard.findIndex((profile) => profile.id === user.id) + 1;

    const persistSeen = () => {
      try {
        window.localStorage.setItem(
          storageKey,
          JSON.stringify(finished.map((item) => item.match.number)),
        );
        if (currentRank > 0) {
          window.localStorage.setItem(rankKey, String(currentRank));
        }
      } catch {
        // Ignore storage failures.
      }
    };

    // Primera visita: fijar la linea base sin enseñar el historico entero.
    if (raw === null) {
      persistSeen();
      return;
    }

    let previousRank: number | null = null;
    try {
      const storedRank = window.localStorage.getItem(rankKey);
      previousRank = storedRank ? Number(storedRank) : null;
      if (previousRank !== null && !Number.isFinite(previousRank)) {
        previousRank = null;
      }
    } catch {
      previousRank = null;
    }

    let seen: number[] = [];
    try {
      seen = JSON.parse(raw) as number[];
    } catch {
      seen = [];
    }
    const seenSet = new Set(seen);

    const entriesByMatch = new Map<number, ScoreEntry[]>();
    currentScorecard.entries.forEach((entry) => {
      if (!entry.matchNumber) return;
      const list = entriesByMatch.get(entry.matchNumber) || [];
      list.push(entry);
      entriesByMatch.set(entry.matchNumber, list);
    });
    const matchPoints = (matchNumber: number) =>
      (entriesByMatch.get(matchNumber) || []).reduce(
        (total, entry) => total + entry.points,
        0,
      );

    const fresh = finished.filter(({ match }) => {
      if (seenSet.has(match.number)) return false;
      const pick = prediction.matchPredictions[String(match.number)];
      const hasPick = Boolean(
        pick && pick.homeScore !== "" && pick.awayScore !== "",
      );
      return hasPick || matchPoints(match.number) !== 0;
    });

    if (!fresh.length) {
      persistSeen();
      return;
    }

    const items = fresh
      .map(({ match, result }) => {
        const entries = entriesByMatch.get(match.number) || [];
        return {
          match,
          result,
          points: matchPoints(match.number),
          breakdown: matchPointBreakdown(entries),
        };
      })
      .sort((a, b) => b.match.number - a.match.number);

    const frame = window.requestAnimationFrame(() => {
      persistSeen();
      setRecapMatches(items);
      if (currentRank > 0) {
        setRecapRank({
          current: currentRank,
          previous: previousRank,
          total: leaderboard.length,
        });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [adminResults, currentScorecard, leaderboard, prediction, ready, user]);
  const homeEditPendingRef = useRef(false);
  const homeSaveTimerRef = useRef<number | null>(null);
  const homeSaveRunRef = useRef(0);
  const hideHomeSaveTimerRef = useRef<number | null>(null);
  const nextMatchdayKey = getNextMatchdayKey(adminResults);
  const upcomingMatches = nextMatchdayKey
    ? schedule
        .filter(
          (match) =>
            match.date === nextMatchdayKey &&
            isMatchPending(match, adminResults),
        )
        .sort(
          (a, b) =>
            new Date(scheduleUtc(a)).getTime() -
              new Date(scheduleUtc(b)).getTime() || a.number - b.number,
        )
    : [];
  const userRank = user
    ? leaderboard.findIndex((profile) => profile.id === user.id) + 1
    : 0;
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
    <div className="flex flex-col gap-6 py-6 sm:py-8">
      {user ? (
        <section className="flex items-center justify-between gap-3 border-b border-white/[0.07] pb-7 pt-1 sm:gap-5 sm:pb-8">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <Avatar
              name={user.name}
              avatarUrl={user.avatarUrl}
              className="size-12 shrink-0 ring-2 ring-white/10 sm:size-16"
            />
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
                Bienvenido
              </p>
              <h1 className="mt-0.5 truncate text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                {user.name}
              </h1>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center sm:gap-2">
            {ready && userRank ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-sm text-zinc-300 sm:px-3.5 sm:py-1.5">
                <span className="text-zinc-500">Puesto</span>
                <span className="font-semibold text-white">{userRank}º</span>
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#a7f600]/20 bg-[#a7f600]/[0.08] px-3 py-1 text-sm text-[#a7f600] sm:px-3.5 sm:py-1.5">
              <span className="font-semibold">{user.points}</span>
              <span className="text-[#a7f600]/70">pts</span>
            </span>
          </div>
        </section>
      ) : (
        <section className="flex flex-col items-center py-2 text-center">
          <Image
            src="/logo.png"
            alt=""
            width={88}
            height={88}
            className="mb-4 h-16 w-16 object-contain sm:h-20 sm:w-20"
            priority
          />
          <h1 className="text-4xl font-bold tracking-tight text-white sm:text-6xl">
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
      )}

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:gap-10">
        <HomeFeedSection
          currentUserId={user?.id || ""}
          hasUser={Boolean(user)}
          leaderboard={leaderboard}
          nextMatchdayKey={nextMatchdayKey}
          onScoreChange={changeHomePredictionScore}
          prediction={prediction}
          ready={ready}
          results={adminResults}
          saveState={user && homeSaveState !== "idle" ? homeSaveState : null}
          upcomingMatches={upcomingMatches}
        />

        <aside className="grid grid-cols-1 gap-6">
          <section className="space-y-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold tracking-tight text-white">
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

            {!ready ? (
              <div className="space-y-2 py-1">
                {Array.from({ length: 10 }, (_, index) => (
                  <Skeleton key={index} className="h-10 rounded-lg" />
                ))}
              </div>
            ) : leaderboard.length ? (
              <div className="divide-y divide-white/[0.06]">
                {leaderboard.slice(0, 10).map((profile, index) => (
                  <LeaderboardRow
                    key={profile.id}
                    profile={profile}
                    position={index + 1}
                  />
                ))}
              </div>
            ) : (
              <div className="py-6 text-center text-sm text-zinc-400">
                Aun no hay participantes.
              </div>
            )}
          </section>

          {ready && topPlayers.length ? (
            <section className="space-y-3">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold tracking-tight text-white">
                    Jugadores
                  </h2>
                  <p className="mt-1 text-sm text-zinc-500">
                    Los futbolistas que mas puntos suman
                  </p>
                </div>
                <Link
                  href="/clasificacion?tab=jugadores"
                  className="w-fit shrink-0 rounded-lg border border-white/10 px-3 py-2 text-sm font-bold text-white transition hover:bg-white/10"
                >
                  Ver mas
                </Link>
              </div>

              <div className="divide-y divide-white/[0.06]">
                {topPlayers.map((row, index) => (
                  <TopPlayerRow
                    key={row.player.id}
                    row={row}
                    position={index + 1}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </aside>
      </div>

      {recapMatches.length ? (
        <MatchResultsRecapModal
          items={recapMatches}
          rank={recapRank}
          onClose={() => {
            setRecapMatches([]);
            setRecapRank(null);
          }}
        />
      ) : reminderMatches.length ? (
        <ResultsReminderModal
          matches={reminderMatches}
          prediction={prediction}
          onClose={() => setReminderMatches([])}
        />
      ) : null}
    </div>
  );
}

function MatchResultsRecapModal({
  items,
  onClose,
  rank,
}: {
  items: RecapItem[];
  onClose: () => void;
  rank: RecapRank | null;
}) {
  const totalPoints = items.reduce((total, item) => total + item.points, 0);
  const rankDelta =
    rank && rank.previous !== null ? rank.previous - rank.current : null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="results-recap-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#151515] p-5 text-white shadow-2xl shadow-black/50">
        <div className="mb-4 flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#a7f600]/15 text-lg">
            🏆
          </span>
          <div>
            <h3
              id="results-recap-title"
              className="text-xl font-bold tracking-tight"
            >
              {items.length === 1
                ? "Ha terminado un partido"
                : `Han terminado ${items.length} partidos`}
            </h3>
            <p className="mt-2 text-sm leading-6 text-zinc-300">
              Esto es lo que has sumado desde tu ultima visita.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          {items.map((item) => (
            <RecapMatchRow key={item.match.number} item={item} />
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
          <span className="text-sm font-semibold text-zinc-300">
            {totalPoints > 0
              ? "Has sumado"
              : totalPoints < 0
                ? "Balance"
                : "Esta vez"}
          </span>
          <span
            className={`rounded-md px-2.5 py-1 text-sm font-bold ${
              totalPoints > 0
                ? "bg-[#a7f600]/15 text-[#a7f600]"
                : totalPoints < 0
                  ? "bg-rose-400/15 text-rose-300"
                  : "bg-white/[0.06] text-zinc-300"
            }`}
          >
            {totalPoints > 0
              ? `+${totalPoints} pts`
              : totalPoints < 0
                ? `${totalPoints} pts`
                : "0 pts"}
          </span>
        </div>

        {rank ? (
          <div className="mt-2 flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white">
                Tu puesto en la clasificacion
              </p>
              {rankDelta !== null ? (
                <p
                  className={`mt-0.5 text-xs font-bold ${
                    rankDelta > 0
                      ? "text-[#a7f600]"
                      : rankDelta < 0
                        ? "text-rose-300"
                        : "text-zinc-500"
                  }`}
                >
                  {rankDelta > 0
                    ? `Subes ${rankDelta} ${rankDelta === 1 ? "puesto" : "puestos"}`
                    : rankDelta < 0
                      ? `Bajas ${Math.abs(rankDelta)} ${
                          Math.abs(rankDelta) === 1 ? "puesto" : "puestos"
                        }`
                      : "Mantienes tu puesto"}
                </p>
              ) : (
                <p className="mt-0.5 text-xs font-medium text-zinc-500">
                  de {rank.total} participantes
                </p>
              )}
            </div>
            <span className="shrink-0 rounded-md bg-white/[0.08] px-2.5 py-1 text-sm font-bold text-white">
              {rank.current}º
              <span className="font-semibold text-zinc-500">
                {" "}
                / {rank.total}
              </span>
            </span>
          </div>
        ) : null}

        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-lg bg-[#a7f600] px-4 py-3 text-sm font-bold text-black transition hover:bg-[#c7ff43]"
        >
          Entendido
        </button>
      </div>
    </div>
  );
}

function RecapMatchRow({ item }: { item: RecapItem }) {
  const { match, points, result } = item;
  const homeTeamId =
    result.homeTeamId || (teamsById.has(match.home) ? match.home : "");
  const awayTeamId =
    result.awayTeamId || (teamsById.has(match.away) ? match.away : "");
  const homeName = homeTeamId
    ? teamsById.get(homeTeamId)?.name || translateSlot(match.home)
    : translateSlot(match.home);
  const awayName = awayTeamId
    ? teamsById.get(awayTeamId)?.name || translateSlot(match.away)
    : translateSlot(match.away);

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <TeamFlag
            teamId={homeTeamId}
            className="h-5 w-5 shrink-0 rounded-full border border-white/15 object-cover"
          />
          <span className="shrink-0 rounded-md bg-white/[0.07] px-2 py-0.5 text-sm font-bold text-white">
            {result.homeScore}-{result.awayScore}
          </span>
          <TeamFlag
            teamId={awayTeamId}
            className="h-5 w-5 shrink-0 rounded-full border border-white/15 object-cover"
          />
          <span className="min-w-0 truncate text-sm font-semibold text-white">
            {homeName} · {awayName}
          </span>
        </div>
        <span
          className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-bold ${
            points > 0
              ? "bg-[#a7f600]/12 text-[#a7f600]"
              : points < 0
                ? "bg-rose-400/12 text-rose-300"
                : "bg-white/[0.06] text-zinc-400"
          }`}
        >
          {points > 0 ? `+${points}` : points < 0 ? points : "0"}
        </span>
      </div>

      {item.breakdown.length ? (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {item.breakdown.map((part) => (
            <span
              key={part.label}
              className="inline-flex items-center gap-1 rounded bg-white/[0.05] px-1.5 py-0.5 text-[10px] font-medium text-zinc-400"
            >
              {part.label}
              <span
                className={
                  part.points >= 0 ? "text-white" : "text-red-400"
                }
              >
                {part.points > 0 ? `+${part.points}` : part.points}
              </span>
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-[11px] font-medium text-zinc-500">
          No has puntuado en este partido.
        </p>
      )}
    </div>
  );
}

type MatchFeedStatus = "finished" | "live" | "awaiting";

type JornadaMatch = {
  match: Match;
  result?: AdminResult;
  status: MatchFeedStatus;
};

type Jornada = {
  date: string;
  matches: JornadaMatch[];
  matchNumbers: number[];
};

// Margen desde el inicio en el que damos un partido por "en juego". Pasado
// ese tiempo sin resultado final, queda "esperando resultado".
const matchLiveWindowMs = 2.5 * 60 * 60 * 1000;

function getMatchFeedStatus(
  match: Match,
  result: AdminResult | undefined,
  now: number,
): MatchFeedStatus | null {
  if (result && isFinishedResult(result) && hasFinishedScore(result)) {
    return "finished";
  }

  // Marcado como terminado por el proveedor/admin pero sin marcador valido.
  if (result && isFinishedResult(result) && !hasFinishedScore(result)) {
    return "awaiting";
  }

  const kickoff = new Date(scheduleUtc(match)).getTime();
  const started = now >= kickoff;
  if (started && now >= kickoff + matchLiveWindowMs) {
    return "awaiting";
  }

  const statusText = String(result?.status || "").toLowerCase();
  const liveByStatus =
    statusText.includes("live") ||
    statusText.includes("play") ||
    statusText.includes("1h") ||
    statusText.includes("2h") ||
    statusText.includes("ht");
  if (started || liveByStatus || (result && hasAdminScore(result))) {
    return "live";
  }

  return null;
}

function readMatchScore(result: AdminResult | undefined) {
  if (!result) return null;
  const { homeScore, awayScore } = result;
  const empty = (value: number | string | undefined | null) =>
    value === "" || value === undefined || value === null;
  if (empty(homeScore) || empty(awayScore)) return null;
  return { home: homeScore, away: awayScore };
}

type ScorerBreakdown = { exact: number; outcome: number; xi: number };
type JornadaScorer = {
  profile: UserProfile;
  points: number;
  breakdown: ScorerBreakdown;
};

function buildJornadas(results: AdminResults): Jornada[] {
  const now = Date.now();
  const byDate = new Map<string, JornadaMatch[]>();

  schedule.forEach((match) => {
    const result = results[String(match.number)];
    const status = getMatchFeedStatus(match, result, now);
    if (!status) return;
    const list = byDate.get(match.date) || [];
    list.push({ match, result, status });
    byDate.set(match.date, list);
  });

  return Array.from(byDate.entries())
    .map(([date, matches]) => {
      const sorted = matches.sort((a, b) => a.match.number - b.match.number);
      return {
        date,
        matches: sorted,
        matchNumbers: sorted.map((item) => item.match.number),
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 8);
}

function jornadaScorers(
  profiles: UserProfile[],
  matchNumbers: number[],
): JornadaScorer[] {
  const numbers = new Set(matchNumbers);
  return (
    profiles
      .map((profile) => {
        let points = 0;
        const breakdown: ScorerBreakdown = { exact: 0, outcome: 0, xi: 0 };
        profile.scorecard.entries.forEach((entry) => {
          if (!entry.matchNumber || !numbers.has(entry.matchNumber)) return;
          points += entry.points;
          if (entry.ruleCode === "match_exact_score") {
            breakdown.exact += entry.points;
          } else if (entry.ruleCode === "match_outcome_hit") {
            breakdown.outcome += entry.points;
          } else if (entry.ruleCode.startsWith("player_")) {
            breakdown.xi += entry.points;
          }
        });
        return { profile, points, breakdown };
      })
      .filter((row) => row.points !== 0)
      // Orden estable: `profiles` ya viene ordenado por la clasificacion
      // general, asi que los empates a puntos de jornada se desempatan por
      // puesto en la clasificacion.
      .sort((a, b) => b.points - a.points)
  );
}

const scorerBreakdownLabels: Array<{
  key: keyof ScorerBreakdown;
  label: string;
}> = [
  { key: "exact", label: "Exacto" },
  { key: "outcome", label: "Acierto" },
  { key: "xi", label: "Tu once" },
];

// Cuantos puntuadores se ven antes de "Mostrar mas".
const jornadaScorersCollapsed = 3;

function HomeFeedSection({
  currentUserId,
  hasUser,
  leaderboard,
  nextMatchdayKey,
  onScoreChange,
  prediction,
  ready,
  results,
  saveState,
  upcomingMatches,
}: {
  currentUserId: string;
  hasUser: boolean;
  leaderboard: UserProfile[];
  nextMatchdayKey: string;
  onScoreChange: (
    matchNumber: number,
    side: "homeScore" | "awayScore",
    value: string,
  ) => void;
  prediction: Prediction;
  ready: boolean;
  results: AdminResults;
  saveState: HomeSaveState | null;
  upcomingMatches: Match[];
}) {
  const jornadas = useMemo(() => buildJornadas(results), [results]);
  const hasContent = upcomingMatches.length > 0 || jornadas.length > 0;

  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white">
            Novedades
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Tus proximos partidos y los resultados de cada jornada
          </p>
        </div>
        <Link
          href="/porra?section=results&goto=next"
          className="w-fit shrink-0 rounded-lg border border-white/10 px-3 py-2 text-sm font-bold text-white transition hover:bg-white/10"
        >
          Ver partidos
        </Link>
      </div>

      {!ready ? (
        <Card className="overflow-hidden p-0">
          <div className="space-y-3 p-4">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-12 rounded-lg" />
            ))}
          </div>
        </Card>
      ) : hasContent ? (
        <div className="space-y-4">
          {upcomingMatches.length ? (
            <UpcomingJornadaCard
              dateKey={nextMatchdayKey}
              hasUser={hasUser}
              matches={upcomingMatches}
              onScoreChange={onScoreChange}
              prediction={prediction}
              results={results}
              saveState={saveState}
            />
          ) : null}
          {jornadas.map((jornada) => (
            <JornadaCard
              key={jornada.date}
              jornada={jornada}
              scorers={jornadaScorers(leaderboard, jornada.matchNumbers)}
              currentUserId={currentUserId}
            />
          ))}
        </div>
      ) : (
        <Card className="px-4 py-10 text-center text-sm leading-6 text-zinc-400">
          <p className="font-semibold text-white">
            Aun no hay nada que contar.
          </p>
          <p className="mt-1">
            En cuanto haya partidos veras aqui tus proximos encuentros y los
            resultados de cada jornada.
          </p>
        </Card>
      )}
    </section>
  );
}

function UpcomingJornadaCard({
  dateKey,
  hasUser,
  matches,
  onScoreChange,
  prediction,
  results,
  saveState,
}: {
  dateKey: string;
  hasUser: boolean;
  matches: Match[];
  onScoreChange: (
    matchNumber: number,
    side: "homeScore" | "awayScore",
    value: string,
  ) => void;
  prediction: Prediction;
  results: AdminResults;
  saveState: HomeSaveState | null;
}) {
  const pendingCount = matches.filter(
    (match) => !isMatchPredictionComplete(match, prediction),
  ).length;

  return (
    <div className="space-y-3 rounded-2xl border border-[#a7f600]/20 bg-[#a7f600]/[0.04] p-3 sm:p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#a7f600]/15 text-[#a7f600]">
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <path d="M16 2v4M8 2v4M3 10h18" />
            </svg>
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-white">Proxima jornada</h3>
            <p className="truncate text-xs font-medium text-zinc-400 first-letter:capitalize">
              {formatDate(dateKey)}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {saveState ? <HomeSaveStatus state={saveState} /> : null}
          {hasUser && pendingCount > 0 ? (
            <span className="rounded-full border border-yellow-300/25 bg-yellow-300/10 px-2.5 py-1 text-[11px] font-bold text-yellow-100">
              {pendingCount} sin rellenar
            </span>
          ) : hasUser ? (
            <span className="rounded-full border border-[#a7f600]/30 bg-[#a7f600]/12 px-2.5 py-1 text-[11px] font-bold text-[#a7f600]">
              Rellenada
            </span>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3">
        {matches.map((match) => (
          <UpcomingMatchCard
            key={match.number}
            compact
            match={match}
            hasUser={hasUser}
            prediction={prediction}
            result={results[String(match.number)]}
            onScoreChange={onScoreChange}
          />
        ))}
      </div>
    </div>
  );
}

function JornadaCard({
  currentUserId,
  jornada,
  scorers,
}: {
  currentUserId: string;
  jornada: Jornada;
  scorers: JornadaScorer[];
}) {
  const [expanded, setExpanded] = useState(false);
  const visibleScorers = expanded
    ? scorers
    : scorers.slice(0, jornadaScorersCollapsed);

  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-white/10 px-4 py-3">
        <h3 className="truncate text-sm font-bold text-white first-letter:capitalize">
          {formatDate(jornada.date)}
        </h3>
      </div>

      <div className="divide-y divide-white/10">
        {jornada.matches.map((item) => (
          <JornadaMatchRow key={item.match.number} item={item} />
        ))}
      </div>

      {scorers.length ? (
        <div className="border-t border-white/10 bg-white/[0.015] px-4 py-3">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-500">
            Han puntuado{" "}
            <span className="text-zinc-400">· {scorers.length}</span>
          </p>
          <div className="space-y-2.5">
            {visibleScorers.map(({ breakdown, points, profile }, index) => {
              const parts = scorerBreakdownLabels
                .map((part) => ({
                  label: part.label,
                  value: breakdown[part.key],
                }))
                .filter((part) => part.value !== 0);
              const position = index + 1;

              return (
                <Link
                  key={profile.id}
                  href={`/perfil/${encodeURIComponent(profile.id)}`}
                  className="-mx-2 flex items-start justify-between gap-3 rounded-lg px-2 py-1 transition hover:bg-white/[0.04]"
                >
                  <div className="flex min-w-0 items-start gap-2.5">
                    {position <= 3 ? (
                      <span
                        className="mt-0.5 flex h-8 w-7 shrink-0 items-center justify-center text-lg leading-none"
                        aria-label={`Puesto ${position}`}
                      >
                        {rankLabel(position)}
                      </span>
                    ) : (
                      <span
                        className="mt-0.5 flex h-8 w-7 shrink-0 items-center justify-center rounded-md bg-white/[0.06] text-xs font-bold text-zinc-300"
                        aria-label={`Puesto ${position}`}
                      >
                        {position}
                      </span>
                    )}
                    <Avatar
                      name={profile.name}
                      avatarUrl={profile.avatarUrl}
                      className="size-9"
                    />
                    <div className="min-w-0">
                      <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-white">
                        <span className="truncate">{profile.name}</span>
                        {profile.isPro ? <ProBadge /> : null}
                        {profile.isWolf ? <WolfBadge /> : null}
                        {profile.id === currentUserId ? (
                          <span className="shrink-0 text-zinc-500">· tú</span>
                        ) : null}
                      </p>
                      {parts.length ? (
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          {parts.map((part) => (
                            <span
                              key={part.label}
                              className="inline-flex items-center gap-1 rounded bg-white/[0.05] px-1.5 py-0.5 text-[10px] font-medium text-zinc-400"
                            >
                              {part.label}
                              <span
                                className={
                                  part.value >= 0
                                    ? "text-white"
                                    : "text-red-400"
                                }
                              >
                                {part.value > 0 ? `+${part.value}` : part.value}
                              </span>
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <span
                    className={`mt-0.5 shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold ${
                      points >= 0
                        ? "bg-[#a7f600]/12 text-[#a7f600]"
                        : "bg-rose-400/12 text-rose-300"
                    }`}
                  >
                    {points > 0 ? `+${points}` : points}
                  </span>
                </Link>
              );
            })}
          </div>

          {scorers.length > jornadaScorersCollapsed ? (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={expanded}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] py-2 text-xs font-bold text-zinc-300 transition hover:bg-white/[0.06] hover:text-white"
            >
              {expanded
                ? "Mostrar menos"
                : `Ver ${scorers.length - jornadaScorersCollapsed} mas`}
              <svg
                aria-hidden="true"
                viewBox="0 0 16 16"
                className={`h-3.5 w-3.5 transition-transform ${
                  expanded ? "rotate-180" : ""
                }`}
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 6l4 4 4-4" />
              </svg>
            </button>
          ) : null}
        </div>
      ) : (
        <div className="border-t border-white/10 px-4 py-3 text-xs text-zinc-500">
          Aun nadie ha puntuado en esta jornada.
        </div>
      )}
    </Card>
  );
}

function JornadaMatchRow({ item }: { item: JornadaMatch }) {
  const { match, result, status } = item;
  const homeTeamId =
    result?.homeTeamId || (teamsById.has(match.home) ? match.home : "");
  const awayTeamId =
    result?.awayTeamId || (teamsById.has(match.away) ? match.away : "");
  const homeName = homeTeamId
    ? teamsById.get(homeTeamId)?.name || translateSlot(match.home)
    : translateSlot(match.home);
  const awayName = awayTeamId
    ? teamsById.get(awayTeamId)?.name || translateSlot(match.away)
    : translateSlot(match.away);
  const score = readMatchScore(result);
  const events = (result?.events || []).filter(
    (event) => event.playerId && matchEventIcons[String(event.type)],
  );
  const homeEvents = events.filter((event) => {
    const team = playersById.get(event.playerId)?.team || event.teamId || "";
    return team !== awayTeamId;
  });
  const awayEvents = events.filter((event) => {
    const team = playersById.get(event.playerId)?.team || event.teamId || "";
    return team === awayTeamId;
  });

  return (
    <div className="px-4 py-4">
      <div className="flex items-center gap-2 sm:gap-3">
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2 sm:gap-2.5">
          <span className="min-w-0 truncate text-right text-sm font-bold leading-tight text-white sm:text-base">
            {homeName}
          </span>
          <TeamFlag
            teamId={homeTeamId}
            className="h-6 w-6 shrink-0 rounded-full border border-white/15 object-cover sm:h-7 sm:w-7"
          />
        </div>
        <span
          className={`shrink-0 rounded-lg px-3 py-1 text-lg font-bold tabular-nums tracking-wide sm:px-3.5 sm:text-xl ${
            score
              ? "bg-white/[0.08] text-white"
              : "bg-white/[0.04] text-zinc-500"
          }`}
        >
          {score ? `${score.home} - ${score.away}` : "– - –"}
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-2.5">
          <TeamFlag
            teamId={awayTeamId}
            className="h-6 w-6 shrink-0 rounded-full border border-white/15 object-cover sm:h-7 sm:w-7"
          />
          <span className="min-w-0 truncate text-sm font-bold leading-tight text-white sm:text-base">
            {awayName}
          </span>
        </div>
        <div className="ml-1 flex w-[104px] shrink-0 justify-end">
          {status === "live" ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-400/25 bg-rose-400/10 px-2 py-0.5 text-[11px] font-bold text-rose-200">
              <span className="h-1.5 w-1.5 rounded-full bg-rose-400 animate-pulse" />
              En juego
            </span>
          ) : status === "awaiting" ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/25 bg-amber-300/10 px-2 py-0.5 text-[11px] font-bold text-amber-200">
              Falta resultado
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[11px] font-bold text-zinc-400">
              Finalizado
            </span>
          )}
        </div>
      </div>

      {events.length ? (
        <div className="mt-2.5 grid grid-cols-2 gap-x-4 border-t border-white/[0.06] pt-2.5">
          <div className="space-y-1">
            {homeEvents.map((event, index) => (
              <MatchEventLine key={event.id || `h${index}`} event={event} />
            ))}
          </div>
          <div className="space-y-1">
            {awayEvents.map((event, index) => (
              <MatchEventLine
                key={event.id || `a${index}`}
                event={event}
                align="right"
              />
            ))}
          </div>
        </div>
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
      className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition hover:bg-white/[0.04]"
    >
      <span
        className={`flex w-6 shrink-0 items-center justify-center text-sm font-bold ${rankTextClass(position)}`}
        aria-label={`Puesto ${position}`}
      >
        {rankLabel(position)}
      </span>
      <Avatar
        name={profile.name}
        avatarUrl={profile.avatarUrl}
        className="size-8 shrink-0"
      />
      <strong className="flex min-w-0 flex-1 items-center gap-1.5 text-sm font-semibold text-white">
        <span className="truncate">{profile.name}</span>
        {profile.isPro ? <ProBadge /> : null}
        {profile.isWolf ? <WolfBadge /> : null}
      </strong>
      <span className="shrink-0 text-sm font-bold text-white">
        {profile.points}
        <span className="ml-0.5 text-xs font-semibold text-zinc-500">pts</span>
      </span>
    </Link>
  );
}

function TopPlayerRow({
  row,
  position,
}: {
  row: PlayerStandingRow;
  position: number;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
      <span
        className={`flex w-6 shrink-0 items-center justify-center text-sm font-bold ${rankTextClass(position)}`}
        aria-label={`Puesto ${position}`}
      >
        {rankLabel(position)}
      </span>
      <PlayerAvatar
        player={row.player}
        className="size-8! shrink-0 text-[10px]"
      />
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <strong className="truncate text-sm font-semibold text-white">
          {row.player.name}
        </strong>
        <TeamFlag
          teamId={row.player.team}
          className="h-3 w-4 shrink-0 rounded-[2px]"
        />
      </span>
      <span className="shrink-0 text-sm font-bold text-white">
        {row.points}
        <span className="ml-0.5 text-xs font-semibold text-zinc-500">pts</span>
      </span>
    </div>
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

function isMatchPending(match: Match, results: AdminResults) {
  // Un partido esta "pendiente" (Proxima jornada) solo si no ha empezado y no
  // tiene ningun dato: asi nunca se solapa con el feed (en juego / falta
  // resultado / terminado), que son justo los estados con feed status != null.
  return (
    getMatchFeedStatus(match, results[String(match.number)], Date.now()) ===
    null
  );
}

function getNextMatchdayKey(results: AdminResults) {
  const dateKeys = Array.from(
    new Set(schedule.map((match) => match.date)),
  ).sort();
  // La proxima jornada es la primera fecha que aun tiene algun partido
  // pendiente (sin empezar y sin resultado), asi en cuanto terminan todos
  // los partidos de una jornada se pasa a mostrar la siguiente.
  const nextMatchday = dateKeys.find((dateKey) =>
    schedule.some(
      (match) => match.date === dateKey && isMatchPending(match, results),
    ),
  );

  return nextMatchday || "";
}

function UpcomingMatchCard({
  compact = false,
  hasUser,
  match,
  prediction,
  result,
  onScoreChange,
}: {
  compact?: boolean;
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
        homeTeamId={
          result.homeTeamId ||
          (teamsById.has(match.home) ? match.home : undefined)
        }
        awayTeamId={
          result.awayTeamId ||
          (teamsById.has(match.away) ? match.away : undefined)
        }
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
      <div
        className={`grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 pb-0 sm:gap-3 ${
          compact ? "pt-2.5" : "pt-3 sm:px-4 sm:pt-4"
        }`}
      >
        <span className="min-w-0 justify-self-start text-xs font-semibold text-zinc-400">
          {matchStageLabel(match)}
        </span>
        <time className="inline-flex items-center justify-self-center text-sm font-semibold text-zinc-200">
          {formatResultTime(match)}
        </time>
        {hasUser ? (
          <HomeResultStatusBadge
            complete={predictionComplete}
            locked={locked}
            className={`justify-self-end ${compact ? "" : "sm:hidden"}`}
          />
        ) : null}
      </div>

      {compact ? (
        <div className="flex items-center justify-center gap-2.5 px-3 pb-3 pt-2 sm:gap-4">
          <CompactTeamSide
            reversed
            teamId={match.home}
            fallback={translateSlot(match.home)}
          />
          {hasUser ? (
            <div className="flex shrink-0 items-center gap-1">
              <HomeResultScoreStepper
                label="Goles local"
                value={matchPrediction.homeScore}
                disabled={locked}
                horizontal
                onChange={(value) =>
                  onScoreChange(match.number, "homeScore", value)
                }
              />
              <span className="px-0.5 text-sm font-bold text-zinc-500">-</span>
              <HomeResultScoreStepper
                label="Goles visitante"
                value={matchPrediction.awayScore}
                disabled={locked}
                horizontal
                onChange={(value) =>
                  onScoreChange(match.number, "awayScore", value)
                }
              />
            </div>
          ) : (
            <HomeVsPill />
          )}
          <CompactTeamSide
            teamId={match.away}
            fallback={translateSlot(match.away)}
          />
        </div>
      ) : (
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
      )}

      {compact ? null : (
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
                {predictionComplete ? (
                  <CheckIcon className="h-3.5 w-3.5" />
                ) : null}
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
      )}

      <div
        className={`border-t border-white/10 px-3 py-2 sm:px-4 ${
          compact && !hasLiveScore ? "hidden" : ""
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 truncate text-xs text-zinc-400">
            {match.venue}
          </p>
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

      {!locked && !hasLiveScore ? (
        <div className="flex items-center justify-center border-t border-white/10 px-3 py-2 sm:px-4">
          <MatchCountdown
            match={match}
            className="text-xs font-semibold text-zinc-300"
          />
        </div>
      ) : null}
    </article>
  );
}

function CompactTeamSide({
  fallback,
  reversed = false,
  teamId,
}: {
  fallback: string;
  reversed?: boolean;
  teamId?: string;
}) {
  const teamName = (teamId ? teamsById.get(teamId)?.name : "") || fallback;

  return (
    <span
      title={teamName}
      aria-label={teamName}
      className={`flex min-w-0 flex-1 items-center justify-center gap-2 sm:justify-start ${
        reversed ? "flex-row-reverse" : ""
      }`}
    >
      {teamId && teamsById.has(teamId) ? (
        <TeamFlag
          teamId={teamId}
          className="h-7 w-7 shrink-0 rounded-full border border-white/15 object-cover"
        />
      ) : (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/10 text-[8px] font-bold text-zinc-300">
          TBD
        </span>
      )}
      {/* En escritorio hay sitio para el nombre; en movil solo la bandera. */}
      <span className="hidden min-w-0 truncate text-sm font-semibold text-white sm:inline">
        {teamName}
      </span>
    </span>
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
  horizontal = false,
  label,
  onChange,
  value,
}: {
  compact?: boolean;
  disabled: boolean;
  horizontal?: boolean;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  const numericValue = Number(value || 0);
  const increment = () => onChange(String(Math.min(99, numericValue + 1)));
  const decrement = () => onChange(String(Math.max(0, numericValue - 1)));

  if (horizontal) {
    return (
      <div className="flex h-8 items-center overflow-hidden rounded-md">
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          onClick={decrement}
          className="flex h-8 w-6 items-center justify-center bg-[#454545] text-base font-bold leading-none text-zinc-100 transition hover:bg-[#555] disabled:text-zinc-600"
          aria-label={`Bajar ${label}`}
        >
          -
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
          className="score-number-input h-8 w-8 appearance-none bg-[#222] text-center text-sm font-bold text-white outline-none placeholder:text-zinc-600 disabled:opacity-60"
          placeholder="?"
          aria-label={label}
        />
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          onClick={increment}
          className="flex h-8 w-6 items-center justify-center bg-[#454545] text-base font-bold leading-none text-zinc-100 transition hover:bg-[#555] disabled:text-zinc-600"
          aria-label={`Subir ${label}`}
        >
          +
        </button>
      </div>
    );
  }

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
    <span className="rounded-lg bg-white/10 px-3 py-2 text-sm font-bold text-white">
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
