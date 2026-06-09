import { data, extraPredictionFields, knockoutMatches, playersById, schedule, teamsById, xiDefaultFormation, xiFormations } from "@/lib/data";
import type { Match, Position, Prediction } from "@/lib/types";

export function emptyPrediction(): Prediction {
  const groups: Prediction["groups"] = {};

  data.teams.forEach((team) => {
    groups[team.group] ||= {};
    groups[team.group][team.id] = "";
  });

  return {
    groups,
    bracket: { thirdQualifiers: [], thirdSlots: {}, winners: {} },
    matchPredictions: {},
    extras: {
      worldChampion: "",
      highestScoringTeam: "",
      topScorer: "",
      mostConcededTeam: "",
      mostRedsTeam: "",
      fewestRedsTeam: "",
      mvp: "",
    },
    xi: [],
    xiFormation: xiDefaultFormation,
    isDefinitive: false,
    updatedAt: null,
  };
}

export function normalizePrediction(prediction?: Partial<Prediction> | null): Prediction {
  const initial = emptyPrediction();
  const xiFormation = normalizeXiFormation(prediction?.xiFormation);
  const extras = { ...initial.extras, ...(prediction?.extras || {}) };
  if (!extras.worldChampion) {
    extras.worldChampion = prediction?.bracket?.winners?.["104"] || "";
  }
  return {
    ...initial,
    ...prediction,
    groups: { ...initial.groups, ...(prediction?.groups || {}) },
    bracket: {
      thirdQualifiers: prediction?.bracket?.thirdQualifiers || [],
      thirdSlots: prediction?.bracket?.thirdSlots || {},
      winners: prediction?.bracket?.winners || {},
    },
    matchPredictions: { ...(prediction?.matchPredictions || {}) },
    extras,
    xi: sanitizeXiForFormation(Array.isArray(prediction?.xi) ? prediction.xi : [], xiFormation),
    xiFormation,
  };
}

export function orderedGroupTeams(group: string, prediction: Prediction) {
  const fallbackTeams = data.teams.filter((team) => team.group === group);
  const positions = prediction.groups[group] || {};
  const rows = fallbackTeams.map((team, fallbackIndex) => ({
    team,
    fallbackIndex,
    position: Number(positions[team.id] || 99),
  }));

  rows.sort((a, b) => a.position - b.position || a.fallbackIndex - b.fallbackIndex);
  return rows.map((row) => row.team);
}

export function setGroupOrder(prediction: Prediction, group: string, teamIds: string[]) {
  const next = structuredClone(prediction);
  next.groups[group] ||= {};
  teamIds.forEach((teamId, index) => {
    next.groups[group][teamId] = String(index + 1);
  });
  return sanitizeBracket(next);
}

export function moveGroupTeam(prediction: Prediction, group: string, teamId: string, direction: number) {
  const ordered = orderedGroupTeams(group, prediction).map((team) => team.id);
  const index = ordered.indexOf(teamId);
  const nextIndex = index + Number(direction);

  if (index < 0 || nextIndex < 0 || nextIndex >= ordered.length) {
    return prediction;
  }

  const [moved] = ordered.splice(index, 1);
  ordered.splice(nextIndex, 0, moved);
  return setGroupOrder(prediction, group, ordered);
}

export function groupTeamAt(group: string, position: number, prediction: Prediction) {
  return Object.entries(prediction.groups[group] || {}).find(([, value]) => String(value) === String(position))?.[0] || "";
}

export function scheduleUtc(match: Match) {
  const time = match.time.match(/^(\d+):(\d+) ([ap])\.m\. UTC([+-]\d+)$/);
  if (!time) return `${match.date}T12:00:00Z`;
  const [, rawHour, rawMinute, meridiem, rawOffset] = time;
  let hour = Number(rawHour) % 12;
  if (meridiem === "p") hour += 12;
  const [year, month, day] = match.date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour - Number(rawOffset), Number(rawMinute))).toISOString();
}

export function hasMatchStarted(match: Match) {
  return Date.now() >= new Date(scheduleUtc(match)).getTime();
}

export function hasTournamentStarted() {
  const lockAt = data.tournament.lockAt || scheduleUtc(schedule[0]);
  return Date.now() >= new Date(lockAt).getTime();
}

export function loserForMatch(matchNumber: number, prediction: Prediction): string {
  const match = knockoutMatches.find((candidate) => candidate.number === Number(matchNumber));
  if (!match) return "";
  const home = resolveSlot(match.home, match.number, prediction);
  const away = resolveSlot(match.away, match.number, prediction);
  const winner = prediction.bracket?.winners?.[String(match.number)];

  if (!home || !away || !winner) return "";
  return winner === home ? away : home;
}

