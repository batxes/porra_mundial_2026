/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";

import { data, schedule } from "@/lib/data";
import { emptyPrediction, groupTeamAt } from "@/lib/prediction";
import { createEngine } from "@/lib/scoring";

const engine = createEngine({ data, schedule });
const playerIdByPosition = (position: string) => data.players.find((player) => player.position === position)?.id || "";

{
  const prediction = emptyPrediction();
  const groupAIds = data.teams.filter((team) => team.group === "A").map((team) => team.id);

  assert.equal(Object.values(prediction.groups.A).filter(Boolean).length, 4);
  assert.deepEqual(groupAIds.map((_, index) => groupTeamAt("A", index + 1, prediction)), groupAIds);
  assert.deepEqual(prediction.bracket.thirdQualifiers, []);
}

{
  const exactPrediction = {
    groups: {},
    bracket: { winners: {} },
    extras: {},
    xi: [],
    matchPredictions: { 1: { homeScore: "2", awayScore: "2" } },
  } as any;
  const outcomePrediction = {
    groups: {},
    bracket: { winners: {} },
    extras: {},
    xi: [],
    matchPredictions: { 1: { homeScore: "3", awayScore: "1" } },
  } as any;
  const hit = engine.calculateScorecard(exactPrediction, { 1: { homeScore: 2, awayScore: 2, events: [] } }, "u1");
  const outcomeOnly = engine.calculateScorecard(outcomePrediction, { 1: { homeScore: 2, awayScore: 1, events: [] } }, "u1");
  const corrected = engine.calculateScorecard(exactPrediction, { 1: { homeScore: 2, awayScore: 1, events: [] } }, "u1");
  assert.equal(hit.total, 5);
  assert.deepEqual(
    hit.entries.map((entry) => [entry.ruleCode, entry.points]),
    [
      ["match_outcome_hit", 1],
      ["match_exact_score", 4],
    ],
  );
  assert.equal(outcomeOnly.total, 1);
  assert.equal(outcomeOnly.entries[0].ruleCode, "match_outcome_hit");
  assert.equal(corrected.total, 0);
}

{
  const prediction = { groups: {}, bracket: { winners: {} }, extras: {}, xi: ["esp-19"], matchPredictions: {} } as any;
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
  } as any);
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
  const scorerIds = ["DEL", "MED", "DEF", "POR"].map(playerIdByPosition);
  const prediction = { groups: {}, bracket: { winners: {} }, extras: {}, xi: scorerIds, matchPredictions: {} } as any;
  const card = engine.calculateScorecard(prediction, {
    1: {
      homeScore: 4,
      awayScore: 0,
      events: scorerIds.map((playerId, index) => ({ id: `goal-${index}`, playerId, type: "gol", minute: index + 1 })),
    },
  } as any);

  assert.deepEqual(
    card.entries.map((entry) => entry.points),
    [2, 6, 11, 35],
  );
}

{
  const prediction = {
    groups: { A: { mex: "1", kor: "2", rsa: "3", cze: "4" } },
    bracket: { winners: {} },
    extras: {},
    xi: [],
    matchPredictions: {},
  } as any;
  const partial = { 1: { homeScore: 1, awayScore: 0, events: [] } };
  const full = {
    1: { homeScore: 1, awayScore: 0, events: [] },
    2: { homeScore: 1, awayScore: 0, events: [] },
    25: { homeScore: 0, awayScore: 1, events: [] },
    28: { homeScore: 2, awayScore: 0, events: [] },
    53: { homeScore: 0, awayScore: 3, events: [] },
    54: { homeScore: 0, awayScore: 1, events: [] },
  } as any;
  assert.equal(engine.calculateScorecard(prediction, partial as any).total, 0);
  const groupScorecard = engine.calculateScorecard(prediction, full);
  assert.equal(groupScorecard.total, 16);
  assert.equal(groupScorecard.entries.filter((entry) => entry.ruleCode === "group_qualification_hit").length, 2);
  assert.equal(groupScorecard.entries.filter((entry) => entry.ruleCode === "group_position_hit").length, 4);
}

