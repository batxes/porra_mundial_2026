"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  Avatar,
  Card,
  CommunitySwapRow,
  FinishedMatchCard,
  hasFinishedScore,
  MatchEventLine,
  matchEventIcons,
  matchEventTeamId,
  MatchCountdown,
  matchStageLabel,
  PlayerAvatar,
  PrimaryLink,
  ProBadge,
  RankNumber,
  Skeleton,
  TeamFlag,
  WolfBadge,
} from "@/components/common";
import {
  isFinishedResult,
  readRankBeforeUpdate,
  subscribeRankDelta,
} from "@/components/results-recap";
import { PlayerDetailModal } from "@/components/player-detail-modal";
import {
  PlayoffResultsIntroModal,
  playoffResultsIntroStorageKey,
} from "@/components/playoff-results-intro-modal";
import { PlayoffTrainerChipModal } from "@/components/playoffs-balatro-demo";
import { WorldCupBracketModal } from "@/components/world-cup-bracket-modal";
import { useAppContext } from "@/lib/app-context";
import {
  TrainerFullArtCard,
  trainerDemoCards,
  type TrainerDemoCard,
} from "@/components/trainer-full-art-card";
import { TrainerTacticPickPill } from "@/components/trainer-tactic-pick-pill";
import {
  addTrainerChipPoints,
  matchTrainerTacticLines,
  sortTrainerChips,
  TrainerChipPickPill,
  TrainerChipScorePill,
  type TrainerChipPoints,
  trainerChipFromScoreEntry,
  TrainerTacticEventLine,
} from "@/components/trainer-chip-score-pill";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import {
  countUnopenedPacks,
  countUnopenedPacksRemote,
  formatCountdownHMS,
  secondsUntilNextDailyCard,
} from "@/lib/cofres";
import { data, playersById, schedule, teamsById } from "@/lib/data";
import { formatDate, translateSlot } from "@/lib/format";
import { calculateShootoutScore } from "@/lib/match-events";
import {
  buildResolvedPlayoffTeams,
  calculateGroupTables,
  type GroupTable,
  type ResolvedPlayoffTeams,
} from "@/lib/playoff-teams";
import {
  calculatePlayerStandings,
  createEngine,
  type PlayerStandingRow,
} from "@/lib/scoring";
import {
  emptyPrediction,
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
const showHomeGroupPhaseReport = false;

function resolveHomePlayoffMatch(
  match: Match,
  resolvedPlayoffTeams: ResolvedPlayoffTeams,
) {
  if (match.number < 73) return match;

  const resolved = resolvedPlayoffTeams[String(match.number)];
  if (!resolved?.home && !resolved?.away) return match;

  return {
    ...match,
    home: resolved.home || match.home,
    away: resolved.away || match.away,
  };
}

export function HomeView() {
  const router = useRouter();
  const {
    adminResults,
    leaderboard: fullLeaderboard,
    prediction,
    ready,
    savePrediction,
    setPredictionScore,
    setPredictionTrainerTactic,
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
  const resolvedPlayoffTeams = useMemo(
    () => buildResolvedPlayoffTeams(adminResults),
    [adminResults],
  );
  const hasPendingPlayoffMatches = useMemo(
    () =>
      schedule.some(
        (match) =>
          isTrainerChipMatch(match) && isMatchPending(match, adminResults),
      ),
    [adminResults],
  );
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [homeChipMatchNumber, setHomeChipMatchNumber] = useState<number | null>(
    null,
  );
  const [homeSaveState, setHomeSaveState] = useState<HomeSaveState>("idle");
  const [reminderMatches, setReminderMatches] = useState<Match[]>([]);
  const [showHomePlayoffIntroModal, setShowHomePlayoffIntroModal] =
    useState(false);
  const homePlayoffIntroQueuedRef = useRef(false);
  const rankBeforeUpdate = useSyncExternalStore(
    subscribeRankDelta,
    () => readRankBeforeUpdate(user?.id),
    () => null,
  );

  useEffect(() => {
    if (
      !ready ||
      !user?.id ||
      !hasPendingPlayoffMatches ||
      homePlayoffIntroQueuedRef.current
    ) {
      return;
    }

    try {
      if (window.localStorage.getItem(playoffResultsIntroStorageKey) === "1") {
        return;
      }
    } catch {
      // Ignore storage failures.
    }

    homePlayoffIntroQueuedRef.current = true;
    const frame = window.requestAnimationFrame(() =>
      setShowHomePlayoffIntroModal(true),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [hasPendingPlayoffMatches, ready, user?.id]);

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
      .slice(0, 2)
      .map((match) => resolveHomePlayoffMatch(match, resolvedPlayoffTeams));

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
  }, [prediction, ready, resolvedPlayoffTeams, user]);

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
        .map((match) => resolveHomePlayoffMatch(match, resolvedPlayoffTeams))
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
  const changeHomeTrainerTactic = (
    matchNumber: number,
    trainerTeamId: string,
    tacticId: string,
  ) => {
    if (!user) return;
    homeEditPendingRef.current = true;
    setPredictionTrainerTactic(matchNumber, trainerTeamId, tacticId);
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

  const dismissHomePlayoffIntroModal = () => {
    homePlayoffIntroQueuedRef.current = true;
    try {
      window.localStorage.setItem(playoffResultsIntroStorageKey, "1");
    } catch {
      // Ignore storage failures.
    }
    setShowHomePlayoffIntroModal(false);
  };

  const startHomePlayoffIntroModal = () => {
    dismissHomePlayoffIntroModal();
    router.push("/porra?section=playoffResults&goto=next");
  };

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
          {/* Mini marcador, mismo lenguaje que el pie del reporte de resultados */}
          <div className="flex shrink-0 overflow-hidden rounded-xl border border-white/10 bg-white/[0.04]">
            {ready && userRank ? (
              <div className="px-3 py-1.5 text-center sm:px-4 sm:py-2">
                <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-zinc-500">
                  Puesto
                </p>
                <p className="mt-0.5 text-lg font-bold leading-none text-white sm:text-xl">
                  {userRank}º
                  {rankBeforeUpdate !== null &&
                  rankBeforeUpdate !== userRank ? (
                    <span
                      title="Desde los últimos resultados"
                      className={`ml-1 align-middle text-[10px] font-bold ${
                        rankBeforeUpdate > userRank
                          ? "text-[#a7f600]"
                          : "text-rose-300"
                      }`}
                    >
                      {rankBeforeUpdate > userRank
                        ? `▲${rankBeforeUpdate - userRank}`
                        : `▼${userRank - rankBeforeUpdate}`}
                    </span>
                  ) : null}
                </p>
              </div>
            ) : null}
            <div
              className={`bg-[radial-gradient(90px_at_50%_-30%,rgba(167,246,0,0.2),transparent)] bg-[#a7f600]/[0.06] px-3 py-1.5 text-center sm:px-4 sm:py-2 ${
                ready && userRank ? "border-l border-white/10" : ""
              }`}
            >
              <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#a7f600] opacity-70">
                Puntos
              </p>
              <p className="mt-0.5 text-lg font-bold leading-none text-[#a7f600] sm:text-xl">
                {user.points}
              </p>
            </div>
          </div>
        </section>
      ) : (
        <section className="flex flex-col items-center py-2 text-center">
          <Image
            src="/logo.png"
            alt=""
            width={88}
            height={88}
            className="theme-logo-dark mb-4 h-16 w-16 object-contain sm:h-20 sm:w-20"
            priority
          />
          <Image
            src="/logo-light.png"
            alt=""
            width={88}
            height={88}
            className="theme-logo-light mb-4 h-16 w-16 object-contain sm:h-20 sm:w-20"
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
        <div className="flex flex-col gap-6">
          {user ? (
            <div className="flex flex-col gap-3">
              <PlayoffsPromoBanner />
              <SobresPromoBanner userId={user.id} />
            </div>
          ) : null}
          <HomeFeedSection
            currentUserId={user?.id || ""}
            currentUserName={user?.name || ""}
            hasUser={Boolean(user)}
            leaderboard={leaderboard}
            nextMatchdayKey={nextMatchdayKey}
            onScoreChange={changeHomePredictionScore}
            onTrainerChipOpen={(matchNumber) =>
              setHomeChipMatchNumber(matchNumber)
            }
            prediction={prediction}
            ready={ready}
            results={adminResults}
            saveState={user && homeSaveState !== "idle" ? homeSaveState : null}
            upcomingMatches={upcomingMatches}
          />
        </div>

        <aside className="grid grid-cols-1 gap-6">
          <section className="space-y-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold tracking-tight text-white">
                  Clasificación
                </h2>
                <p className="mt-1 text-sm text-zinc-500">
                  {ready ? `${leaderboard.length} participantes` : " "}
                </p>
              </div>
              <Link
                href="/clasificacion"
                className="w-fit shrink-0 rounded-lg border border-white/10 px-3 py-2 text-sm font-bold text-white transition hover:bg-white/10"
              >
                Ver más
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
                Aún no hay participantes.
              </div>
            )}
          </section>

          <RecentSwapsFeed />

          {ready && topPlayers.length ? (
            <section className="space-y-3">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold tracking-tight text-white">
                    Jugadores
                  </h2>
                  <p className="mt-1 text-sm text-zinc-500">
                    Los futbolistas que más puntos suman
                  </p>
                </div>
                <Link
                  href="/clasificacion?tab=jugadores"
                  className="w-fit shrink-0 rounded-lg border border-white/10 px-3 py-2 text-sm font-bold text-white transition hover:bg-white/10"
                >
                  Ver más
                </Link>
              </div>

              <div className="divide-y divide-white/[0.06]">
                {topPlayers.map((row, index) => (
                  <TopPlayerRow
                    key={row.player.id}
                    row={row}
                    position={index + 1}
                    onSelect={setSelectedPlayerId}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </aside>
      </div>

      {showHomePlayoffIntroModal ? (
        <PlayoffResultsIntroModal
          onClose={dismissHomePlayoffIntroModal}
          onStartFilling={startHomePlayoffIntroModal}
        />
      ) : null}
      {!showHomePlayoffIntroModal && reminderMatches.length ? (
        <ResultsReminderModal
          matches={reminderMatches}
          prediction={prediction}
          onClose={() => setReminderMatches([])}
        />
      ) : null}
      {selectedPlayerId ? (
        <PlayerDetailModal
          playerId={selectedPlayerId}
          onClose={() => setSelectedPlayerId(null)}
        />
      ) : null}
      {homeChipMatchNumber ? (
        <PlayoffTrainerChipModal
          key={homeChipMatchNumber}
          adminResults={adminResults}
          matchNumber={homeChipMatchNumber}
          onClose={() => setHomeChipMatchNumber(null)}
          onTrainerTacticChange={changeHomeTrainerTactic}
          prediction={prediction}
        />
      ) : null}
    </div>
  );
}

export function HomeTomorrowPreview() {
  const previewPrediction = useMemo(() => {
    const next = emptyPrediction();
    next.matchPredictions["73"] = {
      homeScore: "",
      awayScore: "",
      trainerTeamId: "can",
      tacticId: "set-piece",
    };
    next.matchPredictions["75"] = {
      homeScore: "",
      awayScore: "",
      trainerTeamId: "ned",
      tacticId: "red-card",
    };
    next.matchPredictions["88"] = {
      homeScore: "",
      awayScore: "",
      trainerTeamId: "egy",
      tacticId: "penalty",
    };
    return next;
  }, []);
  const previewMatches = useMemo(() => {
    const overrides: Array<{ away: string; home: string; number: number }> = [
      { number: 73, home: "rsa", away: "can" },
      { number: 75, home: "ned", away: "mar" },
      { number: 76, home: "bra", away: "jpn" },
      { number: 88, home: "aus", away: "egy" },
    ];

    return overrides.flatMap((override) => {
      const match = schedule.find(
        (candidate) => candidate.number === override.number,
      );
      return match
        ? [{ ...match, home: override.home, away: override.away }]
        : [];
    });
  }, []);

  if (!previewMatches.length) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-8 text-sm text-zinc-400">
        No se han encontrado los partidos de preview.
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <section className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-white">
              Novedades
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              Preview local con los partidos de mañana
            </p>
          </div>
          <Link
            href="/porra?section=playoffResults&match=73"
            className="w-fit shrink-0 rounded-lg border border-white/10 px-3 py-2 text-sm font-bold text-white transition hover:bg-white/10"
          >
            Ver partidos
          </Link>
        </div>

        <UpcomingJornadaCard
          dateKey="2026-06-28"
          hasUser
          matches={previewMatches}
          onScoreChange={() => undefined}
          prediction={previewPrediction}
          results={{}}
          saveState={null}
        />
      </section>
    </main>
  );
}

const homeNewsPreviewResults: AdminResults = {
  "73": {
    homeScore: 2,
    awayScore: 1,
    homeTeamId: "rsa",
    awayTeamId: "can",
    status: "validated",
    events: [],
    trainerTactics: {
      "set-piece": ["can"],
    },
  },
  "75": {
    homeScore: 1,
    awayScore: 2,
    homeTeamId: "ned",
    awayTeamId: "mar",
    status: "validated",
    events: [],
    trainerTactics: {
      "red-card": ["ned"],
    },
  },
  "76": {
    homeScore: 3,
    awayScore: 1,
    homeTeamId: "bra",
    awayTeamId: "jpn",
    status: "validated",
    events: [],
  },
  "88": {
    homeScore: 1,
    awayScore: 1,
    homeTeamId: "aus",
    awayTeamId: "egy",
    status: "validated",
    events: [],
    trainerTactics: {
      penalty: ["aus"],
    },
  },
};

function buildHomeNewsPreviewProfiles(): UserProfile[] {
  const engine = createEngine({ data, schedule });
  const currentPrediction = emptyPrediction();
  currentPrediction.matchPredictions["73"] = {
    homeScore: "2",
    awayScore: "1",
    trainerTeamId: "can",
    tacticId: "set-piece",
  };
  currentPrediction.matchPredictions["75"] = {
    homeScore: "1",
    awayScore: "2",
    trainerTeamId: "ned",
    tacticId: "red-card",
  };
  currentPrediction.matchPredictions["76"] = {
    homeScore: "2",
    awayScore: "1",
  };
  currentPrediction.matchPredictions["88"] = {
    homeScore: "1",
    awayScore: "1",
    trainerTeamId: "aus",
    tacticId: "penalty",
  };

  const rivalPrediction = emptyPrediction();
  rivalPrediction.matchPredictions["73"] = {
    homeScore: "1",
    awayScore: "1",
    trainerTeamId: "rsa",
    tacticId: "set-piece",
  };
  rivalPrediction.matchPredictions["75"] = {
    homeScore: "0",
    awayScore: "2",
    trainerTeamId: "mar",
    tacticId: "red-card",
  };
  rivalPrediction.matchPredictions["76"] = {
    homeScore: "3",
    awayScore: "1",
  };
  rivalPrediction.matchPredictions["88"] = {
    homeScore: "0",
    awayScore: "0",
    trainerTeamId: "aus",
    tacticId: "penalty",
  };

  const profiles = [
    {
      id: "preview-current",
      name: "Tu Demo",
      email: "",
      avatarUrl: "preset:green",
      isAdmin: false,
      isPro: true,
      isWolf: false,
      isHidden: false,
      complete: 0,
      champion: "",
      prediction: currentPrediction,
    },
    {
      id: "preview-rival",
      name: "Rival Demo",
      email: "",
      avatarUrl: "preset:purple",
      isAdmin: false,
      isPro: false,
      isWolf: true,
      isHidden: false,
      complete: 0,
      champion: "",
      prediction: rivalPrediction,
    },
  ];

  return profiles
    .map((profile) => {
      const scorecard = engine.calculateScorecard(
        profile.prediction,
        homeNewsPreviewResults,
        profile.id,
      );
      return {
        ...profile,
        points: scorecard.total,
        scorecard,
      };
    })
    .sort((a, b) => b.points - a.points);
}

export function HomeNewsChipsPreview() {
  const leaderboard = useMemo(() => buildHomeNewsPreviewProfiles(), []);
  const currentUser =
    leaderboard.find((profile) => profile.id === "preview-current") ||
    leaderboard[0];

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <HomeFeedSection
        currentUserId={currentUser?.id || ""}
        currentUserName={currentUser?.name || ""}
        hasUser
        leaderboard={leaderboard}
        nextMatchdayKey=""
        onScoreChange={() => undefined}
        prediction={currentUser?.prediction || emptyPrediction()}
        ready
        results={homeNewsPreviewResults}
        saveState={null}
        upcomingMatches={[]}
      />
    </main>
  );
}

function buildHomeGroupPreviewResults(): AdminResults {
  const results: AdminResults = {};

  schedule
    .filter((match) => match.stage === "Grupos")
    .forEach((match) => {
      const homeScore = (match.number * 7 + 1) % 4;
      let awayScore = (match.number * 5 + 2) % 4;
      if (homeScore === awayScore && match.number % 3 === 0) {
        awayScore = (awayScore + 1) % 4;
      }
      results[String(match.number)] = {
        homeScore,
        awayScore,
        homeTeamId: teamsById.has(match.home) ? match.home : "",
        awayTeamId: teamsById.has(match.away) ? match.away : "",
        status: "validated",
        events: [],
      };
    });

  return results;
}

const homeGroupPreviewResults = buildHomeGroupPreviewResults();

function bestThirdGroupsFromTables(groupTables: Record<string, GroupTable>) {
  return Object.entries(groupTables)
    .map(([group, table]) => ({
      group,
      row: table.positions.find((position) => position.position === 3),
    }))
    .filter((item): item is { group: string; row: NonNullable<typeof item.row> } =>
      Boolean(item.row),
    )
    .sort(
      (a, b) =>
        b.row.pts - a.row.pts ||
        b.row.gd - a.row.gd ||
        b.row.gf - a.row.gf ||
        (teamsById.get(a.row.teamId)?.name || "").localeCompare(
          teamsById.get(b.row.teamId)?.name || "",
        ),
    )
    .slice(0, 8)
    .map((item) => item.group);
}

function previewGroupPrediction(
  groupTables: Record<string, GroupTable>,
  variant: number,
) {
  const prediction = emptyPrediction();
  const groups = Object.keys(groupTables).sort((a, b) => a.localeCompare(b));

  groups.forEach((group, groupIndex) => {
    const ordered = groupTables[group].positions.map((row) => row.teamId);
    const nextOrder = [...ordered];

    if (variant === 1 && groupIndex % 2 === 0) {
      [nextOrder[0], nextOrder[1]] = [nextOrder[1], nextOrder[0]];
    } else if (variant === 2 && groupIndex % 3 === 0) {
      nextOrder.push(nextOrder.shift() || "");
    } else if (variant === 3 && groupIndex % 4 === 0) {
      nextOrder.reverse();
    } else if (variant === 4 && groupIndex % 2 === 1) {
      [nextOrder[1], nextOrder[2]] = [nextOrder[2], nextOrder[1]];
    } else if (variant === 5 && groupIndex % 5 === 0) {
      [nextOrder[0], nextOrder[3]] = [nextOrder[3], nextOrder[0]];
    }

    prediction.groups[group] ||= {};
    nextOrder.filter(Boolean).forEach((teamId, index) => {
      prediction.groups[group][teamId] = String(index + 1);
    });
  });

  const thirds = bestThirdGroupsFromTables(groupTables);
  prediction.bracket.thirdQualifiers =
    variant === 2
      ? thirds.slice(1).concat(thirds[0] ? [thirds[0]] : [])
      : variant === 4
        ? thirds.slice(0, 6).concat(groups.slice(0, 2))
        : thirds;

  return prediction;
}

function buildHomeGroupPreviewProfiles(): UserProfile[] {
  const engine = createEngine({ data, schedule });
  const groupTables = calculateGroupTables(homeGroupPreviewResults);
  const seeds = [
    {
      id: "preview-grupos-marta",
      name: "Marta Exacta",
      avatarUrl: "preset:green",
      isPro: true,
      isWolf: false,
      variant: 0,
    },
    {
      id: "preview-grupos-ines",
      name: "Inés Grupos",
      avatarUrl: "preset:rose",
      isPro: false,
      isWolf: true,
      variant: 1,
    },
    {
      id: "preview-grupos-diego",
      name: "Diego Terceros",
      avatarUrl: "preset:blue",
      isPro: false,
      isWolf: false,
      variant: 2,
    },
    {
      id: "preview-grupos-alex",
      name: "Álex Caos",
      avatarUrl: "preset:purple",
      isPro: false,
      isWolf: false,
      variant: 3,
    },
    {
      id: "preview-grupos-laura",
      name: "Laura Segunda",
      avatarUrl: "preset:gold",
      isPro: true,
      isWolf: false,
      variant: 4,
    },
    {
      id: "preview-grupos-pau",
      name: "Pau Remonta",
      avatarUrl: "preset:dark",
      isPro: false,
      isWolf: true,
      variant: 5,
    },
  ];

  return seeds
    .map((seed) => {
      const prediction = previewGroupPrediction(groupTables, seed.variant);
      const scorecard = engine.calculateScorecard(
        prediction,
        homeGroupPreviewResults,
        seed.id,
      );
      return {
        id: seed.id,
        name: seed.name,
        email: "",
        avatarUrl: seed.avatarUrl,
        points: scorecard.total,
        isAdmin: false,
        isPro: seed.isPro,
        isWolf: seed.isWolf,
        lateEdit: false,
        isHidden: false,
        complete: 100,
        champion: "",
        prediction,
        scorecard,
      };
    })
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
}

export function HomeGroupReportPreview() {
  const leaderboard = useMemo(() => buildHomeGroupPreviewProfiles(), []);
  const currentUser = leaderboard[0];
  const report = useMemo(
    () => buildGroupPhaseReport(leaderboard, homeGroupPreviewResults),
    [leaderboard],
  );

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      {report ? (
        <GroupPhaseReportCard
          currentUserId={currentUser?.id || ""}
          currentUserName={currentUser?.name || ""}
          report={report}
        />
      ) : null}
    </main>
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
type XiPlayerPoints = { playerId: string; points: number };
type JornadaScorer = {
  profile: UserProfile;
  points: number;
  breakdown: ScorerBreakdown;
  xiPlayers: XiPlayerPoints[];
  xiOther: number;
  trainerChips: TrainerChipPoints[];
};

function buildJornadas(results: AdminResults): Jornada[] {
  const now = Date.now();
  const byDate = new Map<string, JornadaMatch[]>();
  const resolvedPlayoffTeams = buildResolvedPlayoffTeams(results);

  schedule.forEach((match) => {
    const result = results[String(match.number)];
    const status = getMatchFeedStatus(match, result, now);
    if (!status) return;
    const list = byDate.get(match.date) || [];
    list.push({
      match: resolveHomePlayoffMatch(match, resolvedPlayoffTeams),
      result,
      status,
    });
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

function jornadaPointsFor(
  profile: UserProfile,
  numbers: Set<number>,
  results: AdminResults,
) {
  // Las entradas player_* llevan como sourceRef el id del evento del
  // partido: cruzandolo se atribuyen los puntos del once a cada futbolista.
  const eventPlayerById = new Map<string, string>();
  numbers.forEach((number) => {
    (results[String(number)]?.events || []).forEach((event) => {
      if (event.id && event.playerId) {
        eventPlayerById.set(event.id, event.playerId);
      }
    });
  });

  let points = 0;
  let entryCount = 0;
  const breakdown: ScorerBreakdown = { exact: 0, outcome: 0, xi: 0 };
  const xiByPlayer = new Map<string, number>();
  let xiOther = 0;
  const trainerByChip = new Map<string, TrainerChipPoints>();
  profile.scorecard.entries.forEach((entry) => {
    if (!entry.matchNumber || !numbers.has(entry.matchNumber)) return;
    points += entry.points;
    entryCount += 1;
    if (entry.ruleCode === "match_exact_score") {
      breakdown.exact += entry.points;
    } else if (entry.ruleCode === "match_outcome_hit") {
      breakdown.outcome += entry.points;
    } else if (entry.ruleCode.startsWith("player_")) {
      breakdown.xi += entry.points;
      const playerId = eventPlayerById.get(entry.sourceRef);
      if (playerId) {
        xiByPlayer.set(
          playerId,
          (xiByPlayer.get(playerId) || 0) + entry.points,
        );
      } else {
        xiOther += entry.points;
      }
    } else if (entry.ruleCode === "trainer_tactic_hit") {
      const chip = trainerChipFromScoreEntry(entry);
      if (chip) addTrainerChipPoints(trainerByChip, chip);
    }
  });
  const xiPlayers = [...xiByPlayer.entries()]
    .map(([playerId, playerPoints]) => ({ playerId, points: playerPoints }))
    .sort((a, b) => b.points - a.points);
  return {
    points,
    breakdown,
    entryCount,
    xiPlayers,
    xiOther,
    trainerChips: sortTrainerChips(trainerByChip),
  };
}

function jornadaScorers(
  profiles: UserProfile[],
  matchNumbers: number[],
  results: AdminResults,
): JornadaScorer[] {
  const numbers = new Set(matchNumbers);
  return (
    profiles
      .map((profile) => {
        const { points, breakdown, xiPlayers, xiOther, trainerChips } =
          jornadaPointsFor(profile, numbers, results);
        return {
          profile,
          points,
          breakdown,
          xiPlayers,
          xiOther,
          trainerChips,
        };
      })
      .filter((row) => row.points !== 0)
      // Orden estable: `profiles` ya viene ordenado por la clasificacion
      // general, asi que los empates a puntos de jornada se desempatan por
      // puesto en la clasificacion.
      .sort((a, b) => b.points - a.points)
  );
}

type JornadaUserSummary = {
  profile: UserProfile;
  points: number;
  breakdown: ScorerBreakdown;
  xiPlayers: XiPlayerPoints[];
  xiOther: number;
  trainerChips: TrainerChipPoints[];
  rank: number | null;
};

type JornadaGeneralStanding = { rank: number; move: number | null };

// Clasificacion general al cierre de cada jornada (puntos acumulados hasta
// esa fecha) y el movimiento que provoco frente a la vispera. Solo cuentan
// entradas fechables (con partido).
function jornadaGeneralStandings(
  profiles: UserProfile[],
  jornadaDate: string,
): Map<string, JornadaGeneralStanding> {
  const dateByMatch = new Map(
    schedule.map((match) => [match.number, match.date]),
  );
  const before = new Map<string, number>();
  const after = new Map<string, number>();
  profiles.forEach((profile) => {
    let pointsBefore = 0;
    let pointsAfter = 0;
    profile.scorecard.entries.forEach((entry) => {
      const date = entry.matchNumber
        ? dateByMatch.get(entry.matchNumber)
        : null;
      if (!date || date > jornadaDate) return;
      pointsAfter += entry.points;
      if (date < jornadaDate) pointsBefore += entry.points;
    });
    before.set(profile.id, pointsBefore);
    after.set(profile.id, pointsAfter);
  });

  const rankOf = (points: Map<string, number>) => {
    const ranks = new Map<string, number>();
    [...profiles]
      .sort(
        (a, b) =>
          (points.get(b.id) || 0) - (points.get(a.id) || 0) ||
          a.name.localeCompare(b.name),
      )
      .forEach((profile, index) => ranks.set(profile.id, index + 1));
    return ranks;
  };
  const ranksAfter = rankOf(after);
  // Sin historico previo (primera jornada) el "antes" seria orden alfabetico:
  // se enseña el puesto pero no movimientos inventados.
  const ranksBefore =
    Math.max(0, ...before.values()) > 0 ? rankOf(before) : null;

  const standings = new Map<string, JornadaGeneralStanding>();
  profiles.forEach((profile) => {
    const rank = ranksAfter.get(profile.id) || 0;
    standings.set(profile.id, {
      rank,
      move: ranksBefore ? (ranksBefore.get(profile.id) || 0) - rank : null,
    });
  });
  return standings;
}

// Resumen personal de la jornada: se muestra aunque no hayas puntuado,
// siempre que tuvieras algun pronostico en sus partidos.
function jornadaUserSummary(
  profiles: UserProfile[],
  currentUserId: string,
  prediction: Prediction,
  matchNumbers: number[],
  scorers: JornadaScorer[],
  results: AdminResults,
): JornadaUserSummary | null {
  if (!currentUserId) return null;
  const profile = profiles.find((candidate) => candidate.id === currentUserId);
  if (!profile) return null;

  const numbers = new Set(matchNumbers);
  const { points, breakdown, entryCount, xiPlayers, xiOther, trainerChips } =
    jornadaPointsFor(profile, numbers, results);
  const hasPick = matchNumbers.some((number) => {
    const pick = prediction.matchPredictions[String(number)];
    return Boolean(pick && pick.homeScore !== "" && pick.awayScore !== "");
  });
  if (!entryCount && !hasPick) return null;

  const index = scorers.findIndex(
    (scorer) => scorer.profile.id === currentUserId,
  );
  return {
    profile,
    points,
    breakdown,
    xiPlayers,
    xiOther,
    trainerChips,
    rank: index >= 0 ? index + 1 : null,
  };
}

// El desglose del once no va aqui: se pinta por futbolista (foto + nombre
// + puntos), con un chip "Tu once" residual para lo no atribuible.
const scorerBreakdownLabels: Array<{
  key: keyof ScorerBreakdown;
  label: string;
}> = [
  { key: "exact", label: "Exacto" },
  { key: "outcome", label: "Quiniela" },
];

// Cuantos puntuadores se ven antes de "Mostrar más".
const jornadaScorersCollapsed = 3;
const groupPhaseScorersCollapsed = 3;

type GroupPhaseBreakdown = {
  exactOrder: number;
  qualified: number;
  third: number;
};

type GroupPhaseScorer = {
  profile: UserProfile;
  points: number;
  breakdown: GroupPhaseBreakdown;
};

type GroupPhaseGroupReport = {
  group: string;
  table: GroupTable;
  scorers: GroupPhaseScorer[];
  totalPoints: number;
};

type GroupPhaseReport = {
  groups: GroupPhaseGroupReport[];
  topRows: GroupPhaseScorer[];
  totalPoints: number;
  totalScorers: number;
};

const groupPhaseBreakdownLabels: Array<{
  key: keyof GroupPhaseBreakdown;
  label: string;
}> = [
  { key: "exactOrder", label: "Orden" },
  { key: "qualified", label: "Clasif." },
  { key: "third", label: "3º" },
];

function emptyGroupPhaseBreakdown(): GroupPhaseBreakdown {
  return { exactOrder: 0, qualified: 0, third: 0 };
}

function cloneGroupPhaseBreakdown(
  breakdown: GroupPhaseBreakdown,
): GroupPhaseBreakdown {
  return {
    exactOrder: breakdown.exactOrder,
    qualified: breakdown.qualified,
    third: breakdown.third,
  };
}

function groupFromScoreEntry(entry: ScoreEntry) {
  const fromSource = entry.sourceRef.match(
    /^group-(?:qualified|third-qualified|position)-([A-Z])-/,
  )?.[1];
  if (fromSource) return fromSource;

  return entry.explanation.match(/grupo ([A-Z])/i)?.[1]?.toUpperCase() || "";
}

function addGroupPhaseEntry(
  breakdown: GroupPhaseBreakdown,
  entry: ScoreEntry,
) {
  if (entry.ruleCode === "group_position_hit") {
    breakdown.exactOrder += entry.points;
  } else if (entry.ruleCode === "group_qualification_hit") {
    breakdown.qualified += entry.points;
  } else if (entry.ruleCode === "group_third_qualification_hit") {
    breakdown.third += entry.points;
  }
}

function profileGroupPhasePoints(profile: UserProfile) {
  const byGroup = new Map<
    string,
    { points: number; breakdown: GroupPhaseBreakdown }
  >();
  let total = 0;
  const totalBreakdown = emptyGroupPhaseBreakdown();

  profile.scorecard.entries.forEach((entry) => {
    if (!entry.ruleCode.startsWith("group_")) return;
    const group = groupFromScoreEntry(entry);
    if (!group) return;

    const current = byGroup.get(group) || {
      points: 0,
      breakdown: emptyGroupPhaseBreakdown(),
    };
    current.points += entry.points;
    addGroupPhaseEntry(current.breakdown, entry);
    byGroup.set(group, current);

    total += entry.points;
    addGroupPhaseEntry(totalBreakdown, entry);
  });

  return { byGroup, total, totalBreakdown };
}

function sortGroupPhaseScorers(
  rows: GroupPhaseScorer[],
  leaderboardOrder: Map<string, number>,
) {
  return rows.sort(
    (a, b) =>
      b.points - a.points ||
      (leaderboardOrder.get(a.profile.id) ?? 9999) -
        (leaderboardOrder.get(b.profile.id) ?? 9999) ||
      a.profile.name.localeCompare(b.profile.name),
  );
}

function buildGroupPhaseReport(
  profiles: UserProfile[],
  results: AdminResults,
): GroupPhaseReport | null {
  const groupTables = calculateGroupTables(results);
  const groups = Object.keys(groupTables).sort((a, b) => a.localeCompare(b));

  if (!groups.length || !groups.every((group) => groupTables[group].complete)) {
    return null;
  }

  const leaderboardOrder = new Map(
    profiles.map((profile, index) => [profile.id, index]),
  );
  const perProfile = profiles.map((profile) => ({
    profile,
    ...profileGroupPhasePoints(profile),
  }));

  const topRows = sortGroupPhaseScorers(
    perProfile
      .filter((row) => row.total !== 0)
      .map((row) => ({
        profile: row.profile,
        points: row.total,
        breakdown: cloneGroupPhaseBreakdown(row.totalBreakdown),
      })),
    leaderboardOrder,
  );

  const groupReports = groups.map((group) => {
    const scorers = sortGroupPhaseScorers(
      perProfile
        .map((row) => {
          const groupPoints = row.byGroup.get(group);
          return groupPoints
            ? {
                profile: row.profile,
                points: groupPoints.points,
                breakdown: cloneGroupPhaseBreakdown(groupPoints.breakdown),
              }
            : null;
        })
        .filter((row): row is GroupPhaseScorer => Boolean(row))
        .filter((row) => row.points !== 0),
      leaderboardOrder,
    );

    return {
      group,
      table: groupTables[group],
      scorers,
      totalPoints: scorers.reduce((total, row) => total + row.points, 0),
    };
  });

  return {
    groups: groupReports,
    topRows,
    totalPoints: topRows.reduce((total, row) => total + row.points, 0),
    totalScorers: topRows.length,
  };
}

function formatSignedPoints(points: number) {
  return points > 0 ? `+${points}` : String(points);
}

function isCurrentProfile(
  profile: UserProfile,
  currentUserId: string,
  currentUserName: string,
) {
  if (profile.id === currentUserId) return true;
  return (
    Boolean(currentUserName) &&
    profile.name.trim().toLowerCase() === currentUserName.trim().toLowerCase()
  );
}

function GroupPhaseReportCard({
  currentUserId,
  currentUserName,
  report,
}: {
  currentUserId: string;
  currentUserName: string;
  report: GroupPhaseReport;
}) {
  const [topExpanded, setTopExpanded] = useState(false);
  const [reportScorer, setReportScorer] = useState<GroupPhaseScorer | null>(
    null,
  );
  const visibleTopRows = topExpanded
    ? report.topRows
    : report.topRows.slice(0, groupPhaseScorersCollapsed);
  return (
    <Card className="overflow-hidden border-[#a7f600]/20 bg-[radial-gradient(320px_at_0%_0%,rgba(167,246,0,0.12),transparent),#151515] p-0">
      <div className="border-b border-white/10 px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#a7f600]">
              Cierre de grupos
            </p>
            <h3 className="mt-1 text-xl font-bold tracking-tight text-white">
              Reporte de fase de grupos
            </h3>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-400">
              Orden real de cada grupo y puntos que ha sacado cada usuario con
              sus predicciones de clasificación.
            </p>
          </div>
          <Link
            href="/clasificacion?score=groups"
            className="inline-flex w-fit shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-bold text-white transition hover:bg-white/10"
          >
            Ver clasificación
          </Link>
        </div>

      </div>

      <div className="space-y-4 px-4 py-4 sm:px-5">
        <section className="rounded-xl border border-white/10 bg-black/15 p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-bold text-white">
                Top fase de grupos
              </h4>
              <p className="mt-0.5 text-xs text-zinc-500">
                Suma de todos los aciertos de grupos
              </p>
            </div>
            <span className="shrink-0 rounded-full border border-[#a7f600]/30 bg-[#a7f600]/10 px-2.5 py-1 text-[11px] font-bold text-[#a7f600]">
              {report.groups.length} grupos
            </span>
          </div>

          {visibleTopRows.length ? (
            <div className="space-y-2">
              {visibleTopRows.map((scorer, index) => (
                <GroupPhaseScorerRow
                  key={scorer.profile.id}
                  currentUserId={currentUserId}
                  currentUserName={currentUserName}
                  position={index + 1}
                  scorer={scorer}
                  onSelect={setReportScorer}
                />
              ))}
            </div>
          ) : (
            <p className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-zinc-500">
              Nadie ha puntuado con los grupos.
            </p>
          )}

          {report.topRows.length > groupPhaseScorersCollapsed ? (
            <button
              type="button"
              onClick={() => setTopExpanded((value) => !value)}
              aria-expanded={topExpanded}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] py-2 text-xs font-bold text-zinc-300 transition hover:bg-white/[0.06] hover:text-white"
            >
              {topExpanded
                ? "Mostrar menos"
                : `Ver ${report.topRows.length - groupPhaseScorersCollapsed} más`}
              <ChevronDownIcon
                className={`h-3.5 w-3.5 transition-transform ${
                  topExpanded ? "rotate-180" : ""
                }`}
              />
            </button>
          ) : null}
        </section>
      </div>
      {reportScorer ? (
        <GroupPhaseUserReportModal
          currentUserId={currentUserId}
          currentUserName={currentUserName}
          report={report}
          scorer={reportScorer}
          onClose={() => setReportScorer(null)}
        />
      ) : null}
    </Card>
  );
}

function GroupPhaseBreakdownChips({
  breakdown,
}: {
  breakdown: GroupPhaseBreakdown;
}) {
  const parts = groupPhaseBreakdownLabels
    .map((part) => ({
      label: part.label,
      value: breakdown[part.key],
    }))
    .filter((part) => part.value !== 0);

  if (!parts.length) return null;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {parts.map((part) => (
        <span
          key={part.label}
          className="inline-flex items-center gap-1 rounded bg-white/[0.05] px-1.5 py-0.5 text-[10px] font-medium text-zinc-400"
        >
          {part.label}
          <span className="text-white">{formatSignedPoints(part.value)}</span>
        </span>
      ))}
    </div>
  );
}

function teamFromGroupScoreEntry(entry: ScoreEntry) {
  return (
    entry.sourceRef.match(
      /^group-(?:qualified|third-qualified|position)-[A-Z]-(.+)$/,
    )?.[1] || ""
  );
}

function userGroupTeamPoints(profile: UserProfile, group: string) {
  const byTeam = new Map<
    string,
    GroupPhaseBreakdown & { total: number }
  >();

  profile.scorecard.entries.forEach((entry) => {
    if (!entry.ruleCode.startsWith("group_")) return;
    if (groupFromScoreEntry(entry) !== group) return;
    const teamId = teamFromGroupScoreEntry(entry);
    if (!teamId) return;

    const current = byTeam.get(teamId) || {
      ...emptyGroupPhaseBreakdown(),
      total: 0,
    };
    current.total += entry.points;
    addGroupPhaseEntry(current, entry);
    byTeam.set(teamId, current);
  });

  return byTeam;
}

function GroupPhaseUserReportModal({
  currentUserId,
  currentUserName,
  onClose,
  report,
  scorer,
}: {
  currentUserId: string;
  currentUserName: string;
  onClose: () => void;
  report: GroupPhaseReport;
  scorer: GroupPhaseScorer;
}) {
  const { profile } = scorer;
  const currentProfile = isCurrentProfile(
    profile,
    currentUserId,
    currentUserName,
  );
  const groupPoints = profileGroupPhasePoints(profile);
  const scoringGroups = report.groups.filter(
    (groupReport) =>
      (groupPoints.byGroup.get(groupReport.group)?.points || 0) !== 0,
  );

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="group-phase-user-report-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-full w-full max-w-md flex-col rounded-2xl border border-white/10 bg-[#151515] p-5 text-white shadow-2xl shadow-black/50">
        <div className="mb-3 flex shrink-0 items-center gap-2.5">
          <Avatar
            name={profile.name}
            avatarUrl={profile.avatarUrl}
            className="size-11 shrink-0"
          />
          <div className="min-w-0 flex-1">
            <h3
              id="group-phase-user-report-title"
              className="flex min-w-0 items-center gap-1.5 text-base font-bold tracking-tight"
            >
              <span className="truncate">{profile.name}</span>
              {profile.isPro ? <ProBadge /> : null}
              {profile.isWolf ? <WolfBadge /> : null}
              {currentProfile ? (
                <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none tracking-wide text-zinc-200">
                  Tú
                </span>
              ) : null}
            </h3>
            <p className="mt-0.5 truncate text-xs font-medium text-zinc-500">
              Puntos de fase de grupos
            </p>
          </div>
          <span
            className={`shrink-0 rounded-md px-2 py-1 text-sm font-bold ${
              scorer.points > 0
                ? "bg-[#a7f600]/15 text-[#a7f600]"
                : "bg-white/[0.06] text-zinc-300"
            }`}
          >
            {formatSignedPoints(scorer.points)}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.06] text-zinc-300 transition hover:bg-white/10 hover:text-white"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <p className="mb-2 mt-3 shrink-0 text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-500">
          Grupo a grupo
        </p>

        <div className="team-picker-scroll -mr-2 min-h-0 space-y-2 overflow-y-auto pr-2">
          {scoringGroups.map((groupReport) => (
            <GroupPhaseUserGroupCard
              key={groupReport.group}
              groupReport={groupReport}
              profile={profile}
              points={
                groupPoints.byGroup.get(groupReport.group) || {
                  points: 0,
                  breakdown: emptyGroupPhaseBreakdown(),
                }
              }
            />
          ))}
          {!scoringGroups.length ? (
            <p className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-4 text-center text-sm text-zinc-500">
              No sumó puntos en grupos.
            </p>
          ) : null}
        </div>

        <Link
          href={`/perfil/${encodeURIComponent(profile.id)}`}
          onClick={onClose}
          className="mt-3 flex shrink-0 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] py-2.5 text-sm font-bold text-white transition hover:bg-white/10"
        >
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
            <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          Ver perfil completo
        </Link>
      </div>
    </div>
  );
}

function GroupPhaseUserGroupCard({
  groupReport,
  points,
  profile,
}: {
  groupReport: GroupPhaseGroupReport;
  points: { points: number; breakdown: GroupPhaseBreakdown };
  profile: UserProfile;
}) {
  const teamPoints = userGroupTeamPoints(profile, groupReport.group);

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-bold text-white">
            Grupo {groupReport.group}
          </h4>
          <p className="mt-0.5 text-xs text-zinc-500">
            Orden final del grupo
          </p>
        </div>
        <span className="shrink-0 rounded-md bg-[#a7f600]/12 px-2 py-0.5 text-xs font-bold text-[#a7f600]">
          {formatSignedPoints(points.points)}
        </span>
      </div>

      <div className="mt-2 space-y-1.5">
        {groupReport.table.positions.map((row) => {
          const team = teamsById.get(row.teamId);
          const teamScore = teamPoints.get(row.teamId);
          const tone =
            teamScore?.exactOrder || teamScore?.third
              ? "border-[#a7f600]/30 bg-[#a7f600]/[0.06]"
              : teamScore?.qualified
                ? "border-amber-300/35 bg-amber-300/[0.07]"
                : "border-white/[0.07] bg-black/10";
          const numberTone =
            teamScore?.exactOrder || teamScore?.third
              ? "text-[#a7f600]"
              : teamScore?.qualified
                ? "text-amber-200"
                : "text-zinc-400";

          return (
            <div
              key={row.teamId}
              className={`rounded-md border px-2 py-1.5 ${tone}`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className={`w-4 shrink-0 text-xs font-bold ${numberTone}`}>
                    {row.position}
                  </span>
                  <TeamFlag
                    teamId={row.teamId}
                    className="h-5 w-5 shrink-0 rounded-full border border-white/15 object-cover"
                  />
                  <span className="min-w-0 truncate text-sm font-semibold text-white">
                    {team?.name || row.teamId}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GroupPhaseScorerRow({
  compact = false,
  currentUserId,
  currentUserName,
  onSelect,
  position,
  scorer,
}: {
  compact?: boolean;
  currentUserId: string;
  currentUserName: string;
  onSelect: (scorer: GroupPhaseScorer) => void;
  position: number;
  scorer: GroupPhaseScorer;
}) {
  const { breakdown, points, profile } = scorer;
  const currentProfile = isCurrentProfile(
    profile,
    currentUserId,
    currentUserName,
  );

  return (
    <button
      type="button"
      onClick={() => onSelect(scorer)}
      className="-mx-2 flex w-[calc(100%+1rem)] items-start justify-between gap-3 rounded-lg px-2 py-1.5 text-left transition hover:bg-white/[0.04]"
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <span
          className={`mt-0.5 flex shrink-0 items-center justify-center rounded-md bg-white/[0.05] font-bold text-zinc-300 ${
            compact ? "h-7 w-6 text-xs" : "h-8 w-7 text-sm"
          }`}
          aria-label={`Puesto ${position}`}
        >
          <RankNumber position={position} />
        </span>
        <Avatar
          name={profile.name}
          avatarUrl={profile.avatarUrl}
          className={compact ? "size-8" : "size-9"}
        />
        <div className="min-w-0">
          <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-white">
            <span className="truncate">{profile.name}</span>
            {profile.isPro ? <ProBadge /> : null}
            {profile.isWolf ? <WolfBadge /> : null}
            {currentProfile ? (
              <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none tracking-wide text-zinc-200">
                Tú
              </span>
            ) : null}
          </p>
          <GroupPhaseBreakdownChips breakdown={breakdown} />
        </div>
      </div>
      <span
        title="Puntos de fase de grupos"
        className={`mt-0.5 shrink-0 rounded-md px-2 py-0.5 text-xs font-bold tabular-nums ${
          points > 0
            ? "bg-[#a7f600]/12 text-[#a7f600]"
            : "bg-white/[0.06] text-zinc-400"
        }`}
      >
        {formatSignedPoints(points)}
      </span>
    </button>
  );
}

function ChevronDownIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2.2"
    >
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

function HomeFeedSection({
  currentUserId,
  currentUserName,
  hasUser,
  leaderboard,
  nextMatchdayKey,
  onScoreChange,
  onTrainerChipOpen,
  prediction,
  ready,
  results,
  saveState,
  upcomingMatches,
}: {
  currentUserId: string;
  currentUserName: string;
  hasUser: boolean;
  leaderboard: UserProfile[];
  nextMatchdayKey: string;
  onScoreChange: (
    matchNumber: number,
    side: "homeScore" | "awayScore",
    value: string,
  ) => void;
  onTrainerChipOpen?: (matchNumber: number) => void;
  prediction: Prediction;
  ready: boolean;
  results: AdminResults;
  saveState: HomeSaveState | null;
  upcomingMatches: Match[];
}) {
  const jornadas = useMemo(() => buildJornadas(results), [results]);
  const groupPhaseReport = useMemo(
    () =>
      showHomeGroupPhaseReport
        ? buildGroupPhaseReport(leaderboard, results)
        : null,
    [leaderboard, results],
  );
  const mobileOpenJornadaDate =
    jornadas.find((jornada) =>
      jornada.matches.some((item) => item.status === "live"),
    )?.date ||
    jornadas[0]?.date ||
    "";
  const hasContent =
    upcomingMatches.length > 0 || Boolean(groupPhaseReport) || jornadas.length > 0;
  const matchesHref = upcomingMatches.some(isTrainerChipMatch)
    ? "/porra?section=playoffResults&goto=next"
    : "/porra?section=results&goto=next";

  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white">
            Novedades
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Tus próximos partidos y los resultados de cada jornada
          </p>
        </div>
        <Link
          href={matchesHref}
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
              onTrainerChipOpen={onTrainerChipOpen}
              prediction={prediction}
              results={results}
              saveState={saveState}
            />
          ) : null}
          {groupPhaseReport ? (
            <GroupPhaseReportCard
              currentUserId={currentUserId}
              currentUserName={currentUserName}
              report={groupPhaseReport}
            />
          ) : null}
          {jornadas.map((jornada) => {
            const scorers = jornadaScorers(
              leaderboard,
              jornada.matchNumbers,
              results,
            );
            return (
              <JornadaCard
                key={`${jornada.date}-${
                  jornada.date === mobileOpenJornadaDate ? "open" : "closed"
                }`}
                jornada={jornada}
                scorers={scorers}
                currentUserId={currentUserId}
                defaultOpenMobile={jornada.date === mobileOpenJornadaDate}
                standings={jornadaGeneralStandings(leaderboard, jornada.date)}
                userSummary={jornadaUserSummary(
                  leaderboard,
                  currentUserId,
                  prediction,
                  jornada.matchNumbers,
                  scorers,
                  results,
                )}
              />
            );
          })}
        </div>
      ) : (
        <Card className="px-4 py-10 text-center text-sm leading-6 text-zinc-400">
          <p className="font-semibold text-white">
            Aún no hay nada que contar.
          </p>
          <p className="mt-1">
            En cuanto haya partidos verás aquí tus próximos encuentros y los
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
  onTrainerChipOpen,
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
  onTrainerChipOpen?: (matchNumber: number) => void;
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
            <h3 className="text-sm font-bold text-white">Próxima jornada</h3>
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
            onTrainerChipOpen={onTrainerChipOpen}
          />
        ))}
      </div>
    </div>
  );
}

function JornadaCard({
  currentUserId,
  defaultOpenMobile,
  jornada,
  scorers,
  standings,
  userSummary,
}: {
  currentUserId: string;
  defaultOpenMobile: boolean;
  jornada: Jornada;
  scorers: JornadaScorer[];
  standings: Map<string, JornadaGeneralStanding>;
  userSummary: JornadaUserSummary | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(defaultOpenMobile);
  const [picksMatch, setPicksMatch] = useState<JornadaMatch | null>(null);
  const [reportScorer, setReportScorer] = useState<{
    profile: UserProfile;
    points: number;
  } | null>(null);
  const visibleScorers = expanded
    ? scorers
    : scorers.slice(0, jornadaScorersCollapsed);
  const hasLiveMatch = jornada.matches.some((item) => item.status === "live");

  return (
    <Card className="overflow-hidden p-0">
      <div className="hidden border-b border-white/10 px-4 py-3 sm:block">
        <h3 className="truncate text-sm font-bold text-white first-letter:capitalize">
          {formatDate(jornada.date)}
        </h3>
      </div>

      <button
        type="button"
        onClick={() => setMobileOpen((value) => !value)}
        aria-expanded={mobileOpen}
        className="flex w-full items-center justify-between gap-3 border-b border-white/10 px-4 py-3 text-left transition hover:bg-white/[0.03] sm:hidden"
      >
        <span className="flex min-w-0 items-center gap-2">
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className={`h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform ${
              mobileOpen ? "rotate-90" : ""
            }`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M6 4l4 4-4 4" />
          </svg>
          <span className="min-w-0 truncate text-sm font-bold text-white first-letter:capitalize">
            {formatDate(jornada.date)}
          </span>
          <span className="shrink-0 text-xs font-medium text-zinc-500">
            &middot; {jornada.matches.length}
          </span>
        </span>
        {hasLiveMatch ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-rose-400/25 bg-rose-400/10 px-2 py-0.5 text-[11px] font-bold text-rose-200">
            <span className="h-1.5 w-1.5 rounded-full bg-rose-400 animate-pulse" />
            En juego
          </span>
        ) : null}
      </button>

      <div className={mobileOpen ? "block" : "hidden sm:block"}>
        <div className="divide-y divide-white/10">
          {jornada.matches.map((item) => (
            <JornadaMatchRow
              key={item.match.number}
              item={item}
              onShowPicks={() => setPicksMatch(item)}
            />
          ))}
        </div>

        {scorers.length || userSummary ? (
          <div className="border-t border-white/10 bg-white/[0.015] px-4 py-3">
            {userSummary ? (
              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-500">
                    Tu jornada
                  </p>
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-600">
                    General · pts
                  </p>
                </div>
                <JornadaScorerRow
                  scorer={{
                    profile: userSummary.profile,
                    points: userSummary.points,
                    breakdown: userSummary.breakdown,
                    xiPlayers: userSummary.xiPlayers,
                    xiOther: userSummary.xiOther,
                    trainerChips: userSummary.trainerChips,
                  }}
                  position={userSummary.rank}
                  isCurrentUser
                  general={standings.get(userSummary.profile.id)}
                  onSelect={(profile, points) =>
                    setReportScorer({ profile, points })
                  }
                />
              </div>
            ) : null}

            {scorers.length ? (
              <div
                className={
                  userSummary ? "mt-3 border-t border-white/[0.07] pt-3" : ""
                }
              >
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-500">
                    Han puntuado{" "}
                    <span className="text-zinc-400">· {scorers.length}</span>
                  </p>
                  {!userSummary ? (
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-600">
                      General · pts
                    </p>
                  ) : null}
                </div>
                <div className="space-y-2.5">
                  {visibleScorers.map((scorer, index) => (
                    <JornadaScorerRow
                      key={scorer.profile.id}
                      scorer={scorer}
                      position={index + 1}
                      isCurrentUser={scorer.profile.id === currentUserId}
                      general={standings.get(scorer.profile.id)}
                      onSelect={(profile, points) =>
                        setReportScorer({ profile, points })
                      }
                    />
                  ))}
                </div>
              </div>
            ) : null}

            {scorers.length > jornadaScorersCollapsed ? (
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                aria-expanded={expanded}
                className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] py-2 text-xs font-bold text-zinc-300 transition hover:bg-white/[0.06] hover:text-white"
              >
                {expanded
                  ? "Mostrar menos"
                  : `Ver ${scorers.length - jornadaScorersCollapsed} más`}
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
      </div>

      {picksMatch ? (
        <MatchPicksModal
          item={picksMatch}
          onClose={() => setPicksMatch(null)}
        />
      ) : null}

      {reportScorer ? (
        <JornadaUserReportModal
          profile={reportScorer.profile}
          jornadaPoints={reportScorer.points}
          jornada={jornada}
          general={standings.get(reportScorer.profile.id)}
          isCurrentUser={reportScorer.profile.id === currentUserId}
          onClose={() => setReportScorer(null)}
        />
      ) : null}
    </Card>
  );
}

function JornadaScorerRow({
  general,
  isCurrentUser,
  onSelect,
  position,
  scorer,
}: {
  general?: JornadaGeneralStanding;
  isCurrentUser: boolean;
  onSelect: (profile: UserProfile, points: number) => void;
  position: number | null;
  scorer: JornadaScorer;
}) {
  const { breakdown, points, profile } = scorer;
  const parts = scorerBreakdownLabels
    .map((part) => ({
      label: part.label,
      value: breakdown[part.key],
    }))
    .filter((part) => part.value !== 0);
  const xiChips = scorer.xiPlayers.flatMap((row) => {
    const player = playersById.get(row.playerId);
    return player ? [{ player, points: row.points }] : [];
  });
  // Lo que no se pudo atribuir a un futbolista concreto mantiene el total.
  const xiRest =
    breakdown.xi - xiChips.reduce((total, chip) => total + chip.points, 0);
  const hasChips =
    parts.length > 0 ||
    xiChips.length > 0 ||
    xiRest !== 0 ||
    scorer.trainerChips.length > 0;

  return (
    <button
      type="button"
      onClick={() => onSelect(profile, points)}
      className="-mx-2 flex w-[calc(100%+1rem)] items-start justify-between gap-3 rounded-lg px-2 py-1 text-left transition hover:bg-white/[0.04]"
    >
      <div className="flex min-w-0 items-start gap-2.5">
        {position === null ? (
          <span
            className="mt-0.5 flex h-8 w-7 shrink-0 items-center justify-center rounded-md bg-white/[0.04] text-xs font-bold text-zinc-600"
            aria-label="Sin puntos"
          >
            –
          </span>
        ) : position <= 3 ? (
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
            {isCurrentUser ? (
              <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none tracking-wide text-zinc-200">
                Tú
              </span>
            ) : null}
          </p>
          {hasChips ? (
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {parts.map((part) => (
                <span
                  key={part.label}
                  className="inline-flex items-center gap-1 rounded bg-white/[0.05] px-1.5 py-0.5 text-[10px] font-medium text-zinc-400"
                >
                  {part.label}
                  <span
                    className={part.value >= 0 ? "text-white" : "text-red-400"}
                  >
                    {part.value > 0 ? `+${part.value}` : part.value}
                  </span>
                </span>
              ))}
              {xiChips.map(({ player, points: playerPoints }) => (
                <span
                  key={player.id}
                  className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.05] py-px pl-px pr-1.5 text-[10px] font-medium text-zinc-400"
                >
                  <PlayerAvatar
                    player={player}
                    className="size-4! text-[6px]"
                  />
                  {player.name}
                  <span
                    className={
                      playerPoints >= 0 ? "text-white" : "text-red-400"
                    }
                  >
                    {playerPoints > 0 ? `+${playerPoints}` : playerPoints}
                  </span>
                </span>
              ))}
              {xiRest !== 0 ? (
                <span className="inline-flex items-center gap-1 rounded bg-white/[0.05] px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
                  Tu once
                  <span className={xiRest >= 0 ? "text-white" : "text-red-400"}>
                    {xiRest > 0 ? `+${xiRest}` : xiRest}
                  </span>
                </span>
              ) : null}
              {scorer.trainerChips.map((chip) => (
                <TrainerChipScorePill
                  key={`${chip.teamId}-${chip.tacticId}`}
                  chip={chip}
                />
              ))}
            </div>
          ) : isCurrentUser ? (
            <p className="mt-1 text-[11px] font-medium text-zinc-500">
              Sin puntos en esta jornada.
            </p>
          ) : null}
        </div>
      </div>
      <div className="mt-0.5 flex shrink-0 items-center gap-1.5">
        {general ? (
          <span
            title="Clasificación general tras la jornada"
            className="flex items-center gap-1 rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[11px] font-semibold text-zinc-300"
          >
            {general.rank}º
            {general.move ? (
              <span
                className={`text-[10px] font-bold ${
                  general.move > 0 ? "text-[#a7f600]" : "text-rose-300"
                }`}
              >
                {general.move > 0
                  ? `▲${general.move}`
                  : `▼${Math.abs(general.move)}`}
              </span>
            ) : null}
          </span>
        ) : null}
        <span
          title="Puntos de la jornada"
          className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
            points > 0
              ? "bg-[#a7f600]/12 text-[#a7f600]"
              : points < 0
                ? "bg-rose-400/12 text-rose-300"
                : "bg-white/[0.06] text-zinc-400"
          }`}
        >
          {points > 0 ? `+${points}` : points}
        </span>
      </div>
    </button>
  );
}

// Reporte de un usuario en una jornada: cabecera con su foto, puntos y
// movimiento en la general, y debajo el desglose partido a partido.
function JornadaUserReportModal({
  general,
  isCurrentUser,
  jornada,
  jornadaPoints,
  onClose,
  profile,
}: {
  general?: JornadaGeneralStanding;
  isCurrentUser: boolean;
  jornada: Jornada;
  jornadaPoints: number;
  onClose: () => void;
  profile: UserProfile;
}) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="user-report-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-full w-full max-w-md flex-col rounded-2xl border border-white/10 bg-[#151515] p-5 text-white shadow-2xl shadow-black/50">
        <div className="mb-3 flex shrink-0 items-center gap-2.5">
          <Avatar
            name={profile.name}
            avatarUrl={profile.avatarUrl}
            className="size-11 shrink-0"
          />
          <div className="min-w-0 flex-1">
            <h3
              id="user-report-title"
              className="flex min-w-0 items-center gap-1.5 text-base font-bold tracking-tight"
            >
              <span className="truncate">{profile.name}</span>
              {profile.isPro ? <ProBadge /> : null}
              {profile.isWolf ? <WolfBadge /> : null}
              {isCurrentUser ? (
                <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none tracking-wide text-zinc-200">
                  Tú
                </span>
              ) : null}
            </h3>
            <p className="mt-0.5 truncate text-xs font-medium text-zinc-500 first-letter:capitalize">
              {formatDate(jornada.date)}
            </p>
          </div>
          {general ? (
            <span
              title="Clasificación general tras la jornada"
              className="flex shrink-0 items-center gap-1 rounded-md bg-white/[0.06] px-1.5 py-1 text-[11px] font-semibold text-zinc-300"
            >
              {general.rank}º
              {general.move ? (
                <span
                  className={`text-[10px] font-bold ${
                    general.move > 0 ? "text-[#a7f600]" : "text-rose-300"
                  }`}
                >
                  {general.move > 0
                    ? `▲${general.move}`
                    : `▼${Math.abs(general.move)}`}
                </span>
              ) : null}
            </span>
          ) : null}
          <span
            className={`shrink-0 rounded-md px-2 py-1 text-sm font-bold ${
              jornadaPoints > 0
                ? "bg-[#a7f600]/15 text-[#a7f600]"
                : jornadaPoints < 0
                  ? "bg-rose-400/15 text-rose-300"
                  : "bg-white/[0.06] text-zinc-300"
            }`}
          >
            {jornadaPoints > 0 ? `+${jornadaPoints}` : jornadaPoints}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.06] text-zinc-300 transition hover:bg-white/10 hover:text-white"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <p className="mb-2 shrink-0 text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-500">
          Partido a partido
        </p>

        <div className="team-picker-scroll -mr-2 min-h-0 space-y-1.5 overflow-y-auto pr-2">
          {jornada.matches.map((item) => (
            <UserReportMatchRow
              key={item.match.number}
              item={item}
              profile={profile}
            />
          ))}
        </div>

        <Link
          href={`/perfil/${encodeURIComponent(profile.id)}`}
          className="mt-3 flex shrink-0 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] py-2.5 text-sm font-bold text-white transition hover:bg-white/10"
        >
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
            <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          Ver perfil completo
        </Link>
      </div>
    </div>
  );
}

function UserReportMatchRow({
  item,
  profile,
}: {
  item: JornadaMatch;
  profile: UserProfile;
}) {
  const { match, result } = item;
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
  const finished =
    Boolean(result) && isFinishedResult(result) && hasFinishedScore(result);
  const pick = profile.prediction?.matchPredictions?.[String(match.number)];
  const hasPick = Boolean(
    pick && pick.homeScore !== "" && pick.awayScore !== "",
  );

  // El chip de prediccion se colorea contra el resultado final, igual que en
  // el modal del ojo: exacto relleno, ganador con borde, fallo apagado.
  let pickClass = "border border-white/10 bg-white/[0.03] text-zinc-600";
  if (hasPick && pick) {
    if (!finished || !score) {
      pickClass = "border border-white/10 bg-white/[0.06] text-white";
    } else {
      const pickHome = Number(pick.homeScore);
      const pickAway = Number(pick.awayScore);
      const finalHome = Number(score.home);
      const finalAway = Number(score.away);
      if (pickHome === finalHome && pickAway === finalAway) {
        pickClass = "border border-[#a7f600]/35 bg-[#a7f600]/15 text-[#a7f600]";
      } else if (
        matchOutcomeOf(pickHome, pickAway) ===
        matchOutcomeOf(finalHome, finalAway)
      ) {
        pickClass = "border border-[#a7f600]/30 bg-white/[0.06] text-white";
      } else {
        pickClass = "border border-white/10 bg-white/[0.06] text-zinc-500";
      }
    }
  }

  const report = userMatchReport(profile, match.number, result);
  const xiChips = report.xiPlayers.flatMap((row) => {
    const player = playersById.get(row.playerId);
    return player ? [{ player, points: row.points }] : [];
  });

  return (
    <div className="rounded-lg bg-white/[0.03] px-2.5 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <TeamFlag
            teamId={homeTeamId}
            className="h-5 w-5 shrink-0 rounded-full border border-white/15 object-cover"
          />
          <span className="shrink-0 rounded-md bg-white/[0.07] px-1.5 py-0.5 text-xs font-bold tabular-nums text-white">
            {score ? `${score.home}-${score.away}` : "–-–"}
          </span>
          <TeamFlag
            teamId={awayTeamId}
            className="h-5 w-5 shrink-0 rounded-full border border-white/15 object-cover"
          />
          <span className="min-w-0 truncate text-sm font-medium text-white">
            {homeName} · {awayName}
          </span>
        </div>
        <span
          className={`inline-flex w-[2.5rem] shrink-0 justify-end text-sm font-bold tabular-nums ${
            report.total > 0
              ? "text-[#a7f600]"
              : report.total < 0
                ? "text-rose-300"
                : "text-zinc-600"
          }`}
        >
          {report.total > 0 ? `+${report.total}` : report.total}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1">
        <span
          title="Su predicción"
          className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${pickClass}`}
        >
          {hasPick && pick ? `${pick.homeScore}-${pick.awayScore}` : "–-–"}
        </span>
        {xiChips.map(({ player, points: playerPoints }) => (
          <span
            key={player.id}
            className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.05] py-px pl-px pr-1.5 text-[10px] font-medium text-zinc-400"
          >
            <PlayerAvatar player={player} className="size-4! text-[6px]" />
            {player.name}
            <span className={playerPoints >= 0 ? "text-white" : "text-red-400"}>
              {playerPoints > 0 ? `+${playerPoints}` : playerPoints}
            </span>
          </span>
        ))}
        {report.xiOther !== 0 ? (
          <span className="inline-flex items-center gap-1 rounded bg-white/[0.05] px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
            Tu once
            <span
              className={report.xiOther >= 0 ? "text-white" : "text-red-400"}
            >
              {report.xiOther > 0 ? `+${report.xiOther}` : report.xiOther}
            </span>
          </span>
        ) : null}
        {report.trainerChips.map((chip) => (
          <TrainerChipScorePill
            key={`${chip.teamId}-${chip.tacticId}`}
            chip={chip}
          />
        ))}
      </div>
    </div>
  );
}

function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function matchOutcomeOf(home: number, away: number) {
  return home > away ? "home" : home < away ? "away" : "draw";
}

// Desglose de un usuario en un partido concreto: cuanto saco y de que.
function userMatchReport(
  profile: UserProfile,
  matchNumber: number,
  result: AdminResult | undefined,
) {
  const eventPlayerById = new Map<string, string>();
  (result?.events || []).forEach((event) => {
    if (event.id && event.playerId) {
      eventPlayerById.set(event.id, event.playerId);
    }
  });

  let total = 0;
  let exact = 0;
  let outcome = 0;
  const xiByPlayer = new Map<string, number>();
  let xiOther = 0;
  const trainerByChip = new Map<string, TrainerChipPoints>();
  profile.scorecard.entries.forEach((entry) => {
    if (entry.matchNumber !== matchNumber) return;
    total += entry.points;
    if (entry.ruleCode === "match_exact_score") {
      exact += entry.points;
    } else if (entry.ruleCode === "match_outcome_hit") {
      outcome += entry.points;
    } else if (entry.ruleCode.startsWith("player_")) {
      const playerId = eventPlayerById.get(entry.sourceRef);
      if (playerId) {
        xiByPlayer.set(
          playerId,
          (xiByPlayer.get(playerId) || 0) + entry.points,
        );
      } else {
        xiOther += entry.points;
      }
    } else if (entry.ruleCode === "trainer_tactic_hit") {
      const chip = trainerChipFromScoreEntry(entry);
      if (chip) addTrainerChipPoints(trainerByChip, chip);
    }
  });
  const xiPlayers = [...xiByPlayer.entries()]
    .map(([playerId, points]) => ({ playerId, points }))
    .sort((a, b) => b.points - a.points);
  return {
    total,
    exact,
    outcome,
    xiPlayers,
    xiOther,
    trainerChips: sortTrainerChips(trainerByChip),
  };
}

// Con el partido empezado las predicciones ya estan congeladas, asi que se
// pueden destapar. En los terminados, ademas, se comparan con el resultado
// final: exacto en lime relleno, ganador acertado con borde, fallo apagado.
function MatchPicksModal({
  item,
  onClose,
}: {
  item: JornadaMatch;
  onClose: () => void;
}) {
  const { leaderboard, user } = useAppContext();
  const [query, setQuery] = useState("");
  const [wolfOnly, setWolfOnly] = useState(false);
  const { match, result, status } = item;
  const finalScore =
    result && isFinishedResult(result) && hasFinishedScore(result)
      ? readMatchScore(result)
      : null;

  const pickChipClass = (pick: {
    homeScore: string | number;
    awayScore: string | number;
  }) => {
    if (!finalScore) {
      return "border border-white/10 bg-white/[0.06] text-white";
    }
    const pickHome = Number(pick.homeScore);
    const pickAway = Number(pick.awayScore);
    const finalHome = Number(finalScore.home);
    const finalAway = Number(finalScore.away);
    if (pickHome === finalHome && pickAway === finalAway) {
      return "border border-[#a7f600]/35 bg-[#a7f600]/15 text-[#a7f600]";
    }
    if (
      matchOutcomeOf(pickHome, pickAway) ===
      matchOutcomeOf(finalHome, finalAway)
    ) {
      return "border border-[#a7f600]/30 bg-white/[0.06] text-white";
    }
    return "border border-white/10 bg-white/[0.06] text-zinc-500";
  };
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

  const rows = leaderboard
    .filter((profile) => !profile.isHidden)
    .map((profile) => {
      const pick = profile.prediction?.matchPredictions?.[String(match.number)];
      const hasPick = Boolean(
        pick && pick.homeScore !== "" && pick.awayScore !== "",
      );
      const xiPlayers = (profile.prediction?.xi || [])
        .map((playerId) => playersById.get(playerId))
        .filter(
          (player): player is NonNullable<typeof player> =>
            Boolean(player) &&
            (player?.team === homeTeamId || player?.team === awayTeamId),
        );
      // Solo en finalizados hay puntos: total del partido (resultado + once)
      // y que futbolistas del once aportaron.
      const report = finalScore
        ? userMatchReport(profile, match.number, result)
        : null;
      const scoringPlayerIds = new Set(
        (report?.xiPlayers || [])
          .filter((row) => row.points > 0)
          .map((row) => row.playerId),
      );
      return {
        profile,
        pick: hasPick && pick ? pick : null,
        trainerPick:
          match.number >= 73 && pick?.trainerTeamId && pick.tacticId
            ? {
                tacticId: pick.tacticId,
                teamId: pick.trainerTeamId,
              }
            : null,
        xiPlayers,
        matchPoints: report ? report.total : null,
        scoringPlayerIds,
        trainerChips: report?.trainerChips || [],
      };
    })
    .filter(
      (row) =>
        row.pick ||
        row.trainerPick ||
        row.xiPlayers.length ||
        row.trainerChips.length,
    );

  // Orden por clasificacion general (el de `leaderboard`): el buscador ya
  // cubre encontrar a alguien concreto.
  const normalizedQuery = normalizeSearchText(query.trim());
  const filteredRows = rows
    .filter((row) => !wolfOnly || row.profile.isWolf)
    .filter(
      (row) =>
        !normalizedQuery ||
        normalizeSearchText(row.profile.name).includes(normalizedQuery),
    );

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="match-picks-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-full w-full max-w-md flex-col rounded-2xl border border-white/10 bg-[#151515] p-5 text-white shadow-2xl shadow-black/50">
        <div className="mb-3 flex shrink-0 items-start justify-between gap-3">
          <div className="min-w-0">
            {status === "live" ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-400/25 bg-rose-400/10 px-2 py-0.5 text-[11px] font-bold text-rose-200">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-400" />
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
            <h3
              id="match-picks-title"
              className="mt-2 flex min-w-0 items-center gap-2 text-base font-bold tracking-tight sm:text-lg"
            >
              <TeamFlag
                teamId={homeTeamId}
                className="h-5 w-5 shrink-0 rounded-full border border-white/15 object-cover"
              />
              <span className="min-w-0 truncate">
                {homeName} · {awayName}
              </span>
              <TeamFlag
                teamId={awayTeamId}
                className="h-5 w-5 shrink-0 rounded-full border border-white/15 object-cover"
              />
            </h3>
            {finalScore ? (
              <p className="mt-1.5 text-sm font-semibold text-zinc-300">
                Resultado:{" "}
                <span className="rounded-md bg-white/[0.08] px-2 py-0.5 font-bold tabular-nums text-white">
                  {finalScore.home} - {finalScore.away}
                </span>
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.06] text-zinc-300 transition hover:bg-white/10 hover:text-white"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="mb-2 flex shrink-0 items-center gap-2">
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-2">
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="h-4 w-4 shrink-0 text-zinc-500"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar por nombre"
              className="min-w-0 flex-1 bg-transparent text-sm font-medium text-white outline-none placeholder:text-zinc-600"
            />
          </label>
          {user?.isWolf ? (
            <div className="inline-flex shrink-0 rounded-xl border border-white/10 bg-white/[0.04] p-0.5">
              <button
                type="button"
                onClick={() => setWolfOnly(false)}
                aria-pressed={!wolfOnly}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-bold transition ${
                  !wolfOnly
                    ? "bg-zinc-200 text-zinc-900"
                    : "text-zinc-300 hover:bg-white/[0.06] hover:text-white"
                }`}
              >
                Todos
              </button>
              <button
                type="button"
                onClick={() => setWolfOnly(true)}
                aria-pressed={wolfOnly}
                aria-label="Solo manada"
                title="Solo manada"
                className={`rounded-lg px-2.5 py-1.5 text-xs font-bold transition ${
                  wolfOnly
                    ? "bg-zinc-100 text-zinc-900"
                    : "text-zinc-300 hover:bg-white/[0.06] hover:text-white"
                }`}
              >
                🐺
              </button>
            </div>
          ) : null}
        </div>

        <div className="team-picker-scroll -mr-2 min-h-0 space-y-1.5 overflow-y-auto pr-2">
          {filteredRows.map(
            ({
              matchPoints,
              pick,
              profile,
              scoringPlayerIds,
              trainerChips,
              trainerPick,
              xiPlayers,
            }) => (
              <Link
                key={profile.id}
                href={`/perfil/${encodeURIComponent(profile.id)}`}
                onClick={onClose}
                className="flex items-center justify-between gap-3 rounded-lg bg-white/[0.03] px-2.5 py-2 transition hover:bg-white/[0.06]"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <Avatar
                    name={profile.name}
                    avatarUrl={profile.avatarUrl}
                    className="size-8"
                  />
                  <div className="min-w-0">
                    <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-white">
                      <span className="truncate">{profile.name}</span>
                      {profile.id === user?.id ? (
                        <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none tracking-wide text-zinc-200">
                          Tú
                        </span>
                      ) : null}
                    </p>
                    {xiPlayers.length || trainerChips.length || trainerPick ? (
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {xiPlayers.map((player) => {
                          const scored = scoringPlayerIds.has(player.id);
                          return (
                            <span
                              key={player.id}
                              className={`inline-flex items-center gap-1 rounded-full border py-px pl-px pr-1.5 text-[10px] font-medium ${
                                scored
                                  ? "border-[#a7f600]/40 bg-[#a7f600]/15 text-[#a7f600]"
                                  : "border-white/10 bg-white/[0.05] text-zinc-300"
                              }`}
                            >
                              <PlayerAvatar
                                player={player}
                                className="size-4! text-[6px]"
                              />
                              {player.name}
                            </span>
                          );
                        })}
                        {trainerChips.length ? (
                          trainerChips.map((chip) => (
                            <TrainerChipScorePill
                              key={`${chip.teamId}-${chip.tacticId}`}
                              chip={chip}
                            />
                          ))
                        ) : trainerPick ? (
                          <TrainerChipPickPill
                            tacticId={trainerPick.tacticId}
                            teamId={trainerPick.teamId}
                          />
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    title="Su predicción"
                    className={`inline-flex w-[3.25rem] justify-center rounded-md py-1 text-sm font-bold tabular-nums ${
                      pick
                        ? pickChipClass(pick)
                        : "border border-white/10 bg-white/[0.03] text-zinc-600"
                    }`}
                  >
                    {pick ? `${pick.homeScore}-${pick.awayScore}` : "–-–"}
                  </span>
                  {matchPoints !== null ? (
                    <span
                      title="Puntos en este partido"
                      className={`inline-flex w-[2.5rem] justify-end text-sm font-bold tabular-nums ${
                        matchPoints > 0
                          ? "text-[#a7f600]"
                          : matchPoints < 0
                            ? "text-rose-300"
                            : "text-zinc-600"
                      }`}
                    >
                      {matchPoints > 0 ? `+${matchPoints}` : matchPoints}
                    </span>
                  ) : null}
                </div>
              </Link>
            ),
          )}
          {!rows.length ? (
            <p className="py-4 text-center text-sm text-zinc-500">
              Nadie ha pronosticado este partido.
            </p>
          ) : !filteredRows.length ? (
            <p className="py-4 text-center text-sm text-zinc-500">
              Nadie se llama así en la porra.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function JornadaMatchRow({
  item,
  onShowPicks,
}: {
  item: JornadaMatch;
  onShowPicks?: () => void;
}) {
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
  const shootoutScore = calculateShootoutScore(result, homeTeamId, awayTeamId);
  const hasShootout = shootoutScore.home > 0 || shootoutScore.away > 0;
  const events = (result?.events || [])
    .filter((event) => event.playerId && matchEventIcons[String(event.type)])
    .sort((a, b) => (Number(a.minute) || 0) - (Number(b.minute) || 0));
  const homeEvents = events.filter(
    (event) => matchEventTeamId(event) !== awayTeamId,
  );
  const awayEvents = events.filter(
    (event) => matchEventTeamId(event) === awayTeamId,
  );
  const trainerTactics = matchTrainerTacticLines(result);
  const homeTrainerTactics = trainerTactics.filter(
    (chip) => chip.teamId !== awayTeamId,
  );
  const awayTrainerTactics = trainerTactics.filter(
    (chip) => chip.teamId === awayTeamId,
  );
  const hasEventRows = events.length > 0 || trainerTactics.length > 0;

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
        <span className="flex shrink-0 flex-col items-center gap-0.5">
          <span
            className={`rounded-lg px-3 py-1 text-lg font-bold tabular-nums tracking-wide sm:px-3.5 sm:text-xl ${
            score
              ? "bg-white/[0.08] text-white"
              : "bg-white/[0.04] text-zinc-500"
          }`}
        >
          {score ? `${score.home} - ${score.away}` : "– - –"}
          </span>
          {hasShootout ? (
            <span className="text-[11px] font-bold tabular-nums text-zinc-400">
              ({shootoutScore.home}-{shootoutScore.away})
            </span>
          ) : null}
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
        <div className="ml-1 flex w-[128px] shrink-0 items-center justify-end gap-1.5">
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
          {onShowPicks ? (
            <button
              type="button"
              onClick={onShowPicks}
              aria-label="Ver las predicciones de este partido"
              title="Predicciones"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/[0.06] text-zinc-300 transition hover:bg-white/10 hover:text-white"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z" />
                <circle cx="12" cy="12" r="2.6" />
              </svg>
            </button>
          ) : null}
        </div>
      </div>

      {hasEventRows ? (
        <div className="mt-2.5 grid grid-cols-2 gap-x-4 border-t border-white/[0.06] pt-2.5">
          <div className="space-y-1">
            {homeEvents.map((event, index) => (
              <MatchEventLine key={event.id || `h${index}`} event={event} />
            ))}
            {homeTrainerTactics.map((chip) => (
              <TrainerTacticEventLine
                key={`${chip.teamId}-${chip.tacticId}`}
                chip={chip}
              />
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
            {awayTrainerTactics.map((chip) => (
              <TrainerTacticEventLine
                key={`${chip.teamId}-${chip.tacticId}`}
                chip={chip}
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
  const predictionHref = matches.some(isTrainerChipMatch)
    ? "/porra?section=playoffResults&goto=next"
    : "/porra?section=results&goto=next";

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
            href={predictionHref}
            prefetch={false}
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

// Cuenta atrás hasta el próximo sobre diario (10:00 Madrid), en cajas estilo HUD
// (HH : MM : SS).
function NextSobreCountdown() {
  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setRemaining(secondsUntilNextDailyCard());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);
  // Borde inline: globals.css tiene un `* { border-color }` global (sin capa)
  // que pisa las utilidades de color de borde de Tailwind; inline sí gana.
  return (
    <span className="text-base font-bold leading-none text-white tabular-nums sm:text-lg">
      {remaining == null ? "--:--:--" : formatCountdownHMS(remaining)}
    </span>
  );
}

// Banner principal de playoffs en la home.
// titular a dos tonos, cuenta atrás segmentada hasta las 10:00, pill con los
// sobres sin abrir, y los 3 sobres reales (estrellas · diario · promesas) en
// abanico. Va en la columna de Novedades.
const playoffBannerTrainerIds = [
  "francia-deschamps",
  "espana-de-la-fuente",
  "brasil-ancelotti",
] as const;

const playoffBannerTrainers = playoffBannerTrainerIds
  .map((id) => trainerDemoCards.find((card) => card.id === id))
  .filter((card): card is TrainerDemoCard => Boolean(card));

const playoffBannerChips = [
  {
    id: "clean-sheet",
    points: 2,
    color: "#69d744",
    icon: "/prediction-icons/clean-sheet.png",
  },
  {
    id: "first-goal",
    points: 1,
    color: "#d946ef",
    icon: "/prediction-icons/first-goal.png",
  },
  {
    id: "set-piece",
    points: 3,
    color: "#38bdf8",
    icon: "/prediction-icons/set-piece.png",
  },
  {
    id: "red-card",
    points: 5,
    color: "#ff4d2d",
    icon: "/prediction-icons/red-card.png",
  },
] as const;

function PlayoffsPromoBanner() {
  return (
    <Link
      href="/porra?section=playoffResults"
      className="home-playoff-banner theme-dark group"
      aria-label="Ir a la fase de playoffs para seleccionar entrenador"
    >
      <span className="home-playoff-banner-field" aria-hidden="true" />
      <span className="home-playoff-banner-shine" aria-hidden="true" />

      <span className="home-playoff-banner-copy">
        <span className="home-playoff-banner-kicker">Fase de playoffs</span>
        <span className="home-playoff-banner-title">Elige resultados</span>
      </span>

      <span className="home-playoff-banner-visual" aria-hidden="true">
        <span className="home-playoff-banner-cards">
          {playoffBannerTrainers.map((trainer, index) => (
            <span key={trainer.id} className="home-playoff-banner-card">
              <TrainerFullArtCard card={trainer} priority={index === 1} />
            </span>
          ))}
        </span>
        <span className="home-playoff-banner-chips">
          {playoffBannerChips.map((chip) => (
            <span
              key={chip.id}
              className="home-playoff-banner-chip"
              style={
                {
                  "--home-chip-color": chip.color,
                } as CSSProperties
              }
            >
              <span className="home-playoff-banner-chip-icon">
                <Image
                  src={chip.icon}
                  alt=""
                  fill
                  sizes="44px"
                  className="object-contain"
                  unoptimized
                />
              </span>
              <span className="home-playoff-banner-chip-points">
                +{chip.points}
              </span>
            </span>
          ))}
        </span>
      </span>
    </Link>
  );
}

function SobresPromoBanner({ userId }: { userId: string }) {
  const [unopened, setUnopened] = useState<number | null>(null);
  const [bracketOpen, setBracketOpen] = useState(false);
  useEffect(() => {
    // setState diferido para no leer estado en el render (evita mismatch de
    // hidratación y el lint de setState síncrono en effect). En prod (Supabase)
    // el conteo es del servidor; en local, de localStorage.
    let active = true;
    const timer = window.setTimeout(() => {
      const supabase = getSupabaseBrowserClient();
      if (supabase) {
        void countUnopenedPacksRemote(
          supabase as unknown as { from: (t: string) => unknown },
          userId,
        ).then((n) => {
          if (active) setUnopened(n);
        });
      } else {
        setUnopened(countUnopenedPacks(userId));
      }
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [userId]);

  return (
    <>
      <div className="flex w-full max-w-full flex-col gap-2 rounded-lg border border-[#a7f600]/25 bg-[#a7f600]/[0.08] p-2">
        <Link
          href="/cofres"
          className="group flex w-full max-w-full items-center justify-center gap-2 rounded-md px-2 py-1.5 transition hover:bg-[#a7f600]/[0.1] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#a7f600]"
        >
          <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#a7f600]/70">
            Nuevo sobre en
          </span>
          <NextSobreCountdown />
          {unopened ? (
            <span className="ml-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#a7f600] px-1.5 text-[11px] font-bold leading-none text-black">
              {unopened}
            </span>
          ) : null}
        </Link>
        <button
          type="button"
          onClick={() => setBracketOpen(true)}
          className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-xs font-black uppercase tracking-[0.14em] text-white transition hover:border-[#a7f600]/45 hover:bg-[#a7f600]/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#a7f600]"
        >
          VER CUADRO MUNDIAL
        </button>
      </div>
      <WorldCupBracketModal
        open={bracketOpen}
        onClose={() => setBracketOpen(false)}
      />
    </>
  );
}

type RecentSwap = {
  id: string;
  userId: string;
  userName: string;
  inPlayerId: string;
  outPlayerId: string;
  pointsIn: number;
  pointsOut: number;
};

type RecentSwapRowData = {
  id: string;
  user_id?: string;
  in_player_id: string;
  out_player_id: string;
  points_in: number;
  points_out: number;
  created_at: string;
  profiles?:
    | { display_name?: string; is_hidden?: boolean }
    | Array<{ display_name?: string; is_hidden?: boolean }>
    | null;
};

// Feed de "ultimos cambios del once" (fichajes de cartas) para la home. Lee
// card_swaps, que es de lectura publica en Supabase, asi que funciona sin login.
// La seccion solo se muestra cuando hay actividad real: en modo demo
// (CARDS_DEMO) los swaps estan deshabilitados y nada persiste, asi que estara
// vacia hasta que las cartas corran sobre Supabase de verdad.
function RecentSwapsFeed() {
  const [swaps, setSwaps] = useState<RecentSwap[]>([]);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    let active = true;
    void (async () => {
      const { data: rows, error } = await supabase
        .from("card_swaps")
        .select(
          "id, user_id, in_player_id, out_player_id, points_in, points_out, created_at, profiles(display_name, is_hidden)",
        )
        .order("created_at", { ascending: false })
        .limit(8);
      if (!active || error || !rows) return;
      const mapped: RecentSwap[] = [];
      for (const row of rows as RecentSwapRowData[]) {
        const profile = Array.isArray(row.profiles)
          ? row.profiles[0]
          : row.profiles;
        if (profile?.is_hidden) continue;
        mapped.push({
          id: row.id,
          userId: row.user_id || "",
          userName: profile?.display_name || "Jugador",
          inPlayerId: row.in_player_id,
          outPlayerId: row.out_player_id,
          pointsIn: Number(row.points_in) || 0,
          pointsOut: Number(row.points_out) || 0,
        });
      }
      setSwaps(mapped);
    })();
    return () => {
      active = false;
    };
  }, []);

  if (swaps.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white">
            Últimos cambios
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Quién ha cambiado su once
          </p>
        </div>
        <Link
          href="/cofres?tab=swaps"
          className="w-fit shrink-0 rounded-lg border border-white/10 px-3 py-2 text-sm font-bold text-white transition hover:bg-white/10"
        >
          Ver más
        </Link>
      </div>

      <div className="divide-y divide-white/[0.06]">
        {swaps.map((swap) => (
          <CommunitySwapRow
            key={swap.id}
            userName={swap.userName}
            userId={swap.userId}
            inPlayerId={swap.inPlayerId}
            outPlayerId={swap.outPlayerId}
            pointsIn={swap.pointsIn}
            pointsOut={swap.pointsOut}
          />
        ))}
      </div>
    </section>
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
      className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition hover:bg-white/[0.04]"
    >
      <span
        className="flex w-6 shrink-0 items-center justify-center text-sm font-bold text-zinc-300"
        aria-label={`Puesto ${position}`}
      >
        <RankNumber position={position} />
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
  onSelect,
}: {
  row: PlayerStandingRow;
  position: number;
  onSelect: (playerId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(row.player.id)}
      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition hover:bg-white/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#a7f600]"
    >
      <span
        className="flex w-6 shrink-0 items-center justify-center text-sm font-bold text-zinc-300"
        aria-label={`Puesto ${position}`}
      >
        <RankNumber position={position} />
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
    </button>
  );
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

function isTrainerChipMatch(match: Match) {
  return match.number >= 73;
}

function trainerChipHref(match: Match) {
  return isTrainerChipMatch(match)
    ? `/porra?section=playoffResults&match=${match.number}`
    : "/porra?section=results&goto=next";
}

function HomeTrainerChipRow({
  match,
  onOpenMobile,
  prediction,
}: {
  match: Match;
  onOpenMobile?: (matchNumber: number) => void;
  prediction: Prediction;
}) {
  if (!isTrainerChipMatch(match)) return null;

  const matchPrediction = prediction.matchPredictions[String(match.number)];

  return (
    <div className="mx-3 mb-3 mt-1.5 flex justify-center sm:mx-4">
      {onOpenMobile ? (
        <button
          type="button"
          className="flex w-full max-w-[13.6rem] justify-center border-0 bg-transparent p-0 text-inherit"
          aria-haspopup="dialog"
          aria-label="Elegir estrategia de entrenador"
          onClick={() => onOpenMobile(match.number)}
        >
          <TrainerTacticPickPill
            tacticId={matchPrediction?.tacticId}
            teamId={matchPrediction?.trainerTeamId}
          />
        </button>
      ) : null}
      {!onOpenMobile ? (
        <TrainerTacticPickPill
          href={trainerChipHref(match)}
          tacticId={matchPrediction?.tacticId}
          teamId={matchPrediction?.trainerTeamId}
        />
      ) : null}
    </div>
  );
}

function UpcomingMatchCard({
  compact = false,
  hasUser,
  match,
  prediction,
  result,
  onScoreChange,
  onTrainerChipOpen,
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
  onTrainerChipOpen?: (matchNumber: number) => void;
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
      className="match-card overflow-hidden rounded-[22px] text-white"
      style={{
        background:
          "radial-gradient(250px at 0% 0%, rgba(0, 99, 75, 0.2) 0%, rgba(47, 47, 47, 0) 70%), radial-gradient(250px at 100% 0%, rgba(216, 159, 40, 0.2) 0%, rgba(47, 47, 47, 0) 70%), var(--match-card-bg)",
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

      {hasUser ? (
        <HomeTrainerChipRow
          match={match}
          onOpenMobile={onTrainerChipOpen}
          prediction={prediction}
        />
      ) : null}

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
                  ? "Predicción cerrada"
                  : "No rellenaste este resultado"
                : "Editable hasta el inicio"}
            </span>
          ) : (
            <span className="text-xs font-medium text-zinc-500">
              Entra para guardar tu predicción
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
