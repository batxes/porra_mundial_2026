import { data, knockoutMatches, schedule, teamsById } from "@/lib/data";
import type { AdminResult, AdminResults, Match, Prediction } from "@/lib/types";

export type GroupRow = {
  teamId: string;
  pts: number;
  gf: number;
  ga: number;
  gd: number;
  position: number;
};

export type GroupTable = {
  complete: boolean;
  positions: GroupRow[];
};

export type ResolvedPlayoffTeams = Record<
  string,
  { home?: string; away?: string }
>;

const thirdMatchNumbersByGroupWinner: Record<string, string> = {
  A: "79",
  B: "85",
  D: "81",
  E: "74",
  G: "82",
  I: "77",
  K: "87",
  L: "80",
};

const thirdGroupWinnerByMatchNumber = Object.fromEntries(
  Object.entries(thirdMatchNumbersByGroupWinner).map(([group, matchNumber]) => [
    matchNumber,
    group,
  ]),
) as Record<string, string>;

// FIFA Regulations Annex C, current real row for the 2026 Round of 32:
// third-place qualifiers from B/D/E/F/I/J/K/L.
const thirdSlotOverridesByQualifierSet: Record<string, Record<string, string>> =
  {
    BDEFIJKL: {
      "79": "E",
      "85": "J",
      "81": "B",
      "74": "D",
      "82": "I",
      "77": "F",
      "87": "L",
      "80": "K",
    },
  };

function parseScore(value: number | string | null | undefined) {
  if (value === "" || value === null || value === undefined) return null;
  const score = Number(value);
  return Number.isFinite(score) && score >= 0 ? score : null;
}

function isScored(result: AdminResults[string] | undefined) {
  return parseScore(result?.homeScore) !== null && parseScore(result?.awayScore) !== null;
}

function teamName(teamId: string) {
  return teamsById.get(teamId)?.name || teamId;
}

function actualTeamId(
  match: Match,
  result: AdminResults[string] | undefined,
  side: "home" | "away",
) {
  const override = result?.[`${side}TeamId`];
  if (override && teamsById.has(override)) return override;

  const scheduled = match[side];
  return teamsById.has(scheduled) ? scheduled : "";
}

export function calculateGroupTables(adminResults: AdminResults) {
  const byGroup: Record<
    string,
    {
      teams: Map<string, Omit<GroupRow, "position">>;
      playedMatches: number;
      expectedMatches: number;
    }
  > = {};

  data.teams.forEach((team) => {
    byGroup[team.group] ||= {
      teams: new Map(),
      playedMatches: 0,
      expectedMatches: 0,
    };
    byGroup[team.group].teams.set(team.id, {
      teamId: team.id,
      pts: 0,
      gf: 0,
      ga: 0,
      gd: 0,
    });
  });

  schedule
    .filter((match) => match.stage === "Grupos")
    .forEach((match) => {
      const result = adminResults[String(match.number)];
      const home = actualTeamId(match, result, "home");
      const away = actualTeamId(match, result, "away");
      const group = teamsById.get(home)?.group;

      if (!group || group !== teamsById.get(away)?.group) return;
      byGroup[group].expectedMatches += 1;
      if (!isScored(result)) return;

      const homeRow = byGroup[group].teams.get(home);
      const awayRow = byGroup[group].teams.get(away);
      if (!homeRow || !awayRow) return;

      const homeScore = parseScore(result?.homeScore) ?? 0;
      const awayScore = parseScore(result?.awayScore) ?? 0;
      byGroup[group].playedMatches += 1;

      homeRow.gf += homeScore;
      homeRow.ga += awayScore;
      awayRow.gf += awayScore;
      awayRow.ga += homeScore;
      homeRow.gd = homeRow.gf - homeRow.ga;
      awayRow.gd = awayRow.gf - awayRow.ga;

      if (homeScore > awayScore) homeRow.pts += 3;
      else if (awayScore > homeScore) awayRow.pts += 3;
      else {
        homeRow.pts += 1;
        awayRow.pts += 1;
      }
    });

  return Object.fromEntries(
    Object.entries(byGroup).map(([group, table]) => {
      const positions = Array.from(table.teams.values())
        .sort(
          (a, b) =>
            b.pts - a.pts ||
            b.gd - a.gd ||
            b.gf - a.gf ||
            teamName(a.teamId).localeCompare(teamName(b.teamId)),
        )
        .map((row, index) => ({ ...row, position: index + 1 }));

      return [
        group,
        {
          complete:
            table.expectedMatches === 6 &&
            table.playedMatches === table.expectedMatches,
          positions,
        },
      ];
    }),
  ) as Record<string, GroupTable>;
}

function thirdSlotOptions(match: Match) {
  const slot = match.home.startsWith("3rd Group")
    ? match.home
    : match.away.startsWith("3rd Group")
      ? match.away
      : "";

  return slot ? slot.replace("3rd Group ", "").split("/") : [];
}

function assignThirdSlots(qualifiers: string[]) {
  const qualifierSet = qualifiers.slice().sort().join("");
  const override = thirdSlotOverridesByQualifierSet[qualifierSet];
  if (override) return { ...override };

  const assignments: Record<string, string> = {};
  const variableMatches = knockoutMatches
    .map((match) => ({
      number: String(match.number),
      allowed: thirdSlotOptions(match),
      groupWinner: thirdGroupWinnerByMatchNumber[String(match.number)] || "",
    }))
    .filter((match) => match.allowed.length)
    .sort(
      (a, b) =>
        a.allowed.length - b.allowed.length ||
        a.groupWinner.localeCompare(b.groupWinner) ||
        Number(a.number) - Number(b.number),
    );

  function assign(index: number, used: Set<string>) {
    if (index === variableMatches.length) return true;

    const match = variableMatches[index];
    for (const group of qualifiers) {
      if (used.has(group) || !match.allowed.includes(group)) continue;

      assignments[match.number] = group;
      used.add(group);
      if (assign(index + 1, used)) return true;

      used.delete(group);
      delete assignments[match.number];
    }

    return false;
  }

  return assign(0, new Set()) ? assignments : {};
}

