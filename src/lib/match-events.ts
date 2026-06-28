import type { AdminEvent, AdminResult } from "@/lib/types";

const penaltyGoalTypes = new Set(["penalty_goal", "penalti marcado"]);

function parseScore(value: number | string | null | undefined) {
  if (value === "" || value === null || value === undefined) return null;
  const score = Number(value);
  return Number.isFinite(score) && score >= 0 ? score : null;
}

export function isShootoutEvent(event: Pick<AdminEvent, "details" | "source"> | undefined) {
  return event?.details?.phase === "shootout" || event?.source === "shootout";
}

export function shootoutEventOrder(event: Pick<AdminEvent, "details" | "minute">) {
  const order = Number(event.details?.shootoutOrder);
  if (Number.isFinite(order) && order > 0) return order;
  const minute = Number(event.minute);
  return Number.isFinite(minute) && minute > 120 ? minute - 120 : 0;
}

export function calculateShootoutScore(
  result: AdminResult | undefined,
  homeTeamId = "",
  awayTeamId = "",
) {
  const score = { home: 0, away: 0 };

  (result?.events || []).forEach((event) => {
    if (!isShootoutEvent(event) || !penaltyGoalTypes.has(String(event.type))) {
      return;
    }
    if (event.teamId === homeTeamId) score.home += 1;
    if (event.teamId === awayTeamId) score.away += 1;
  });

  return score;
}

export function hasShootoutScore(
  result: AdminResult | undefined,
  homeTeamId = "",
  awayTeamId = "",
) {
  const score = calculateShootoutScore(result, homeTeamId, awayTeamId);
  return score.home > 0 || score.away > 0;
}

export function resultWinnerTeamId(
  result: AdminResult | undefined,
  homeTeamId = "",
  awayTeamId = "",
) {
  const homeScore = parseScore(result?.homeScore);
  const awayScore = parseScore(result?.awayScore);
  if (homeScore === null || awayScore === null) return "";
  if (homeScore > awayScore) return homeTeamId;
  if (awayScore > homeScore) return awayTeamId;

  const shootout = calculateShootoutScore(result, homeTeamId, awayTeamId);
  if (shootout.home > shootout.away) return homeTeamId;
  if (shootout.away > shootout.home) return awayTeamId;
  return "";
}

export function resultLoserTeamId(
  result: AdminResult | undefined,
  homeTeamId = "",
  awayTeamId = "",
) {
  const winner = resultWinnerTeamId(result, homeTeamId, awayTeamId);
  if (!winner) return "";
  if (winner === homeTeamId) return awayTeamId;
  if (winner === awayTeamId) return homeTeamId;
  return "";
}