export function resolveSlot(slot: string, matchNumber: number, prediction: Prediction): string {
  if (teamsById.has(slot)) return slot;

  let match = String(slot).match(/^Winner Group ([A-L])$/);
  if (match) return groupTeamAt(match[1], 1, prediction);

  match = String(slot).match(/^Runner-up Group ([A-L])$/);
  if (match) return groupTeamAt(match[1], 2, prediction);

  match = String(slot).match(/^Winner Match (\d+)$/);
  if (match) return prediction.bracket?.winners?.[match[1]] || "";

  match = String(slot).match(/^Loser Match (\d+)$/);
  if (match) return loserForMatch(Number(match[1]), prediction);

  if (String(slot).startsWith("3rd Group")) {
    const group = prediction.bracket?.thirdSlots?.[String(matchNumber)];
    return group ? groupTeamAt(group, 3, prediction) : "";
  }

  return "";
}

export function resolvedMatchTeams(match: Match, prediction: Prediction) {
  return {
    home: resolveSlot(match.home, match.number, prediction),
    away: resolveSlot(match.away, match.number, prediction),
  };
}

export function isMatchVisibleForPrediction(match: Match, prediction: Prediction) {
  const { home, away } = resolvedMatchTeams(match, prediction);
  return Boolean(home && away);
}

export function isMatchPredictionComplete(match: Match, prediction: Prediction) {
  const matchPrediction = prediction.matchPredictions[String(match.number)];
  return Boolean(
    matchPrediction &&
      matchPrediction.homeScore !== undefined &&
      matchPrediction.homeScore !== "" &&
      matchPrediction.awayScore !== undefined &&
      matchPrediction.awayScore !== "",
  );
}

function sanitizeBracket(prediction: Prediction) {
  const next = structuredClone(prediction);
  const bracket = next.bracket;

  bracket.thirdQualifiers = bracket.thirdQualifiers.filter((group) => groupTeamAt(group, 3, next));

  Object.entries(bracket.thirdSlots).forEach(([matchNumber, group]) => {
    const match = knockoutMatches.find((candidate) => String(candidate.number) === String(matchNumber));
    const allowed = match?.away.startsWith("3rd Group") ? match.away.replace("3rd Group ", "").split("/") : [];
    if (!bracket.thirdQualifiers.includes(group) || !allowed.includes(group)) {
      delete bracket.thirdSlots[matchNumber];
    }
  });

  knockoutMatches.forEach((match) => {
    const winner = bracket.winners[String(match.number)];
    const candidates = [resolveSlot(match.home, match.number, next), resolveSlot(match.away, match.number, next)];
    if (winner && !candidates.includes(winner)) {
      delete bracket.winners[String(match.number)];
    }
  });

  Object.keys(next.matchPredictions || {}).forEach((matchNumber) => {
    const match = schedule.find((candidate) => String(candidate.number) === String(matchNumber));
    if (!match || !isMatchVisibleForPrediction(match, next)) {
      delete next.matchPredictions[matchNumber];
    }
  });

  return next;
}

function autoAssignThirdSlots(prediction: Prediction) {
  const next = structuredClone(prediction);
  next.bracket.thirdSlots = {};

  if (next.bracket.thirdQualifiers.length !== 8) {
    return next;
  }

  const variableMatches = knockoutMatches
    .filter((match) => match.home.startsWith("3rd Group") || match.away.startsWith("3rd Group"))
    .map((match) => {
      const slot = match.home.startsWith("3rd Group") ? match.home : match.away;
      return { number: String(match.number), allowed: slot.replace("3rd Group ", "").split("/") };
    })
    .sort((a, b) => a.allowed.length - b.allowed.length);

  function assign(index: number, used: Set<string>) {
    if (index === variableMatches.length) {
      return true;
    }

    const match = variableMatches[index];

    for (const group of next.bracket.thirdQualifiers) {
      if (used.has(group) || !match.allowed.includes(group)) {
        continue;
      }

      next.bracket.thirdSlots[match.number] = group;
      used.add(group);

      if (assign(index + 1, used)) {
        return true;
      }

      used.delete(group);
      delete next.bracket.thirdSlots[match.number];
    }

    return false;
  }

  assign(0, new Set());
  return next;
}

export function toggleThirdQualifier(prediction: Prediction, group: string) {
  if (!groupTeamAt(group, 3, prediction)) return prediction;

  const next = structuredClone(prediction);
  const selected = next.bracket.thirdQualifiers;

  if (selected.includes(group)) {
    next.bracket.thirdQualifiers = selected.filter((candidate) => candidate !== group);
  } else if (selected.length < 8) {
    selected.push(group);
  }

  return sanitizeBracket(autoAssignThirdSlots(next));
}

export function chooseMatchWinner(prediction: Prediction, matchNumber: number, teamId: string) {
  if (!teamId) return prediction;
  const next = structuredClone(prediction);
  next.bracket.winners[String(matchNumber)] = teamId;
  return sanitizeBracket(next);
}

export function setPredictionMatchScore(
  prediction: Prediction,
  matchNumber: number,
  side: "homeScore" | "awayScore",
  value: string,
) {
  const next = structuredClone(prediction);
  next.matchPredictions[String(matchNumber)] ||= { homeScore: "", awayScore: "" };
  next.matchPredictions[String(matchNumber)][side] = value.replace(/[^\d]/g, "").slice(0, 2);
  return next;
}

