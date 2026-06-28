"use client";

import { useState } from "react";

import { hasFinishedScore, PlayerAvatar, TeamFlag } from "@/components/common";
import { isFinishedResult } from "@/components/results-recap";
import {
  addTrainerChipPoints,
  sortTrainerChips,
  TrainerChipScorePill,
  type TrainerChipPoints,
  trainerChipFromScoreEntry,
} from "@/components/trainer-chip-score-pill";
import { playersById, schedule, teamsById } from "@/lib/data";
import { formatDate, translateSlot } from "@/lib/format";
import { calculateShootoutScore } from "@/lib/match-events";
import type { AdminResult, AdminResults, UserProfile } from "@/lib/types";

function matchOutcomeOf(home: number, away: number) {
  return home > away ? "home" : home < away ? "away" : "draw";
}

// Puntos del usuario en un partido, con su desglose (mismo criterio que el
// reporte por usuario del inicio).
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
        xiByPlayer.set(playerId, (xiByPlayer.get(playerId) || 0) + entry.points);
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

type FeedMatch = { match: (typeof schedule)[number]; result: AdminResult };
type FeedJornada = { date: string; matches: FeedMatch[] };

// Jornadas con al menos un partido terminado, de la mas reciente a la mas
// antigua.
function buildFinishedJornadas(results: AdminResults): FeedJornada[] {
  const byDate = new Map<string, FeedMatch[]>();
  schedule.forEach((match) => {
    const result = results[String(match.number)];
    if (!result || !isFinishedResult(result) || !hasFinishedScore(result)) {
      return;
    }
    const list = byDate.get(match.date) || [];
    list.push({ match, result });
    byDate.set(match.date, list);
  });
  return [...byDate.entries()]
    .map(([date, matches]) => ({
      date,
      matches: matches.sort((a, b) => a.match.number - b.match.number),
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function ProfileJornadaFeed({
  defaultOpenAll = false,
  profile,
  results,
}: {
  defaultOpenAll?: boolean;
  profile: UserProfile;
  results: AdminResults;
}) {
  const jornadas = buildFinishedJornadas(results);

  if (!jornadas.length) {
    return (
      <p className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-6 text-center text-sm text-zinc-500">
        Aún no hay jornadas con resultados.
      </p>
    );
  }

  return (
    <div className="space-y-2.5">
      {jornadas.map((jornada, index) => (
        <JornadaFeedCard
          key={jornada.date}
          jornada={jornada}
          profile={profile}
          defaultOpen={defaultOpenAll || index === 0}
        />
      ))}
    </div>
  );
}

function JornadaFeedCard({
  defaultOpen,
  jornada,
  profile,
}: {
  defaultOpen: boolean;
  jornada: FeedJornada;
  profile: UserProfile;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const rows = jornada.matches.map((item) => ({
    item,
    report: userMatchReport(profile, item.match.number, item.result),
  }));
  const total = rows.reduce((sum, row) => sum + row.report.total, 0);

  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-white/[0.03]"
      >
        <span className="flex min-w-0 items-center gap-2">
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className={`h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform ${
              open ? "rotate-90" : ""
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
            · {jornada.matches.length}
          </span>
        </span>
        <span
          className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-bold ${
            total > 0
              ? "bg-[#a7f600]/15 text-[#a7f600]"
              : total < 0
                ? "bg-rose-400/15 text-rose-300"
                : "bg-white/[0.06] text-zinc-400"
          }`}
        >
          {total > 0 ? `+${total}` : total}
        </span>
      </button>

      {open ? (
        <div className="space-y-1.5 border-t border-white/[0.07] p-2.5">
          {rows.map(({ item, report }) => (
            <FeedMatchRow
              key={item.match.number}
              item={item}
              profile={profile}
              report={report}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FeedMatchRow({
  item,
  profile,
  report,
}: {
  item: FeedMatch;
  profile: UserProfile;
  report: ReturnType<typeof userMatchReport>;
}) {
  const { match, result } = item;
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
  const pick = profile.prediction?.matchPredictions?.[String(match.number)];
  const hasPick = Boolean(
    pick && pick.homeScore !== "" && pick.awayScore !== "",
  );

  // Predccion coloreada contra el resultado final, como el modal del ojo.
  let pickClass = "border border-white/10 bg-white/[0.03] text-zinc-600";
  if (hasPick && pick) {
    const pickHome = Number(pick.homeScore);
    const pickAway = Number(pick.awayScore);
    const finalHome = Number(result.homeScore);
    const finalAway = Number(result.awayScore);
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

  const xiChips = report.xiPlayers.flatMap((row) => {
    const player = playersById.get(row.playerId);
    return player ? [{ player, points: row.points }] : [];
  });
  const shootoutScore = calculateShootoutScore(result, homeTeamId, awayTeamId);
  const hasShootout = shootoutScore.home > 0 || shootoutScore.away > 0;
  const breakdownParts = [
    { label: "Exacto", value: report.exact },
    { label: "Quiniela", value: report.outcome },
  ].filter((part) => part.value !== 0);

  return (
    <div className="rounded-lg bg-white/[0.03] px-2.5 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <TeamFlag
            teamId={homeTeamId}
            className="h-5 w-5 shrink-0 rounded-full border border-white/15 object-cover"
          />
          <span className="flex shrink-0 flex-col items-center gap-0.5 rounded-md bg-white/[0.07] px-1.5 py-0.5 text-xs font-bold tabular-nums text-white">
            <span>
              {result.homeScore}-{result.awayScore}
            </span>
            {hasShootout ? (
              <span className="text-[10px] text-zinc-400">
                ({shootoutScore.home}-{shootoutScore.away})
              </span>
            ) : null}
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
        {breakdownParts.map((part) => (
          <span
            key={part.label}
            className="inline-flex items-center gap-1 rounded bg-white/[0.05] px-1.5 py-0.5 text-[10px] font-medium text-zinc-400"
          >
            {part.label}
            <span className={part.value >= 0 ? "text-white" : "text-red-400"}>
              {part.value > 0 ? `+${part.value}` : part.value}
            </span>
          </span>
        ))}
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
            <span className={report.xiOther >= 0 ? "text-white" : "text-red-400"}>
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
