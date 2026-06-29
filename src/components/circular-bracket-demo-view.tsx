"use client";

import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { SectionHeading, TeamFlag } from "@/components/common";
import { schedule, teamsById } from "@/lib/data";
import { translateSlot } from "@/lib/format";
import { useAppContext } from "@/lib/app-context";
import { resultLoserTeamId, resultWinnerTeamId } from "@/lib/match-events";
import { confirmedRound32Teams } from "@/lib/playoff-teams";
import { emptyPrediction, resolveSlot, scheduleUtc } from "@/lib/prediction";
import { trainerTacticById } from "@/lib/trainer-tactics";
import type { AdminResults, Match, Prediction } from "@/lib/types";

const SIZE = 1000;
const CENTER = SIZE / 2;
const R_FLAG = 450;
const RING = {
  R32: 325,
  R16: 245,
  QF: 170,
  SF: 110,
} as const;
const LEFT = { root: 101, start: 180, end: 360 };
const RIGHT = { root: 102, start: 0, end: 180 };

type Side = "home" | "away";
type RoundKey = keyof typeof RING;

type Point = {
  x: number;
  y: number;
};

type FlagPos = Point & {
  match: number;
  side: Side;
};

type NodePos = Point & {
  match: number;
  round: RoundKey;
};

type Segment = {
  active: boolean;
  key: string;
  x1: number;
  x2: number;
  y1: number;
  y2: number;
};

type Arc = {
  active: boolean;
  d: string;
  key: string;
};

type Geometry = {
  arcs: Arc[];
  flags: FlagPos[];
  nodes: NodePos[];
  segments: Segment[];
};

type ResolvedSlot = {
  fallback: string;
  teamId: string;
};

type BracketState = {
  activePaths: Set<string>;
  champion: string;
  flags: Array<FlagPos & ResolvedSlot & { selected: boolean }>;
  nodeWinners: Map<number, string>;
};

type MatchPopoverContent = {
  chipRows: ChipPopularityRow[];
  chipTotal: number;
  kind: "match";
  marketRows: MarketRow[];
  subtitle: string;
  title: string;
};

type TeamPopoverContent = {
  kind: "team";
  results: TeamResultRow[];
  subtitle: string;
  teamId: string;
  title: string;
};

type PopoverContent = MatchPopoverContent | TeamPopoverContent;

type MarketRow = {
  code: string;
  label: string;
  probability: number | null;
  teamId?: string;
};

type ChipPopularityRow = {
  count: number;
  percentage: number;
  points: number;
  tacticId: string;
  tacticTitle: string;
  teamId: string;
};

type TeamResultRow = {
  against: number | string;
  date: string;
  for: number | string;
  opponentId: string;
  opponentLabel: string;
  outcome: "G" | "E" | "P";
  sortAt: number;
  stage: string;
};

type ActivePopover = {
  anchor: HTMLElement;
  id: string;
};

type Placement = {
  arrowLeft: number;
  left: number;
  side: "top" | "bottom";
  top: number;
};

type MarketSnapshot = {
  prices: Record<string, Record<string, number>>;
};

const childRound: Record<Exclude<RoundKey, "R32">, RoundKey> = {
  R16: "R32",
  QF: "R16",
  SF: "QF",
};

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function fifaCode(teamId: string) {
  return teamId.toUpperCase();
}

function formatMarketPct(value: number | null) {
  if (value == null) return "Sin mercado";
  const pct = value * 100;
  if (pct > 0 && pct < 1) return "<1%";
  if (pct < 10) return `${pct.toFixed(1)}%`;
  return `${Math.round(pct)}%`;
}

function marketKindForMatch(match: Match) {
  if (match.stage === "Dieciseisavos") return "reach_r16";
  if (match.stage === "Octavos") return "reach_qf";
  if (match.stage === "Cuartos") return "reach_sf";
  if (match.stage === "Semifinales") return "reach_final";
  if (match.stage === "Final") return "champion";
  return "champion";
}

function marketTitleForMatch(match: Match) {
  if (match.stage === "Dieciseisavos") return "Mercado: llegar a octavos";
  if (match.stage === "Octavos") return "Mercado: llegar a cuartos";
  if (match.stage === "Cuartos") return "Mercado: llegar a semifinales";
  if (match.stage === "Semifinales") return "Mercado: llegar a la final";
  if (match.stage === "Final") return "Mercado: ganar el Mundial";
  return "Mercado";
}

function formatPopoverMatchDate(match: Match) {
  const parts = new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "short",
    timeZone: "Europe/Madrid",
  }).formatToParts(new Date(scheduleUtc(match)));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "";
  const month = value("month").replace(".", "").toUpperCase();

  return `${month} ${value("day")} - ${value("hour")}:${value("minute")}`;
}

function formatShortMadridDay(match: Match) {
  const parts = new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "short",
    timeZone: "Europe/Madrid",
  }).formatToParts(new Date(scheduleUtc(match)));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "";
  return `${value("month").replace(".", "").toUpperCase()} ${value("day")}`;
}

function scoreValue(value: number | string | undefined | null) {
  if (value === "" || value == null) return null;
  const score = Number(value);
  return Number.isFinite(score) ? score : null;
}

