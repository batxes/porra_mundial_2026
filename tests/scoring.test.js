const assert = require("node:assert/strict");
const fs = require("node:fs");

global.window = {};
eval(fs.readFileSync("data.js", "utf8"));
eval(fs.readFileSync("schedule.js", "utf8"));
eval(fs.readFileSync("scoring.js", "utf8"));

const schedule = window.PORRA_SCHEDULE.map(([number, date, time, home, away, venue, stage]) => ({
  number,
  date,
  time,
  home,
  away,
  venue,
  stage,
}));
const engine = window.PORRA_SCORING.createEngine({ data: window.PORRA_DATA, schedule });

{
  const prediction = {
    groups: {},
    bracket: { winners: {} },
    extras: {},
    xi: [],
    matchPredictions: { 1: { homeScore: "2", awayScore: "2" } },
  };
  const hit = engine.calculateScorecard(prediction, { 1: { homeScore: 2, awayScore: 2, events: [] } }, "u1");
  const corrected = engine.calculateScorecard(prediction, { 1: { homeScore: 2, awayScore: 1, events: [] } }, "u1");
  assert.equal(hit.total, 4);
  assert.equal(hit.entries[0].ruleCode, "match_exact_score");
  assert.equal(corrected.total, 0);
}

{
  const prediction = { groups: {}, bracket: { winners: {} }, extras: {}, xi: ["esp-19"], matchPredictions: {} };
  const card = engine.calculateScorecard(prediction, {
    1: {
      homeScore: 1,
      awayScore: 0,
      events: [
        { id: "goal", playerId: "esp-19", type: "gol", minute: 12 },
        { id: "red", playerId: "esp-19", type: "roja", minute: 88 },
        { id: "other", playerId: "fra-10", type: "gol", minute: 90 },
      ],
    },
  });
  assert.equal(card.total, 0);
  assert.deepEqual(
    card.entries.map((entry) => [entry.ruleCode, entry.points]),
    [
      ["player_goal", 2],
      ["player_red_card", -2],
    ],
  );
}

{
  const prediction = {
    groups: { A: { mex: "1", kor: "2", rsa: "3", cze: "4" } },
    bracket: { winners: {} },
    extras: {},
    xi: [],
    matchPredictions: {},
  };
  const partial = { 1: { homeScore: 1, awayScore: 0, events: [] } };
  const full = {
    1: { homeScore: 1, awayScore: 0, events: [] },
    2: { homeScore: 1, awayScore: 0, events: [] },
    25: { homeScore: 0, awayScore: 1, events: [] },
    28: { homeScore: 2, awayScore: 0, events: [] },
    53: { homeScore: 0, awayScore: 3, events: [] },
    54: { homeScore: 0, awayScore: 1, events: [] },
  };
  assert.equal(engine.calculateScorecard(prediction, partial).total, 0);
  assert.equal(engine.calculateScorecard(prediction, full).total, 4);
}

{
  const card = engine.scorecardFromEntries([
    { user_id: "u1", rule_code: "match_exact_score", points: 4, explanation: "Marcador exacto partido 1" },
  ]);
  assert.equal(card.total, 4);
  assert.equal(card.categories[0].label, "Marcadores");
}

console.log("scoring tests passed");
