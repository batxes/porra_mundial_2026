"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { hasFinishedScore, PlayerAvatar, TeamFlag } from "@/components/common";
import {
  TrainerChipScorePill,
  trainerChipsFromScoreEntries,
  type TrainerChipPoints,
} from "@/components/trainer-chip-score-pill";
import { useAppContext } from "@/lib/app-context";
import { playersById, schedule, teamsById } from "@/lib/data";
import { translateSlot } from "@/lib/format";
import type { AdminResult, Match, ScoreEntry } from "@/lib/types";

const resultsRecapKey = "porra26_results_recap_seen";
const resultsRecapRankKey = "porra26_results_recap_rank";

// Puesto anterior a los ultimos resultados, para el delta del marcador del
// inicio. Se avisa con un evento porque el watcher y el inicio comparten
// pestaña (los eventos `storage` solo saltan entre pestañas).
export const rankDeltaEventName = "porra26-rank-delta";

export function rankBeforeLastUpdateKey(userId: string) {
  return `${resultsRecapRankKey}_prev_${userId}`;
}

// Para useSyncExternalStore en el marcador del inicio.
export function subscribeRankDelta(listener: () => void) {
  window.addEventListener(rankDeltaEventName, listener);
  return () => {
    window.removeEventListener(rankDeltaEventName, listener);
  };
}