function isFinishedResult(result: AdminResults[string] | undefined) {
  const status = String(result?.status || "").toLowerCase();
  return (
    status === "validated" ||
    status.includes("finish") ||
    status.includes("final") ||
    status.includes("full") ||
    status.includes("ft")
  );
}

function resultScore(result: AdminResults[string] | undefined) {
  const home = scoreValue(result?.homeScore);
  const away = scoreValue(result?.awayScore);
  return home == null || away == null ? null : { away, home };
}

function matchTeamIds(match: Match, result: AdminResults[string] | undefined) {
  const confirmed = confirmedRound32Teams[String(match.number)];
  return {
    away:
      result?.awayTeamId ||
      confirmed?.away ||
      (teamsById.has(match.away) ? match.away : ""),
    home:
      result?.homeTeamId ||
      confirmed?.home ||
      (teamsById.has(match.home) ? match.home : ""),
  };
}

function recentResultsForTeam(teamId: string, adminResults: AdminResults) {
  return schedule
    .flatMap((match): TeamResultRow[] => {
      const result = adminResults[String(match.number)];
      const score = resultScore(result);
      if (!score || !isFinishedResult(result)) return [];

      const teams = matchTeamIds(match, result);
      const isHome = teams.home === teamId;
      const isAway = teams.away === teamId;
      if (!isHome && !isAway) return [];

      const forScore = isHome ? score.home : score.away;
      const againstScore = isHome ? score.away : score.home;
      const opponentId = isHome ? teams.away : teams.home;
      const opponent = opponentId ? teamsById.get(opponentId) : null;

      return [
        {
          against: againstScore,
          date: formatShortMadridDay(match),
          for: forScore,
          opponentId,
          opponentLabel: opponent?.name || "Rival",
          outcome:
            forScore > againstScore ? "G" : forScore === againstScore ? "E" : "P",
          sortAt: new Date(scheduleUtc(match)).getTime(),
          stage: match.stage,
        },
      ];
    })
    .sort((a, b) => b.sortAt - a.sortAt)
    .slice(0, 5);
}

function chipPopularityRows(match: Match, predictions: Prediction[]) {
  const counts = new Map<string, ChipPopularityRow>();
  let total = 0;

  predictions.forEach((prediction) => {
    const pick = prediction.matchPredictions?.[String(match.number)];
    if (!pick?.trainerTeamId || !pick.tacticId) return;

    const tactic = trainerTacticById.get(pick.tacticId);
    if (!tactic || !teamsById.has(pick.trainerTeamId)) return;

    total += 1;
    const key = `${pick.trainerTeamId}:${pick.tacticId}`;
    const current = counts.get(key);
    if (current) {
      current.count += 1;
      return;
    }

    counts.set(key, {
      count: 1,
      percentage: 0,
      points: tactic.points,
      tacticId: pick.tacticId,
      tacticTitle: tactic.title,
      teamId: pick.trainerTeamId,
    });
  });

  const rows = Array.from(counts.values())
    .map((row) => ({
      ...row,
      percentage: total ? row.count / total : 0,
    }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        b.points - a.points ||
        a.tacticTitle.localeCompare(b.tacticTitle, "es", {
          sensitivity: "base",
        }),
    )
    .slice(0, 5);

  return { rows, total };
}

function polar(deg: number, radius: number): Point {
  const radians = (deg * Math.PI) / 180;
  return {
    x: round2(CENTER + radius * Math.sin(radians)),
    y: round2(CENTER - radius * Math.cos(radians)),
  };
}

function positionStyle(point: Point): CSSProperties {
  return {
    left: `${point.x / 10}%`,
    top: `${point.y / 10}%`,
  };
}

function arcPath(radius: number, a1: number, a2: number) {
  const [start, end] = a1 <= a2 ? [a1, a2] : [a2, a1];
  const p1 = polar(start, radius);
  const p2 = polar(end, radius);
  return `M ${p1.x} ${p1.y} A ${radius} ${radius} 0 0 1 ${p2.x} ${p2.y}`;
}

function stageRound(match: Match): RoundKey | null {
  if (match.stage === "Dieciseisavos") return "R32";
  if (match.stage === "Octavos") return "R16";
  if (match.stage === "Cuartos") return "QF";
  if (match.stage === "Semifinales") return "SF";
  return null;
}

function winnerMatchNumber(slot: string) {
  const match = String(slot).match(/^Winner Match (\d+)$/);
  return match ? Number(match[1]) : null;
}

function loserMatchNumber(slot: string) {
  const match = String(slot).match(/^Loser Match (\d+)$/);
  return match ? Number(match[1]) : null;
}

function childMatches(match: Match): [number, number] | null {
  const home = winnerMatchNumber(match.home);
  const away = winnerMatchNumber(match.away);
  return home && away ? [home, away] : null;
}

function leafSlots(root: number, matchByNumber: Map<number, Match>) {
  const leaves: Array<{ match: number; side: Side }> = [];
  const visit = (matchNumber: number) => {
    const match = matchByNumber.get(matchNumber);
    if (!match) return;

    const kids = childMatches(match);
    if (kids) {
      visit(kids[0]);
      visit(kids[1]);
      return;
    }

    leaves.push(
      { match: matchNumber, side: "home" },
      { match: matchNumber, side: "away" },
    );
  };
  visit(root);
  return leaves;
}

function halfAngles(
  root: number,
  start: number,
  end: number,
  matchByNumber: Map<number, Match>,
) {
  const leaves = leafSlots(root, matchByNumber);
  const step = (end - start) / leaves.length;
  const flagAngle = new Map<string, number>();

  leaves.forEach((leaf, index) => {
    flagAngle.set(`${leaf.match}:${leaf.side}`, start + (index + 0.5) * step);
  });

  const nodeAngle = new Map<number, number>();
  const visit = (matchNumber: number): number => {
    const match = matchByNumber.get(matchNumber);
    const kids = match ? childMatches(match) : null;
    const angle = kids
      ? (visit(kids[0]) + visit(kids[1])) / 2
      : ((flagAngle.get(`${matchNumber}:home`) || 0) +
          (flagAngle.get(`${matchNumber}:away`) || 0)) /
        2;
    nodeAngle.set(matchNumber, angle);
    return angle;
  };
  visit(root);

  return { flagAngle, leaves, nodeAngle };
}

function shortSlotLabel(slot: string) {
  if (teamsById.has(slot)) {
    return teamsById.get(slot)?.code.toUpperCase() || slot.toUpperCase();
  }

  let match = String(slot).match(/^Winner Group ([A-L])$/);
  if (match) return `1${match[1]}`;

  match = String(slot).match(/^Runner-up Group ([A-L])$/);
  if (match) return `2${match[1]}`;

  match = String(slot).match(/^3rd Group ([A-L/]+)$/);
  if (match) return `3${match[1].replace(/\//g, "")}`;

  return translateSlot(slot);
}

function predictedScoreWinner(
  match: Match,
  home: string,
  away: string,
  prediction: Prediction,
) {
  const explicitWinner = prediction.bracket.winners[String(match.number)] || "";
  if (explicitWinner && [home, away].includes(explicitWinner)) {
    return explicitWinner;
  }

  const current = prediction.matchPredictions[String(match.number)];
  if (
    !current ||
    current.homeScore === "" ||
    current.awayScore === "" ||
    current.homeScore == null ||
    current.awayScore == null
  ) {
    return "";
  }

  const homeScore = Number(current.homeScore);
  const awayScore = Number(current.awayScore);
  if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) return "";
  if (homeScore === awayScore) return "";
  return homeScore > awayScore ? home : away;
}

