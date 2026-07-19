import type { FinalElectionResults } from "@/lib/types";

export function emptyFinalElectionResults(): FinalElectionResults {
  return {
    worldChampion: "",
    highestScoringTeam: [],
    mostConcededTeam: [],
    mostRedsTeam: [],
    topScorer: "",
    mvp: "",
  };
}

function normalizeSingle(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTeamList(value: unknown) {
  const rows = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.startsWith("{") && value.endsWith("}")
        ? value.slice(1, -1).split(",")
        : [value]
      : [];

  return Array.from(
    new Set(
      rows
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

export function normalizeFinalElectionResults(
  value?: Record<string, unknown> | Partial<FinalElectionResults> | null,
): FinalElectionResults {
  if (!value) return emptyFinalElectionResults();

  return {
    worldChampion: normalizeSingle(value.worldChampion),
    highestScoringTeam: normalizeTeamList(value.highestScoringTeam),
    mostConcededTeam: normalizeTeamList(value.mostConcededTeam),
    mostRedsTeam: normalizeTeamList(value.mostRedsTeam),
    topScorer: normalizeSingle(value.topScorer),
    mvp: normalizeSingle(value.mvp),
  };
}

export function areFinalElectionResultsComplete(
  value?: Partial<FinalElectionResults> | null,
) {
  const normalized = normalizeFinalElectionResults(value);
  return (
    Boolean(normalized.worldChampion) &&
    normalized.highestScoringTeam.length > 0 &&
    normalized.mostConcededTeam.length > 0 &&
    normalized.mostRedsTeam.length > 0 &&
    Boolean(normalized.topScorer) &&
    Boolean(normalized.mvp)
  );
}

export function finalElectionResultsFromRow(
  row?: Record<string, unknown> | null,
): FinalElectionResults {
  return normalizeFinalElectionResults({
    worldChampion: row?.world_champion_team_id,
    highestScoringTeam: row?.highest_scoring_team_id,
    mostConcededTeam: row?.most_conceded_team_id,
    mostRedsTeam: row?.most_reds_team_id,
    topScorer: row?.top_scorer_player_id,
    mvp: row?.mvp_player_id,
  });
}
