import { schedule } from "@/lib/data";
import type { AdminResult, AdminResults, Match, UserProfile } from "@/lib/types";

function hasCompletedScore(result?: AdminResult) {
  return (
    result != null &&
    result.homeScore !== "" &&
    result.homeScore != null &&
    result.awayScore !== "" &&
    result.awayScore != null
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

export function latestLeaderboardMovements(
  profiles: UserProfile[],
  results: AdminResults,
  matches: Match[] = schedule,
): Map<string, number> {
  const latestDate = matches
    .filter((match) => {
      const result = results[String(match.number)];
      return isFinishedResult(result) && hasCompletedScore(result);
    })
    .map((match) => match.date)
    .sort()
    .at(-1);
  if (!latestDate) return new Map();

  const latestMatchNumbers = new Set(
    matches
      .filter((match) => {
        const result = results[String(match.number)];
        return (
          match.date === latestDate &&
          isFinishedResult(result) &&
          hasCompletedScore(result)
        );
      })
      .map((match) => match.number),
  );
  if (!latestMatchNumbers.size) return new Map();

  const pointsBefore = new Map(
    profiles.map((profile) => {
      const latestPoints = profile.scorecard.entries
        .filter(
          (entry) =>
            entry.matchNumber !== null &&
            latestMatchNumbers.has(entry.matchNumber),
        )
        .reduce((total, entry) => total + entry.points, 0);
      return [profile.id, profile.points - latestPoints] as const;
    }),
  );

  if (
    profiles.every((profile) => pointsBefore.get(profile.id) === profile.points)
  ) {
    return new Map();
  }

  const rankOf = (pointsFor: (profile: UserProfile) => number) => {
    const ranks = new Map<string, number>();
    [...profiles]
      .sort(
        (a, b) =>
          pointsFor(b) - pointsFor(a) || a.name.localeCompare(b.name),
      )
      .forEach((profile, index) => ranks.set(profile.id, index + 1));
    return ranks;
  };

  const beforeRanks = rankOf((profile) => pointsBefore.get(profile.id) || 0);
  const afterRanks = rankOf((profile) => profile.points);
  const movements = new Map<string, number>();

  profiles.forEach((profile) => {
    const movement =
      (beforeRanks.get(profile.id) || 0) - (afterRanks.get(profile.id) || 0);
    if (movement) movements.set(profile.id, movement);
  });

  return movements;
}