function buildGeometry(matches: Match[]): Geometry {
  const matchByNumber = new Map(matches.map((match) => [match.number, match]));
  const flags: FlagPos[] = [];
  const nodes: NodePos[] = [];
  const segments: Segment[] = [];
  const arcs: Arc[] = [];
  const semifinalAngles = new Map<number, number>();

  [LEFT, RIGHT].forEach(({ root, start, end }) => {
    const { leaves, flagAngle, nodeAngle } = halfAngles(
      root,
      start,
      end,
      matchByNumber,
    );

    leaves.forEach((leaf) => {
      const angle = flagAngle.get(`${leaf.match}:${leaf.side}`) || 0;
      flags.push({ ...leaf, ...polar(angle, R_FLAG) });
    });

    nodeAngle.forEach((angle, matchNumber) => {
      const match = matchByNumber.get(matchNumber);
      const round = match ? stageRound(match) : null;
      if (!match || !round) return;

      const node = { match: matchNumber, round, ...polar(angle, RING[round]) };
      nodes.push(node);
      if (matchNumber === root) semifinalAngles.set(matchNumber, angle);

      const kids = childMatches(match);
      if (!kids) {
        const midRadius = (RING[round] + R_FLAG) / 2;
        const base = polar(angle, RING[round]);
        const trunk = polar(angle, midRadius);
        segments.push({
          active: false,
          key: `trunk-${matchNumber}`,
          x1: base.x,
          y1: base.y,
          x2: trunk.x,
          y2: trunk.y,
        });

        (["home", "away"] as const).forEach((side) => {
          const flagDeg = flagAngle.get(`${matchNumber}:${side}`) || angle;
          const mid = polar(flagDeg, midRadius);
          const tip = polar(flagDeg, R_FLAG);
          arcs.push({
            active: false,
            d: arcPath(midRadius, flagDeg, angle),
            key: `arc-${matchNumber}-${side}`,
          });
          segments.push({
            active: false,
            key: `flag-${matchNumber}-${side}`,
            x1: mid.x,
            y1: mid.y,
            x2: tip.x,
            y2: tip.y,
          });
        });
        return;
      }

      if (round === "R32") return;

      const childRadius = RING[childRound[round]];
      kids.forEach((childMatch) => {
        const childAngle = nodeAngle.get(childMatch) || angle;
        const inner = polar(childAngle, RING[round]);
        const outer = polar(childAngle, childRadius);
        segments.push({
          active: false,
          key: `inner-${matchNumber}-${childMatch}`,
          x1: inner.x,
          y1: inner.y,
          x2: outer.x,
          y2: outer.y,
        });
        arcs.push({
          active: false,
          d: arcPath(RING[round], childAngle, angle),
          key: `inner-arc-${matchNumber}-${childMatch}`,
        });
      });
    });
  });

  [LEFT.root, RIGHT.root].forEach((semifinal) => {
    const point = polar(semifinalAngles.get(semifinal) || 0, RING.SF);
    segments.push({
      active: false,
      key: `final-${semifinal}`,
      x1: CENTER,
      y1: CENTER,
      x2: point.x,
      y2: point.y,
    });
  });

  return { arcs, flags, nodes, segments };
}