function bestThirdGroups(groupTables: Record<string, GroupTable>) {
  const tables = Object.entries(groupTables);
  if (!tables.length || tables.some(([, table]) => !table.complete)) return [];

  return tables
    .map(([group, table]) => ({
      group,
      row: table.positions.find((candidate) => candidate.position === 3),
    }))
    .filter((item): item is { group: string; row: GroupRow } => Boolean(item.row))
    .sort(
      (a, b) =>
        b.row.pts - a.row.pts ||
        b.row.gd - a.row.gd ||
        b.row.gf - a.row.gf ||
        teamName(a.row.teamId).localeCompare(teamName(b.row.teamId)),
    )
    .slice(0, 8)
    .map((item) => item.group);
}

function teamAt(groupTables: Record<string, GroupTable>, group: string, position: number) {
  const table = groupTables[group];
  if (!table?.complete) return "";
  return table.positions.find((row) => row.position === position)?.teamId || "";
}

function resultWinner(
  matchNumber: number,
  resolved: ResolvedPlayoffTeams,
  adminResults: AdminResults,
  outcome: "winner" | "loser",
) {
  const result = adminResults[String(matchNumber)];
  if (!isScored(result)) return "";

  const homeScore = parseScore(result?.homeScore) ?? 0;
  const awayScore = parseScore(result?.awayScore) ?? 0;
  if (homeScore === awayScore) return "";

  const teams = resolved[String(matchNumber)];
  const home = result?.homeTeamId || teams?.home || "";
  const away = result?.awayTeamId || teams?.away || "";
  const homeWon = homeScore > awayScore;

  return outcome === "winner"
    ? homeWon
      ? home
      : away
    : homeWon
      ? away
      : home;
}

function predictionWinner(
  matchNumber: number,
  resolved: ResolvedPlayoffTeams,
  prediction: Prediction,
  outcome: "winner" | "loser",
) {
  const result = prediction.matchPredictions[String(matchNumber)];
  if (!result) return "";

  const homeScore = parseScore(result.homeScore);
  const awayScore = parseScore(result.awayScore);
  if (homeScore === null || awayScore === null || homeScore === awayScore) {
    return "";
  }

  const teams = resolved[String(matchNumber)];
  const home = teams?.home || "";
  const away = teams?.away || "";
  const homeWon = homeScore > awayScore;

  return outcome === "winner"
    ? homeWon
      ? home
      : away
    : homeWon
      ? away
      : home;
}

function resolveSlot(
  slot: string,
  matchNumber: number,
  groupTables: Record<string, GroupTable>,
  thirdSlots: Record<string, string>,
  resolved: ResolvedPlayoffTeams,
  adminResults: AdminResults,
  prediction?: Prediction,
) {
  if (teamsById.has(slot)) return slot;

  let match = slot.match(/^Winner Group ([A-L])$/);
  if (match) return teamAt(groupTables, match[1], 1);

  match = slot.match(/^Runner-up Group ([A-L])$/);
  if (match) return teamAt(groupTables, match[1], 2);

  match = slot.match(/^Winner Match (\d+)$/);
  if (match) {
    return (
      resultWinner(Number(match[1]), resolved, adminResults, "winner") ||
      (prediction
        ? predictionWinner(Number(match[1]), resolved, prediction, "winner")
        : "")
    );
  }

  match = slot.match(/^Loser Match (\d+)$/);
  if (match) {
    return (
      resultWinner(Number(match[1]), resolved, adminResults, "loser") ||
      (prediction
        ? predictionWinner(Number(match[1]), resolved, prediction, "loser")
        : "")
    );
  }

  if (slot.startsWith("3rd Group")) {
    const group = thirdSlots[String(matchNumber)];
    return group ? teamAt(groupTables, group, 3) : "";
  }

  return "";
}

function validSavedTeam(result: AdminResult | undefined, side: "home" | "away") {
  const teamId = result?.[`${side}TeamId`];
  return teamId && teamsById.has(teamId) ? teamId : "";
}

export function buildResolvedPlayoffTeams(
  adminResults: AdminResults,
  prediction?: Prediction,
): ResolvedPlayoffTeams {
  const groupTables = calculateGroupTables(adminResults);
  const thirdSlots = assignThirdSlots(bestThirdGroups(groupTables));
  const resolved: ResolvedPlayoffTeams = {};

  knockoutMatches
    .slice()
    .sort((a, b) => a.number - b.number)
    .forEach((match) => {
      const result = adminResults[String(match.number)];
      const savedHome = validSavedTeam(result, "home");
      const savedAway = validSavedTeam(result, "away");
      const home =
        savedHome ||
        resolveSlot(
          match.home,
          match.number,
          groupTables,
          thirdSlots,
          resolved,
          adminResults,
          prediction,
        );
      const away =
        savedAway ||
        resolveSlot(
          match.away,
          match.number,
          groupTables,
          thirdSlots,
          resolved,
          adminResults,
          prediction,
        );

      if (home || away) {
        resolved[String(match.number)] = {
          ...(home ? { home } : {}),
          ...(away ? { away } : {}),
        };
      }
    });

  return resolved;
}

export function buildPredictionPlayoffTeams(
  adminResults: AdminResults,
  prediction: Prediction,
) {
  return buildResolvedPlayoffTeams(adminResults, prediction);
}
