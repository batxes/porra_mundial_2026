const assert = require("node:assert/strict");
const fs = require("node:fs");

global.window = {};
eval(fs.readFileSync("data.js", "utf8"));
eval(fs.readFileSync("schedule.js", "utf8"));
eval(fs.readFileSync("scoring.js", "utf8"));

const data = window.PORRA_DATA;
const schedule = window.PORRA_SCHEDULE.map(([number, date, time, home, away, venue, stage]) => ({
  number,
  date,
  time,
  home,
  away,
  venue,
  stage,
}));
const engine = window.PORRA_SCORING.createEngine({ data, schedule });
const teamIds = data.teams.map((team) => team.id);

function scheduleUtc(match) {
  const time = match.time.match(/^(\d+):(\d+) ([ap])\.m\. UTC([+-]\d+)$/);
  if (!time) return `${match.date}T12:00:00Z`;
  const [, rawHour, rawMinute, meridiem, rawOffset] = time;
  let hour = Number(rawHour) % 12;
  if (meridiem === "p") hour += 12;
  const [year, month, day] = match.date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour - Number(rawOffset), Number(rawMinute))).toISOString();
}

function hasMatchStarted(match, nowMs) {
  return nowMs >= new Date(scheduleUtc(match)).getTime();
}

function prediction({ exactScores, homeWinners }) {
  const matchPredictions = {};
  schedule.forEach((match) => {
    matchPredictions[String(match.number)] = exactScores
      ? { homeScore: "2", awayScore: "1" }
      : { homeScore: "0", awayScore: "0" };
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
  };
}

function actualTeams(match) {
  if (teamIds.includes(match.home) && teamIds.includes(match.away)) return { home: match.home, away: match.away };
  const index = (match.number * 2) % teamIds.length;
  return { home: teamIds[index], away: teamIds[(index + 1) % teamIds.length] };
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
const table = users
  .map((user) => ({ ...user, scorecard: engine.calculateScorecard(user.prediction, results, user.id) }))
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