function buildBracketState(
  adminResults: AdminResults,
  matches: Match[],
  geometry: Geometry,
  prediction: Prediction,
): BracketState {
  const matchByNumber = new Map(matches.map((match) => [match.number, match]));
  const activePaths = new Set<string>();
  const teamCache = new Map<number, { away: string; home: string }>();
  const winnerCache = new Map<number, string>();
  const slotCache = new Map<string, string>();

  const resultTeamForSide = (
    result: AdminResults[string] | undefined,
    side: Side,
  ) => (side === "home" ? result?.homeTeamId : result?.awayTeamId) || "";

  const resolvedTeamsForMatch = (
    matchNumber: number,
  ): { away: string; home: string } => {
    if (teamCache.has(matchNumber)) {
      return teamCache.get(matchNumber) || { away: "", home: "" };
    }

    const match = matchByNumber.get(matchNumber);
    if (!match) return { away: "", home: "" };

    const result = adminResults[String(match.number)];
    const confirmed = confirmedRound32Teams[String(match.number)];
    const teams = {
      away:
        resultTeamForSide(result, "away") ||
        confirmed?.away ||
        resolveCircularSlot(match.away, match.number),
      home:
        resultTeamForSide(result, "home") ||
        confirmed?.home ||
        resolveCircularSlot(match.home, match.number),
    };

    teamCache.set(matchNumber, teams);
    return teams;
  };

  const winnerForMatch = (matchNumber: number): string => {
    if (winnerCache.has(matchNumber)) return winnerCache.get(matchNumber) || "";
    const match = matchByNumber.get(matchNumber);
    if (!match) return "";

    const { away, home } = resolvedTeamsForMatch(match.number);
    const result = adminResults[String(match.number)];
    const resultWinner = resultWinnerTeamId(result, home, away);
    const winner =
      resultWinner ||
      (home && away ? predictedScoreWinner(match, home, away, prediction) : "");
    winnerCache.set(matchNumber, winner);
    return winner;
  };

  const resolveCircularSlot = (slot: string, matchNumber: number): string => {
    const cacheKey = `${matchNumber}:${slot}`;
    if (slotCache.has(cacheKey)) return slotCache.get(cacheKey) || "";

    const winnerChild = winnerMatchNumber(slot);
    if (winnerChild) {
      const value = winnerForMatch(winnerChild);
      slotCache.set(cacheKey, value);
      return value;
    }

    const loserChild = loserMatchNumber(slot);
    if (loserChild) {
      const { away: childAway, home: childHome } =
        resolvedTeamsForMatch(loserChild);
      const result = adminResults[String(loserChild)];
      const resultLoser = resultLoserTeamId(result, childHome, childAway);
      if (resultLoser) {
        slotCache.set(cacheKey, resultLoser);
        return resultLoser;
      }

      const childWinner = winnerForMatch(loserChild);
      const value =
        childWinner && childHome && childAway
          ? childWinner === childHome
            ? childAway
            : childHome
          : "";
      slotCache.set(cacheKey, value);
      return value;
    }

    const value = resolveSlot(slot, matchNumber, prediction);
    slotCache.set(cacheKey, value);
    return value;
  };

  const flags = geometry.flags.map((flag) => {
    const match = matchByNumber.get(flag.match);
    const slot = match?.[flag.side] || "";
    const result = match ? adminResults[String(match.number)] : undefined;
    const confirmedTeamId =
      confirmedRound32Teams[String(flag.match)]?.[flag.side] || "";
    const teamId =
      resultTeamForSide(result, flag.side) ||
      confirmedTeamId ||
      (match ? resolveCircularSlot(slot, match.number) : "");
    const winner = winnerForMatch(flag.match);
    return {
      ...flag,
      fallback: confirmedTeamId
        ? teamsById.get(confirmedTeamId)?.code.toUpperCase() || confirmedTeamId
        : shortSlotLabel(slot),
      selected: Boolean(teamId && winner === teamId),
      teamId,
    };
  });

  geometry.nodes.forEach((node) => {
    winnerForMatch(node.match);
  });

  matches.forEach((match) => {
    const winner = winnerForMatch(match.number);
    if (!winner) return;

    const kids = childMatches(match);
    if (!kids) {
      const { away, home } = resolvedTeamsForMatch(match.number);
      activePaths.add(`trunk-${match.number}`);
      if (winner === home) {
        activePaths.add(`flag-${match.number}-home`);
        activePaths.add(`arc-${match.number}-home`);
      }
      if (winner === away) {
        activePaths.add(`flag-${match.number}-away`);
        activePaths.add(`arc-${match.number}-away`);
      }
      return;
    }

    kids.forEach((childMatch) => {
      if (winnerForMatch(childMatch)) {
        activePaths.add(`inner-${match.number}-${childMatch}`);
        activePaths.add(`inner-arc-${match.number}-${childMatch}`);
      }
    });
  });

  [LEFT.root, RIGHT.root].forEach((semifinal) => {
    if (winnerForMatch(semifinal)) activePaths.add(`final-${semifinal}`);
  });

  const finalMatch = matchByNumber.get(104);
  return {
    activePaths,
    champion:
      (finalMatch ? winnerForMatch(finalMatch.number) : "") ||
      prediction.extras.worldChampion ||
      "",
    flags,
    nodeWinners: winnerCache,
  };
}

