/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";

import { data, schedule } from "@/lib/data";
import { scheduleUtc } from "@/lib/prediction";
import { createEngine } from "@/lib/scoring";

const engine = createEngine({ data, schedule });
const teamIds = data.teams.map((team) => team.id);

function hasMatchStarted(match: (typeof schedule)[number], nowMs: number) {
  return nowMs >= new Date(scheduleUtc(match)).getTime();
}

function actualTeams(match: (typeof schedule)[number]) {
  if (teamIds.includes(match.home) && teamIds.includes(match.away)) return { home: match.home, away: match.away };
  const index = (match.number * 2) % teamIds.length;
  return { home: teamIds[index], away: teamIds[(index + 1) % teamIds.length] };
}

function prediction({ exactScores, homeWinners }: { exactScores: boolean; homeWinners: boolean }) {
  const matchPredictions: Record<string, { homeScore: string; awayScore: string }> = {};
  schedule.forEach((match) => {
    matchPredictions[String(match.number)] = exactScores ? { homeScore: "2", awayScore: "1" } : { homeScore: "0", awayScore: "0" };
  });
  return {
    groups: {},
    bracket: {
      thirdQualifiers: [],
      thirdSlots: {},
      winners: Object.fromEntries(
        schedule
          .filter((match) => match.number >= 73)
          .map((match) => [String(match.number), homeWinners ? actualTeams(match).home : actualTeams(match).away]),
      ),
    },
    extras: { topScorer: "esp-19", mvp: "esp-19" },
    xi: ["esp-01", "esp-02", "esp-03", "esp-04", "esp-05", "esp-06", "esp-08", "esp-09", "esp-16", "esp-19", "esp-21"],
    matchPredictions,
    isDefinitive: true,
  } as any;
}

function simulatedResults() {
  return Object.fromEntries(
    schedule.map((match) => {
      const teams = actualTeams(match);
      return [
        String(match.number),
        {
          homeScore: 2,
          awayScore: 1,
          homeTeamId: teams.home,
          awayTeamId: teams.away,
          events: [
            { id: `goal-${match.number}`, playerId: "esp-19", teamId: "esp", type: "gol", minute: 19 },
            { id: `mvp-${match.number}`, playerId: "esp-19", teamId: "esp", type: "MVP", minute: 90 },
          ],
        },
      ];
    }),
  );
}

const users = [
  { id: "u1", name: "Test Exacto", prediction: prediction({ exactScores: true, homeWinners: true }) },
  { id: "u2", name: "Test Fallos", prediction: prediction({ exactScores: false, homeWinners: false }) },
];
const results = simulatedResults();
const finalElectionResults = {
  worldChampion: actualTeams(schedule.find((match) => match.number === 104)!).home,
  highestScoringTeam: "",
  mostConcededTeam: "",
  mostRedsTeam: "",
  topScorer: "esp-19",
  mvp: "esp-19",
};
const table = users
  .map((user) => ({
    ...user,
    scorecard: engine.calculateScorecard(
      user.prediction,
      results as any,
      user.id,
      finalElectionResults,
    ),
  }))
  .sort((a, b) => b.scorecard.total - a.scorecard.total);

assert.equal(Object.keys(results).length, 104);
assert.equal(table[0].id, "u1");
assert.ok(table[0].scorecard.total > table[1].scorecard.total);
assert.ok(table[0].scorecard.entries.some((entry) => entry.ruleCode === "match_exact_score"));
assert.ok(table[0].scorecard.entries.some((entry) => entry.ruleCode === "tournament_champion_hit"));
assert.ok(table[0].scorecard.entries.some((entry) => entry.ruleCode === "tournament_top_scorer_hit"));

const firstMatch = schedule[0];
const afterKickoff = new Date(scheduleUtc(firstMatch)).getTime() + 60_000;
assert.equal(hasMatchStarted(firstMatch, afterKickoff), true);
assert.equal(users[0].prediction.isDefinitive, true);

console.log(`simulation tests passed: ${table[0].name} ${table[0].scorecard.total} pts, ${table[1].name} ${table[1].scorecard.total} pts`);
