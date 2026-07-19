import type { FinalElectionResults } from "@/lib/types";

export function emptyFinalElectionResults(): FinalElectionResults {
  return {
    worldChampion: "",
    highestScoringTeam: "",
    mostConcededTeam: "",
    mostRedsTeam: "",
    topScorer: "",
    mvp: "",
  };
}

export function normalizeFinalElectionResults(
  value?: Partial<FinalElectionResults> | null,
): FinalElectionResults {
  const empty = emptyFinalElectionResults();
  if (!value) return empty;

  return Object.fromEntries(
    Object.keys(empty).map((key) => [
      key,
      typeof value[key as keyof FinalElectionResults] === "string"
        ? value[key as keyof FinalElectionResults]
        : "",
    ]),
  ) as FinalElectionResults;
}

export function areFinalElectionResultsComplete(
  value?: Partial<FinalElectionResults> | null,
) {
  return Object.values(normalizeFinalElectionResults(value)).every(Boolean);
}

export function finalElectionResultsFromRow(
  row?: Record<string, unknown> | null,
): FinalElectionResults {
  return normalizeFinalElectionResults({
    worldChampion: String(row?.world_champion_team_id || ""),
    highestScoringTeam: String(row?.highest_scoring_team_id || ""),
    mostConcededTeam: String(row?.most_conceded_team_id || ""),
    mostRedsTeam: String(row?.most_reds_team_id || ""),
    topScorer: String(row?.top_scorer_player_id || ""),
    mvp: String(row?.mvp_player_id || ""),
  });
}