function realRound32TeamIds(matchNumber: number, matchByNumber: Map<number, Match>) {
  const confirmed = confirmedRound32Teams[String(matchNumber)];
  if (confirmed) return [confirmed.home || "", confirmed.away || ""].filter(Boolean);

  const match = matchByNumber.get(matchNumber);
  if (!match) return [];
  return [match.home, match.away].filter((teamId) => teamsById.has(teamId));
}

function leafTeamIds(
  matchNumber: number,
  matchByNumber: Map<number, Match>,
): string[] {
  const match = matchByNumber.get(matchNumber);
  if (!match) return [];

  const kids = childMatches(match);
  if (!kids) return realRound32TeamIds(matchNumber, matchByNumber);
  return kids.flatMap((child) => leafTeamIds(child, matchByNumber));
}

function marketRowsForMatch(
  match: Match,
  matchByNumber: Map<number, Match>,
  marketSnapshot: MarketSnapshot | null,
): MarketRow[] {
  const kind = marketKindForMatch(match);
  const prices = marketSnapshot?.prices[kind] || {};

  return Array.from(new Set(leafTeamIds(match.number, matchByNumber)))
    .filter((teamId) => teamsById.has(teamId))
    .map((teamId) => {
      const code = fifaCode(teamId);
      return {
        code,
        label: teamsById.get(teamId)?.name || code,
        probability: prices[code] ?? null,
        teamId,
      };
    })
    .sort(
      (a, b) =>
        (b.probability ?? -1) - (a.probability ?? -1) ||
        a.label.localeCompare(b.label, "es", { sensitivity: "base" }),
    )
    .slice(0, 8);
}

function buildPopoverContent(
  activeId: string,
  matchByNumber: Map<number, Match>,
  marketSnapshot: MarketSnapshot | null,
  adminResults: AdminResults,
  chipPredictions: Prediction[],
): PopoverContent | null {
  if (activeId.startsWith("team:")) {
    const teamId = activeId.slice("team:".length);
    const team = teamsById.get(teamId);
    if (!team) return null;

    return {
      kind: "team",
      results: recentResultsForTeam(teamId, adminResults),
      subtitle: "Últimos resultados",
      teamId,
      title: team.name,
    };
  }

  const matchNumber =
    activeId === "champion" ? 104 : Number(activeId.replace("match-", ""));
  const match = matchByNumber.get(matchNumber);
  if (!match) return null;
  const chipPopularity = chipPopularityRows(match, chipPredictions);

  return {
    chipRows: chipPopularity.rows,
    chipTotal: chipPopularity.total,
    kind: "match",
    marketRows: marketRowsForMatch(match, matchByNumber, marketSnapshot),
    subtitle: `${match.stage} - ${formatPopoverMatchDate(match)}`,
    title: marketTitleForMatch(match),
  };
}

function TrophyIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-[55%] w-[55%]"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
    >
      <path d="M10 14.66v1.626a2 2 0 0 1-.976 1.696A5 5 0 0 0 7 21.978" />
      <path d="M14 14.66v1.626a2 2 0 0 0 .976 1.696A5 5 0 0 1 17 21.978" />
      <path d="M18 9h1.5a1 1 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z" />
      <path d="M6 9H4.5a1 1 0 0 1 0-5H6" />
    </svg>
  );
}

function FlagNode({
  fallback,
  selected,
  teamId,
}: {
  fallback: string;
  selected: boolean;
  teamId: string;
}) {
  const team = teamId ? teamsById.get(teamId) : null;

  return (
    <span
      className={`relative grid place-items-center rounded-full bg-[#171717] ring-1 transition ${
        selected
          ? "ring-[#a7f600]"
          : "ring-white/15 brightness-95 hover:brightness-110"
      }`}
      style={{
        height: "calc(var(--cf) * 0.85)",
        width: "calc(var(--cf) * 0.85)",
      }}
      title={team?.name || fallback}
    >
      {team ? (
        <TeamFlag teamId={team.id} className="h-full w-full rounded-full" />
      ) : (
        <span className="text-[10px] font-bold text-zinc-500">{fallback}</span>
      )}
    </span>
  );
}

function QuestionNode({ selected = false }: { selected?: boolean }) {
  return (
    <span
      className={`flex items-center justify-center rounded-full border bg-[#242424] font-semibold transition ${
        selected
          ? "border-[#a7f600] text-[#a7f600]"
          : "border-white/12 text-zinc-400"
      }`}
      style={{
        fontSize: "calc(var(--cf) * 0.36)",
        height: "calc(var(--cf) * 0.7)",
        width: "calc(var(--cf) * 0.7)",
      }}
    >
      ?
    </span>
  );
}