export function setPredictionExtra(prediction: Prediction, key: keyof Prediction["extras"], value: string) {
  const next = structuredClone(prediction);
  next.extras[key] = value;
  return next;
}

export function normalizeXiFormation(formation?: string | null) {
  return xiFormations.includes(formation as (typeof xiFormations)[number]) ? String(formation) : xiDefaultFormation;
}

export function xiRequirements(formation = xiDefaultFormation) {
  const lines = normalizeXiFormation(formation).split("-").map(Number);
  const midfielders = lines.slice(1, -1).reduce((total, count) => total + count, 0);

  return {
    POR: 1,
    DEF: lines[0] || 4,
    MED: midfielders || 4,
    DEL: lines[lines.length - 1] || 2,
  } satisfies Record<Position, number>;
}

function xiSlotPositions(formation = xiDefaultFormation): Position[] {
  const lines = normalizeXiFormation(formation).split("-").map(Number);
  const defense = lines[0] || 4;
  const attack = lines[lines.length - 1] || 2;
  const midfield = lines.slice(1, -1).reverse();

  return [
    ...Array<Position>(attack).fill("DEL"),
    ...midfield.flatMap((count) => Array<Position>(count).fill("MED")),
    ...Array<Position>(defense).fill("DEF"),
    "POR",
  ];
}

export function sanitizeXiForFormation(playerIds: string[], formation = xiDefaultFormation) {
  const slotPositions = xiSlotPositions(formation);
  const isPositionalSelection = playerIds.length >= slotPositions.length || playerIds.some((playerId) => !playerId);
  const seen = new Set<string>();
  const clean = Array(slotPositions.length).fill("");
  const deferred: string[] = [];

  if (isPositionalSelection) {
    playerIds.forEach((playerId, index) => {
      const player = playersById.get(playerId);
      if (!player || seen.has(playerId)) return;

      if (index < slotPositions.length && player.position === slotPositions[index]) {
        clean[index] = playerId;
        seen.add(playerId);
        return;
      }

      deferred.push(playerId);
    });

    deferred.forEach((playerId) => {
      const player = playersById.get(playerId);
      const openSlotIndex = player
        ? slotPositions.findIndex((position, index) => !clean[index] && position === player.position)
        : -1;

      if (openSlotIndex === -1 || seen.has(playerId)) return;
      clean[openSlotIndex] = playerId;
      seen.add(playerId);
    });

    return clean;
  }

  playerIds.forEach((playerId) => {
    const player = playersById.get(playerId);
    const openSlotIndex = player
      ? slotPositions.findIndex((position, index) => !clean[index] && position === player.position)
      : -1;

    if (openSlotIndex === -1 || seen.has(playerId)) return;
    clean[openSlotIndex] = playerId;
    seen.add(playerId);
  });

  return clean.filter(Boolean);
}

export function setXiFormation(prediction: Prediction, formation: string) {
  const next = structuredClone(prediction);
  next.xiFormation = normalizeXiFormation(formation);
  next.xi = sanitizeXiForFormation(next.xi, next.xiFormation);
  return next;
}

export function setXiSelection(prediction: Prediction, playerIds: string[]) {
  const next = structuredClone(prediction);
  next.xi = sanitizeXiForFormation(playerIds, next.xiFormation);
  return next;
}

export function xiCounts(prediction: Prediction) {
  return prediction.xi.reduce<Record<Position, number>>(
    (counts, playerId) => {
      const position = playersById.get(playerId)?.position;
      if (position) counts[position] += 1;
      return counts;
    },
    { POR: 0, DEF: 0, MED: 0, DEL: 0 },
  );
}

export function toggleXi(prediction: Prediction, playerId: string) {
  const next = structuredClone(prediction);
  const selected = next.xi;

  if (selected.includes(playerId)) {
    next.xi = selected.filter((id) => id !== playerId);
    return next;
  }

  const player = playersById.get(playerId);
  if (player && xiCounts(next)[player.position] < xiRequirements(next.xiFormation)[player.position]) {
    selected.push(playerId);
  }

  return next;
}

export function calculateCompletion(prediction: Prediction) {
  const groupDone = Object.values(prediction.groups).reduce((total, group) => {
    const positions = Object.values(group).filter(Boolean);
    return total + (positions.length === 4 && new Set(positions).size === 4 ? 1 : 0);
  }, 0);
  const visibleMatches = schedule.filter((match) => isMatchVisibleForPrediction(match, prediction));
  const resultsDone = visibleMatches.filter((match) => isMatchPredictionComplete(match, prediction)).length;
  const extrasDone = extraPredictionFields.filter((key) => Boolean(prediction.extras[key])).length;
  const counts = xiCounts(prediction);
  const requirements = xiRequirements(prediction.xiFormation);
  const xiDone = Object.entries(requirements).every(([position, limit]) => counts[position as Position] === limit) ? 1 : 0;
  const completedUnits = groupDone + resultsDone + extrasDone + xiDone;
  const totalUnits = 12 + visibleMatches.length + extraPredictionFields.length + 1;

  return Math.round((completedUnits / totalUnits) * 100);
}