export function readRankBeforeUpdate(userId?: string): number | null {
  if (!userId) return null;
  try {
    const raw = window.localStorage.getItem(rankBeforeLastUpdateKey(userId));
    const value = raw ? Number(raw) : NaN;
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function persistRankDelta(
  userId: string,
  previousRank: number | null,
  currentRank: number,
) {
  if (currentRank <= 0 || previousRank === null) return;
  try {
    if (previousRank === currentRank) {
      window.localStorage.removeItem(rankBeforeLastUpdateKey(userId));
    } else {
      window.localStorage.setItem(
        rankBeforeLastUpdateKey(userId),
        String(previousRank),
      );
    }
    window.dispatchEvent(new Event(rankDeltaEventName));
  } catch {
    // Ignore storage failures.
  }
}

type RecapRank = { current: number; previous: number | null; total: number };
type RecapBreakdownPart = { label: string; points: number };
type MatchPick = { homeScore: string | number; awayScore: string | number };
type RecapItem = {
  match: Match;
  result: AdminResult;
  points: number;
  breakdown: RecapBreakdownPart[];
  pick: MatchPick | null;
  xiPlayers: { playerId: string; points: number }[];
  xiOther: number;
  trainerChips: TrainerChipPoints[];
};

function matchOutcomeOf(home: number, away: number) {
  return home > away ? "home" : home < away ? "away" : "draw";
}

// Atribuye los puntos del once a cada futbolista (via id del evento) para
// mostrar un badge por jugador en vez de un "Tu once" generico.
function playerPointsFromEntries(entries: ScoreEntry[], result: AdminResult) {
  const eventPlayerById = new Map<string, string>();
  (result.events || []).forEach((event) => {
    if (event.id && event.playerId) {
      eventPlayerById.set(event.id, event.playerId);
    }
  });
  const byPlayer = new Map<string, number>();
  let xiOther = 0;
  entries.forEach((entry) => {
    if (!entry.ruleCode.startsWith("player_")) return;
    const playerId = eventPlayerById.get(entry.sourceRef);
    if (playerId) {
      byPlayer.set(playerId, (byPlayer.get(playerId) || 0) + entry.points);
    } else {
      xiOther += entry.points;
    }
  });
  const xiPlayers = [...byPlayer.entries()]
    .map(([playerId, points]) => ({ playerId, points }))
    .sort((a, b) => b.points - a.points);
  return { xiPlayers, xiOther };
}

export function isFinishedResult(result?: AdminResult) {
  const status = String(result?.status || "").toLowerCase();
  return (
    status.includes("final") ||
    status.includes("finished") ||
    status === "ft" ||
    status === "validated"
  );
}

const matchPointCategories: Array<{
  label: string;
  match: (ruleCode: string) => boolean;
}> = [
  { label: "Resultado exacto", match: (rc) => rc === "match_exact_score" },
  { label: "Resultado acertado", match: (rc) => rc === "match_outcome_hit" },
  { label: "Tu once", match: (rc) => rc.startsWith("player_") },
  { label: "Pasa de ronda", match: (rc) => rc === "team_progression_hit" },
  { label: "Campeón", match: (rc) => rc === "tournament_champion_hit" },
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

// Vigila los resultados desde cualquier pagina: cuando aparece un partido
// terminado que el usuario aun no ha visto, abre el reporte. Con el refresco
// en vivo del AppProvider tambien salta con la web abierta; si hace tiempo
// que no entra, agrupa todos los pendientes en un solo modal.
export function ResultsRecapWatcher() {
  const {
    adminResults,
    currentScorecard,
    leaderboard: fullLeaderboard,
    prediction,
    ready,
    user,
  } = useAppContext();
  const pathname = usePathname();
  const leaderboard = useMemo(
    () => fullLeaderboard.filter((profile) => !profile.isHidden),
    [fullLeaderboard],
  );
  const [recapMatches, setRecapMatches] = useState<RecapItem[]>([]);
  const [recapRank, setRecapRank] = useState<RecapRank | null>(null);

  useEffect(() => {
    if (!ready || !user) return;
    // En /admin no interrumpimos: es quien esta metiendo los resultados.
    if (pathname === "/admin") return;

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

    // Hay "actualizacion" cuando aparecen partidos terminados nuevos, aunque
    // el usuario no puntue en ellos (el puesto puede moverse por los demas).
    const newlyFinished = finished.some(
      (item) => !seenSet.has(item.match.number),
    );

    if (!fresh.length) {
      if (newlyFinished) {
        persistRankDelta(user.id, previousRank, currentRank);
      }
      persistSeen();
      return;
    }

    const items = fresh
      .map(({ match, result }) => {
        const entries = entriesByMatch.get(match.number) || [];
        const { xiPlayers, xiOther } = playerPointsFromEntries(entries, result);
        const rawPick = prediction.matchPredictions[String(match.number)];
        const pick =
          rawPick && rawPick.homeScore !== "" && rawPick.awayScore !== ""
            ? rawPick
            : null;
        return {
          match,
          result,
          points: matchPoints(match.number),
          breakdown: matchPointBreakdown(entries),
          pick,
          xiPlayers,
          xiOther,
          trainerChips: trainerChipsFromScoreEntries(entries),
        };
      })
      .sort((a, b) => b.match.number - a.match.number);

    const frame = window.requestAnimationFrame(() => {
      persistSeen();
      persistRankDelta(user.id, previousRank, currentRank);
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
  }, [
    adminResults,
    currentScorecard,
    leaderboard,
    pathname,
    prediction,
    ready,
    user,
  ]);

  if (!recapMatches.length) return null;

  return (
    <MatchResultsRecapModal
      items={recapMatches}
      rank={recapRank}
      onClose={() => {
        setRecapMatches([]);
        setRecapRank(null);
      }}
    />
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
  // Si un futbolista de tu once ha puntuado (gol, MVP...), presenta Andrés;
  // si no, Pedrerol.
  const xiScored = items.some((item) =>
    item.breakdown.some((part) => part.label === "Tu once" && part.points > 0),
  );
  const presenter = xiScored ? "/andres.png" : "/pedrerol.png";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-4 pb-6 pt-16 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="results-recap-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-full w-full max-w-md flex-col rounded-2xl border border-white/10 bg-[#151515] p-5 text-white shadow-2xl shadow-black/50">
        <div className="mb-3 flex shrink-0 items-end justify-between gap-2">
          <div className="min-w-0 pb-1">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-rose-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-rose-300">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-400" />
              En directo
            </span>
            <h3
              id="results-recap-title"
              className="mt-2 text-base font-bold tracking-tight sm:text-xl"
            >
              {items.length === 1
                ? "Ha terminado un partido"
                : `Han terminado ${items.length} partidos`}
            </h3>
            <p className="mt-1.5 text-[13px] leading-5 text-zinc-400 sm:mt-2 sm:text-sm sm:leading-6 sm:text-zinc-300">
              Esto es lo que has sumado desde tu última visita.
            </p>
          </div>
          <Image
            src={presenter}
            alt=""
            width={171}
            height={128}
            className="-mb-1 -mt-14 h-28 w-auto shrink-0 drop-shadow-[0_10px_18px_rgba(0,0,0,0.35)] sm:-mt-16 sm:h-32"
            priority
          />
        </div>

        {/* Con muchos partidos pendientes (p. ej. una semana sin entrar) la
            lista hace scroll; cabecera, marcador y boton quedan fijos. */}
        <div className="team-picker-scroll -mr-2 min-h-0 space-y-2 overflow-y-auto pr-2">
          {items.map((item) => (
            <RecapMatchRow key={item.match.number} item={item} />
          ))}
        </div>

        <div className="mt-4 grid shrink-0 grid-cols-2 gap-2">
          <div
            className={`rounded-xl border px-3 py-3.5 text-center ${
              rank ? "" : "col-span-2"
            } ${
              totalPoints > 0
                ? "border-[#a7f600]/25 bg-[radial-gradient(140px_at_50%_-20%,rgba(167,246,0,0.16),transparent)] bg-[#a7f600]/[0.07]"
                : totalPoints < 0
                  ? "border-rose-400/25 bg-[radial-gradient(140px_at_50%_-20%,rgba(251,113,133,0.14),transparent)] bg-rose-400/[0.07]"
                  : "border-white/10 bg-white/[0.04]"
            }`}
          >
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
              {totalPoints < 0 ? "Balance" : "Has sumado"}
            </p>
            <p
              className={`mt-1.5 text-3xl font-bold leading-none ${
                totalPoints > 0
                  ? "text-[#a7f600]"
                  : totalPoints < 0
                    ? "text-rose-300"
                    : "text-white"
              }`}
            >
              {totalPoints > 0 ? `+${totalPoints}` : totalPoints}
            </p>
            <p className="mt-1.5 text-[11px] font-semibold text-zinc-500">
              {Math.abs(totalPoints) === 1 ? "punto" : "puntos"}
            </p>
          </div>

          {rank ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3.5 text-center">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                Clasificación
              </p>
              <p className="mt-1.5 text-3xl font-bold leading-none text-white">
                {rank.current}º
                <span className="text-sm font-semibold text-zinc-500">
                  {" "}
                  / {rank.total}
                </span>
              </p>
              {rankDelta !== null ? (
                <p
                  className={`mt-1.5 text-[11px] font-bold ${
                    rankDelta > 0
                      ? "text-[#a7f600]"
                      : rankDelta < 0
                        ? "text-rose-300"
                        : "text-zinc-500"
                  }`}
                >
                  {rankDelta > 0
                    ? `▲ Subes ${rankDelta} ${rankDelta === 1 ? "puesto" : "puestos"}`
                    : rankDelta < 0
                      ? `▼ Bajas ${Math.abs(rankDelta)} ${
                          Math.abs(rankDelta) === 1 ? "puesto" : "puestos"
                        }`
                      : "Mantienes tu puesto"}
                </p>
              ) : (
                <p className="mt-1.5 text-[11px] font-medium text-zinc-500">
                  de {rank.total} participantes
                </p>
              )}
            </div>
          ) : null}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full shrink-0 rounded-lg bg-[#a7f600] px-4 py-3 text-sm font-bold text-black transition hover:bg-[#c7ff43]"
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
  // En vez de "Resultado exacto/acertado", la prediccion coloreada segun el
  // acierto (mismo patron que el modal de predicciones): exacto relleno,
  // ganador con borde, fallo apagado. Los puntos del once, por futbolista.
  const xiChips = item.xiPlayers.flatMap((row) => {
    const player = playersById.get(row.playerId);
    return player ? [{ player, points: row.points }] : [];
  });
  const finalHome = Number(result.homeScore);
  const finalAway = Number(result.awayScore);
  let pickClass = "border border-white/10 bg-white/[0.03] text-zinc-600";
  if (item.pick) {
    const pickHome = Number(item.pick.homeScore);
    const pickAway = Number(item.pick.awayScore);
    if (pickHome === finalHome && pickAway === finalAway) {
      pickClass = "border border-[#a7f600]/35 bg-[#a7f600]/15 text-[#a7f600]";
    } else if (
      matchOutcomeOf(pickHome, pickAway) === matchOutcomeOf(finalHome, finalAway)
    ) {
      pickClass = "border border-[#a7f600]/30 bg-white/[0.06] text-white";
    } else {
      pickClass = "border border-white/10 bg-white/[0.06] text-zinc-500";
    }
  }

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

      <div className="mt-2 flex flex-wrap items-center gap-1">
          <span
            title="Tu predicción"
            className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${pickClass}`}
          >
            {item.pick
              ? `${item.pick.homeScore}-${item.pick.awayScore}`
              : "–-–"}
          </span>
          {xiChips.map(({ player, points: playerPoints }) => (
            <span
              key={player.id}
              className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.05] py-px pl-px pr-1.5 text-[10px] font-medium text-zinc-400"
            >
              <PlayerAvatar player={player} className="size-4! text-[6px]" />
              {player.name}
              <span
                className={playerPoints >= 0 ? "text-white" : "text-red-400"}
              >
                {playerPoints > 0 ? `+${playerPoints}` : playerPoints}
              </span>
            </span>
          ))}
          {item.xiOther !== 0 ? (
            <span className="inline-flex items-center gap-1 rounded bg-white/[0.05] px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
              Tu once
              <span className={item.xiOther >= 0 ? "text-white" : "text-red-400"}>
                {item.xiOther > 0 ? `+${item.xiOther}` : item.xiOther}
              </span>
            </span>
          ) : null}
          {item.trainerChips.map((chip) => (
            <TrainerChipScorePill
              key={`${chip.teamId}-${chip.tacticId}`}
              chip={chip}
            />
          ))}
      </div>
    </div>
  );
}