function FloatingBracketPopover({
  active,
  children,
  onClose,
}: {
  active: ActivePopover | null;
  children: ReactNode;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);

  useLayoutEffect(() => {
    if (!active) return;

    const place = () => {
      const panel = panelRef.current;
      if (!panel) return;
      if (!active.anchor.isConnected) {
        onClose();
        return;
      }

      const anchorRect = active.anchor.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const margin = 10;
      const gap = 10;
      const center = anchorRect.left + anchorRect.width / 2;
      const left = Math.min(
        Math.max(margin, center - panelRect.width / 2),
        window.innerWidth - panelRect.width - margin,
      );
      const topBelow = anchorRect.bottom + gap;
      const topAbove = anchorRect.top - panelRect.height - gap;
      const useAbove =
        topBelow + panelRect.height > window.innerHeight - margin &&
        topAbove > margin;

      setPlacement({
        arrowLeft: Math.min(Math.max(center - left, 16), panelRect.width - 16),
        left,
        side: useAbove ? "bottom" : "top",
        top: useAbove ? topAbove : topBelow,
      });
    };

    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [active, onClose]);

  useEffect(() => {
    if (!active) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        panelRef.current?.contains(target) ||
        active.anchor.contains(target)
      ) {
        return;
      }
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [active, onClose]);

  if (!active) return null;

  return createPortal(
    <div
      ref={panelRef}
      key={active.id}
      className="fixed z-50 animate-[bracket-pop-in_160ms_ease-out_both]"
      style={{
        left: placement?.left ?? 0,
        top: placement?.top ?? 0,
        visibility: placement ? "visible" : "hidden",
      }}
    >
      <div
        role="dialog"
        className="max-h-[70vh] w-[min(20rem,calc(100vw-1rem))] overflow-y-auto rounded-lg border border-white/15 bg-[#181818]/95 p-3 text-white shadow-2xl shadow-black/60 backdrop-blur"
      >
        {children}
      </div>
      {placement ? (
        <span
          aria-hidden="true"
          className={`absolute h-2 w-2 rotate-45 border-white/15 bg-[#181818] ${
            placement.side === "top"
              ? "-top-1 border-l border-t"
              : "-bottom-1 border-b border-r"
          }`}
          style={{ left: placement.arrowLeft - 4 }}
        />
      ) : null}
    </div>,
    document.body,
  );
}

function MarketStatRow({ row, top }: { row: MarketRow; top: boolean }) {
  const width =
    row.probability == null
      ? "0%"
      : `${Math.max(1, Math.round(row.probability * 100))}%`;

  return (
    <div className="flex h-6 items-center gap-2">
      <span className="inline-flex h-4 w-4 shrink-0 overflow-hidden rounded-full bg-white/10 ring-1 ring-white/10">
        <TeamFlag teamId={row.teamId} className="h-full w-full rounded-full" />
      </span>
      <span
        title={row.label}
        className={`w-8 shrink-0 text-[11px] font-bold tracking-wide ${
          top ? "text-white" : "text-zinc-400"
        }`}
      >
        {row.code}
      </span>
      <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-sm bg-white/[0.05]">
        <span
          className={`block h-full origin-left rounded-sm animate-[bracket-bar-grow_520ms_ease-out_both] ${
            top ? "bg-emerald-400" : "bg-zinc-500/60"
          }`}
          style={{ width }}
        />
      </span>
      <span
        className={`w-16 shrink-0 text-right text-[11px] tabular-nums ${
          top ? "font-bold text-white" : "text-zinc-400"
        }`}
      >
        {formatMarketPct(row.probability)}
      </span>
    </div>
  );
}

function ChipPopularitySection({
  rows,
  total,
}: {
  rows: ChipPopularityRow[];
  total: number;
}) {
  return (
    <div className="mt-3 border-t border-white/10 pt-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-xs font-semibold text-white">Chips elegidos</p>
        {total ? (
          <p className="text-[11px] text-zinc-500">{total} picks</p>
        ) : null}
      </div>
      {rows.length ? (
        <div className="space-y-1">
          {rows.map((row, index) => {
            const pct = Math.round(row.percentage * 100);
            return (
              <div
                key={`${row.teamId}-${row.tacticId}`}
                className="flex h-6 items-center gap-2"
              >
                <span className="inline-flex h-4 w-4 shrink-0 overflow-hidden rounded-full bg-white/10 ring-1 ring-white/10">
                  <TeamFlag
                    teamId={row.teamId}
                    className="h-full w-full rounded-full"
                  />
                </span>
                <span
                  className={`min-w-0 flex-1 truncate text-[11px] font-semibold ${
                    index === 0 ? "text-white" : "text-zinc-400"
                  }`}
                >
                  {row.tacticTitle}
                </span>
                <span className="h-2 w-16 shrink-0 overflow-hidden rounded-sm bg-white/[0.05]">
                  <span
                    className={`block h-full rounded-sm ${
                      index === 0 ? "bg-[#a7f600]" : "bg-zinc-500/60"
                    }`}
                    style={{ width: `${Math.max(1, pct)}%` }}
                  />
                </span>
                <span
                  className={`w-10 shrink-0 text-right text-[11px] tabular-nums ${
                    index === 0 ? "font-bold text-white" : "text-zinc-400"
                  }`}
                >
                  {pct}%
                </span>
                <span className="w-7 shrink-0 rounded-full bg-white/10 px-1.5 py-0.5 text-center text-[10px] font-bold text-zinc-300">
                  +{row.points}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-xs leading-5 text-zinc-500">
          Todavía no hay chips elegidos para este cruce.
        </p>
      )}
    </div>
  );
}

function TeamResultList({ results }: { results: TeamResultRow[] }) {
  if (!results.length) {
    return (
      <p className="text-xs leading-5 text-zinc-500">
        Todavía no hay resultados validados para este equipo.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {results.map((result) => {
        const outcomeClass =
          result.outcome === "G"
            ? "bg-emerald-400/15 text-emerald-300"
            : result.outcome === "E"
              ? "bg-zinc-500/20 text-zinc-300"
              : "bg-red-500/15 text-red-300";
        return (
          <div
            key={`${result.date}-${result.opponentId}-${result.for}-${result.against}`}
            className="flex min-h-8 items-center gap-2 rounded-md bg-white/[0.035] px-2 py-1.5"
          >
            <span
              className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-black ${outcomeClass}`}
            >
              {result.outcome}
            </span>
            <span className="w-10 shrink-0 text-[11px] font-semibold text-zinc-500">
              {result.date}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-zinc-300">
              {result.opponentId ? (
                <span className="mr-1 inline-flex h-3.5 w-3.5 translate-y-0.5 overflow-hidden rounded-full bg-white/10">
                  <TeamFlag
                    teamId={result.opponentId}
                    className="h-full w-full rounded-full"
                  />
                </span>
              ) : null}
              {result.opponentLabel}
            </span>
            <span className="shrink-0 text-xs font-bold tabular-nums text-white">
              {result.for}-{result.against}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function BracketPopoverBody({ content }: { content: PopoverContent }) {
  if (content.kind === "team") {
    return (
      <div>
        <div className="mb-3 flex items-center gap-2">
          <span className="inline-flex h-6 w-6 shrink-0 overflow-hidden rounded-full bg-white/10 ring-1 ring-white/10">
            <TeamFlag
              teamId={content.teamId}
              className="h-full w-full rounded-full"
            />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-5 text-white">
              {content.title}
            </p>
            <p className="text-xs text-zinc-500">{content.subtitle}</p>
          </div>
        </div>
        <TeamResultList results={content.results} />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2">
        <p className="text-sm font-semibold leading-5 text-white">
          {content.title}
        </p>
        <p className="text-xs text-zinc-500">{content.subtitle}</p>
      </div>
      <div className="space-y-1">
        {content.marketRows.map((row, index) => (
          <MarketStatRow key={row.code} row={row} top={index === 0} />
        ))}
      </div>
      <ChipPopularitySection rows={content.chipRows} total={content.chipTotal} />
    </div>
  );
}

function CircularBracketDemo({
  adminResults,
  chipPredictions,
  className = "",
  geometry,
  matches,
  prediction,
  unframed = false,
}: {
  adminResults: AdminResults;
  chipPredictions: Prediction[];
  className?: string;
  geometry: Geometry;
  matches: Match[];
  prediction: Prediction;
  unframed?: boolean;
}) {
  const matchByNumber = useMemo(
    () => new Map(matches.map((match) => [match.number, match])),
    [matches],
  );
  const state = useMemo(
    () => buildBracketState(adminResults, matches, geometry, prediction),
    [adminResults, geometry, matches, prediction],
  );
  const [activePopover, setActivePopover] = useState<ActivePopover | null>(null);
  const [marketSnapshot, setMarketSnapshot] = useState<MarketSnapshot | null>(
    null,
  );
  const popoverContent = activePopover
    ? buildPopoverContent(
        activePopover.id,
        matchByNumber,
        marketSnapshot,
        adminResults,
        chipPredictions,
      )
    : null;
  const closePopover = useCallback(() => setActivePopover(null), []);
  const togglePopover = useCallback((id: string, anchor: HTMLElement) => {
    setActivePopover((current) =>
      current?.id === id ? null : { anchor, id },
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/worldcup-eve/markets")
      .then((response) => (response.ok ? response.json() : null))
      .then((snapshot: MarketSnapshot | null) => {
        if (!cancelled && snapshot?.prices) setMarketSnapshot(snapshot);
      })
      .catch(() => {
        if (!cancelled) setMarketSnapshot(null);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      className={`w-full overflow-hidden text-white ${
        unframed ? "" : "rounded-lg bg-black p-4 sm:p-6"
      } ${className}`}
    >
      <div className="relative mx-auto aspect-square w-full max-w-[620px] [--cf:clamp(18px,7.2cqw,40px)] [container-type:inline-size]">
        <svg
          aria-hidden="true"
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="absolute inset-0 h-full w-full overflow-visible"
        >
          {geometry.arcs.map((arc) => (
            <path
              key={arc.key}
              d={arc.d}
              fill="none"
              stroke={
                arc.active || state.activePaths.has(arc.key)
                  ? "#10b981"
                  : "rgba(255,255,255,0.16)"
              }
              strokeWidth="2.5"
            />
          ))}
          {geometry.segments.map((segment) => (
            <line
              key={segment.key}
              x1={segment.x1}
              x2={segment.x2}
              y1={segment.y1}
              y2={segment.y2}
              stroke={
                segment.active || state.activePaths.has(segment.key)
                  ? "#10b981"
                  : "rgba(255,255,255,0.16)"
              }
              strokeLinecap="round"
              strokeWidth="2.5"
            />
          ))}
        </svg>

        {geometry.nodes.map((node) => {
          const match = matchByNumber.get(node.match);
          const winner = state.nodeWinners.get(node.match) || "";
          const popoverId = `match-${node.match}`;
          const active = activePopover?.id === popoverId;
          return (
            <button
              key={`match-${node.match}`}
              type="button"
              aria-expanded={active}
              aria-haspopup="dialog"
              aria-label={
                match
                  ? `Ver opciones de ${match.stage} ${formatPopoverMatchDate(match)}`
                  : "Ver opciones del cruce"
              }
              onClick={(event) => togglePopover(popoverId, event.currentTarget)}
              className="absolute z-20 -translate-x-1/2 -translate-y-1/2 rounded-full outline-none transition hover:scale-110 focus-visible:ring-2 focus-visible:ring-[#a7f600]"
              style={positionStyle(node)}
            >
              {winner ? (
                <FlagNode fallback="" selected teamId={winner} />
              ) : (
                <QuestionNode selected={active} />
              )}
            </button>
          );
        })}

        {state.flags.map((flag) => {
          const team = flag.teamId ? teamsById.get(flag.teamId) : null;
          const popoverId = team ? `team:${team.id}` : "";
          const active = activePopover?.id === popoverId;

          if (!team) {
            return (
              <span
                key={`flag-${flag.match}-${flag.side}`}
                className="absolute z-30 -translate-x-1/2 -translate-y-1/2"
                style={positionStyle(flag)}
              >
                <FlagNode
                  fallback={flag.fallback}
                  selected={flag.selected}
                  teamId={flag.teamId}
                />
              </span>
            );
          }

          return (
            <button
              key={`flag-${flag.match}-${flag.side}`}
              type="button"
              aria-expanded={active}
              aria-haspopup="dialog"
              aria-label={`Ver últimos resultados de ${team.name}`}
              onClick={(event) => togglePopover(popoverId, event.currentTarget)}
              className="absolute z-30 -translate-x-1/2 -translate-y-1/2 rounded-full outline-none transition hover:scale-110 focus-visible:ring-2 focus-visible:ring-[#a7f600]"
              style={positionStyle(flag)}
            >
              <FlagNode
                fallback={flag.fallback}
                selected={flag.selected || active}
                teamId={flag.teamId}
              />
            </button>
          );
        })}

        <button
          type="button"
          aria-expanded={activePopover?.id === "champion"}
          aria-haspopup="dialog"
          aria-label="Ver opciones de campeonar"
          onClick={(event) => togglePopover("champion", event.currentTarget)}
          className="absolute z-30 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-emerald-500/50 bg-[#07130f] text-emerald-400"
          style={{
            height: "var(--cf)",
            left: "50%",
            top: "50%",
            width: "var(--cf)",
          }}
        >
          {state.champion ? (
            <FlagNode fallback="" selected teamId={state.champion} />
          ) : (
            <TrophyIcon />
          )}
        </button>
      </div>
      <FloatingBracketPopover active={activePopover} onClose={closePopover}>
        {popoverContent ? (
          <BracketPopoverBody content={popoverContent} />
        ) : null}
      </FloatingBracketPopover>
    </div>
  );
}

export function CircularBracketPanel({
  className = "",
  unframed = false,
}: {
  className?: string;
  unframed?: boolean;
}) {
  const {
    adminResults,
    leaderboard,
    prediction: currentPrediction,
  } = useAppContext();
  const [prediction] = useState<Prediction>(() => emptyPrediction());
  const playoffMatches = useMemo(
    () => schedule.filter((match) => match.number >= 73),
    [],
  );
  const geometry = useMemo(() => buildGeometry(playoffMatches), [playoffMatches]);
  const chipPredictions = useMemo(() => {
    const predictions = leaderboard
      .map((profile) => profile.prediction)
      .filter((item): item is Prediction => Boolean(item));

    return predictions.length ? predictions : [currentPrediction];
  }, [currentPrediction, leaderboard]);

  return (
    <CircularBracketDemo
      adminResults={adminResults}
      chipPredictions={chipPredictions}
      className={className}
      geometry={geometry}
      matches={playoffMatches}
      prediction={prediction}
      unframed={unframed}
    />
  );
}

export function CircularBracketDemoView() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <SectionHeading eyebrow="Demo" title="Cuadro circular" />
      <CircularBracketPanel />
    </main>
  );
}