{
  const miniData = {
    teams: [
      { id: "a1", name: "A1", code: "mx", group: "A" },
      { id: "a2", name: "A2", code: "kr", group: "A" },
      { id: "a3", name: "A3", code: "za", group: "A" },
      { id: "a4", name: "A4", code: "cz", group: "A" },
      { id: "b1", name: "B1", code: "es", group: "B" },
      { id: "b2", name: "B2", code: "fr", group: "B" },
      { id: "b3", name: "B3", code: "br", group: "B" },
      { id: "b4", name: "B4", code: "ar", group: "B" },
    ],
    players: [],
  } as any;
  const miniSchedule = [
    ["a1", "a2"],
    ["a1", "a3"],
    ["a1", "a4"],
    ["a2", "a3"],
    ["a2", "a4"],
    ["a3", "a4"],
    ["b1", "b2"],
    ["b1", "b3"],
    ["b1", "b4"],
    ["b2", "b3"],
    ["b2", "b4"],
    ["b3", "b4"],
  ].map(([home, away], index) => ({
    number: index + 1,
    date: "2026-06-11",
    time: "12:00 p.m. UTC+0",
    home,
    away,
    venue: "Test",
    stage: "Grupos",
  })) as any;
  const miniEngine = createEngine({ data: miniData, schedule: miniSchedule });
  const prediction = {
    groups: { A: { a1: "1", a2: "2", a3: "3", a4: "4" } },
    bracket: { thirdQualifiers: ["A"], winners: {} },
    extras: {},
    xi: [],
    matchPredictions: {},
  } as any;
  const results = Object.fromEntries(miniSchedule.map((match: any) => [String(match.number), { homeScore: 1, awayScore: 0, events: [] }]));
  const groupScorecard = miniEngine.calculateScorecard(prediction, results as any);

  assert.equal(groupScorecard.entries.filter((entry) => entry.ruleCode === "group_qualification_hit").length, 2);
  assert.equal(groupScorecard.entries.filter((entry) => entry.ruleCode === "group_third_qualification_hit").length, 1);
  assert.equal(groupScorecard.entries.find((entry) => entry.ruleCode === "group_third_qualification_hit")?.points, 1);
}

{
  const card = engine.scorecardFromEntries([
    { user_id: "u1", rule_code: "match_exact_score", points: 4, explanation: "Marcador exacto partido 1" },
  ]);
  assert.equal(card.total, 4);
  assert.equal(card.categories[0].label, "Marcadores");
}

{
  const knockoutHits = {
    groups: {},
    bracket: {
      winners: {
        73: "mex",
        89: "mex",
        97: "mex",
        101: "mex",
        104: "mex",
      },
    },
    extras: {},
    xi: [],
    matchPredictions: {},
  } as any;
  const knockoutResults = {
    73: { homeScore: 1, awayScore: 0, homeTeamId: "mex", awayTeamId: "kor", events: [] },
    89: { homeScore: 1, awayScore: 0, homeTeamId: "mex", awayTeamId: "fra", events: [] },
    97: { homeScore: 1, awayScore: 0, homeTeamId: "mex", awayTeamId: "esp", events: [] },
    101: { homeScore: 1, awayScore: 0, homeTeamId: "mex", awayTeamId: "bra", events: [] },
    104: { homeScore: 1, awayScore: 0, homeTeamId: "mex", awayTeamId: "arg", events: [] },
  } as any;
  const card = engine.calculateScorecard(knockoutHits, knockoutResults, "u1");
  assert.deepEqual(
    card.entries.filter((entry) => entry.ruleCode === "team_progression_hit").map((entry) => entry.points),
    [5, 10, 15, 20, 25],
  );
}

console.log("scoring tests passed");
