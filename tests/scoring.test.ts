/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";

import { data, schedule } from "@/lib/data";
import { normalizeFinalElectionResults } from "@/lib/final-election-results";
import {
  buildAlivePlayoffTeamIds,
  buildCardEligiblePlayoffTeamIds,
  buildEliminatedPlayoffTeamIds,
  buildPredictionPlayoffTeams,
  buildResolvedPlayoffTeams,
} from "@/lib/playoff-teams";
import { calculateCompletion, emptyPrediction, groupTeamAt } from "@/lib/prediction";
import { calculateTeamStandings, createEngine } from "@/lib/scoring";

const engine = createEngine({ data, schedule });

assert.deepEqual(
  normalizeFinalElectionResults({
    highestScoringTeam: "fra",
    mostConcededTeam: ["mex", "mex", "bra"],
    mostRedsTeam: "{arg,esp}",
  }),
  {
    worldChampion: "",
    highestScoringTeam: ["fra"],
    mostConcededTeam: ["mex", "bra"],
    mostRedsTeam: ["arg", "esp"],
    topScorer: "",
    mvp: "",
  },
);
const playerIdByPosition = (position: string) => data.players.find((player) => player.position === position)?.id || "";
const playerIdByTeamPosition = (team: string, position: string) =>
  data.players.find((player) => player.team === team && player.position === position)?.id || "";
const actualKnockoutGroupOrder: Record<string, string[]> = {
  A: ["mex", "rsa", "kor", "cze"],
  B: ["sui", "can", "bih", "qat"],
  C: ["bra", "mar", "hai", "sco"],
  D: ["usa", "aus", "par", "tur"],
  E: ["ger", "civ", "ecu", "cuw"],
  F: ["ned", "jpn", "swe", "tun"],
  G: ["bel", "egy", "irn", "nzl"],
  H: ["esp", "cpv", "ksa", "uru"],
  I: ["fra", "nor", "sen", "irq"],
  J: ["arg", "aut", "alg", "jor"],
  K: ["col", "por", "cod", "uzb"],
  L: ["eng", "cro", "gha", "pan"],
};
const actualThirdQualifierGroups = new Set(["B", "D", "E", "F", "I", "J", "K", "L"]);

function actualKnockoutGroupResults() {
  return Object.fromEntries(
    schedule
      .filter((match) => match.stage === "Grupos")
      .map((match) => {
        const group = data.teams.find((team) => team.id === match.home)?.group || "";
        const order = actualKnockoutGroupOrder[group] || [];
        const homeRank = order.indexOf(match.home);
        const awayRank = order.indexOf(match.away);
        const homeWins = homeRank >= 0 && awayRank >= 0 && homeRank < awayRank;
        const isThirdVsFourth =
          Math.max(homeRank, awayRank) === 3 &&
          Math.min(homeRank, awayRank) === 2;
        const winnerScore =
          isThirdVsFourth && actualThirdQualifierGroups.has(group) ? 3 : 1;

        return [
          String(match.number),
          {
            homeScore: homeWins ? winnerScore : 0,
            awayScore: homeWins ? 0 : winnerScore,
            homeTeamId: match.home,
            awayTeamId: match.away,
            events: [],
          },
        ];
      }),
  );
}

{
  const prediction = emptyPrediction();
  const groupAIds = data.teams.filter((team) => team.group === "A").map((team) => team.id);

  assert.equal(Object.values(prediction.groups.A).filter(Boolean).length, 4);
  assert.deepEqual(groupAIds.map((_, index) => groupTeamAt("A", index + 1, prediction)), groupAIds);
  assert.deepEqual(prediction.bracket.thirdQualifiers, []);
}

{
  const scoreOnly = emptyPrediction();
  const completePlayoffs = emptyPrediction();

  schedule
    .filter((match) => match.number >= 73)
    .forEach((match) => {
      scoreOnly.matchPredictions[String(match.number)] = {
        homeScore: "1",
        awayScore: "0",
      };
      completePlayoffs.matchPredictions[String(match.number)] = {
        homeScore: "1",
        awayScore: "0",
        trainerTeamId: "bra",
        tacticId: "set-piece",
      };
    });

  assert.equal(calculateCompletion(scoreOnly), calculateCompletion(emptyPrediction()));
  assert.ok(calculateCompletion(completePlayoffs) > calculateCompletion(scoreOnly));
}

{
  const adminResults = actualKnockoutGroupResults();
  const resolved = buildResolvedPlayoffTeams(adminResults);

  assert.deepEqual(resolved["73"], { home: "rsa", away: "can" });
  assert.deepEqual(resolved["74"], { home: "ger", away: "par" });
  assert.deepEqual(resolved["80"], { home: "eng", away: "cod" });
  assert.deepEqual(resolved["85"], { home: "sui", away: "alg" });

  const prediction = emptyPrediction();
  prediction.matchPredictions["73"] = { homeScore: "2", awayScore: "1" };
  prediction.matchPredictions["75"] = { homeScore: "0", awayScore: "1" };

  const predicted = buildPredictionPlayoffTeams(adminResults, prediction);
  assert.equal(predicted["90"], undefined);

  const resolvedAfterOfficialResults = buildPredictionPlayoffTeams(
    {
      ...adminResults,
      "73": {
        homeScore: 2,
        awayScore: 1,
        homeTeamId: "rsa",
        awayTeamId: "can",
        events: [],
      },
      "75": {
        homeScore: 0,
        awayScore: 1,
        homeTeamId: "ned",
        awayTeamId: "mar",
        events: [],
      },
    },
    prediction,
  );
  assert.deepEqual(resolvedAfterOfficialResults["90"], {
    home: "rsa",
    away: "mar",
  });

  const resolvedAfterShootout = buildResolvedPlayoffTeams({
    ...adminResults,
    "73": {
      homeScore: 1,
      awayScore: 1,
      homeTeamId: "rsa",
      awayTeamId: "can",
      events: [
        {
          id: "can-shootout-goal",
          playerId: "can-09",
          teamId: "can",
          type: "penalty_goal",
          minute: 121,
          details: {
            phase: "shootout",
            shootoutOrder: 1,
            shootoutAttemptId: "can-1",
            shootoutOutcome: "scored",
          },
        },
      ],
    },
  } as any);
  assert.deepEqual(resolvedAfterShootout["90"], { home: "can" });
}

{
  const adminResults = actualKnockoutGroupResults();
  const aliveAfterGroups = buildAlivePlayoffTeamIds(adminResults);

  assert.equal(aliveAfterGroups.size, 32);
  assert.ok(aliveAfterGroups.has("mex"));
  assert.ok(aliveAfterGroups.has("can"));
  assert.ok(!aliveAfterGroups.has("kor"));

  const eliminatedAfterGroups = buildEliminatedPlayoffTeamIds(adminResults);
  assert.ok(eliminatedAfterGroups.has("tur"));
  assert.ok(!eliminatedAfterGroups.has("can"));

  const aliveAfterMatch73 = buildAlivePlayoffTeamIds({
    ...adminResults,
    "73": {
      homeScore: 2,
      awayScore: 1,
      homeTeamId: "rsa",
      awayTeamId: "can",
      events: [],
    },
  });

  assert.equal(aliveAfterMatch73.size, 31);
  assert.ok(aliveAfterMatch73.has("rsa"));
  assert.ok(!aliveAfterMatch73.has("can"));

  const eliminatedAfterMatch73 = buildEliminatedPlayoffTeamIds({
    ...adminResults,
    "73": {
      homeScore: 2,
      awayScore: 1,
      homeTeamId: "rsa",
      awayTeamId: "can",
      events: [],
    },
  });
  assert.ok(eliminatedAfterMatch73.has("tur"));
  assert.ok(eliminatedAfterMatch73.has("can"));
}

{
  const adminResults = {
    ...actualKnockoutGroupResults(),
    "101": {
      homeScore: 0,
      awayScore: 2,
      homeTeamId: "fra",
      awayTeamId: "esp",
      events: [],
    },
  };

  // Francia queda fuera de la lucha por el título, pero conserva el partido
  // por el tercer puesto y, por tanto, debe seguir apareciendo en los sobres.
  assert.ok(buildEliminatedPlayoffTeamIds(adminResults).has("fra"));
  assert.ok(buildCardEligiblePlayoffTeamIds(adminResults).has("fra"));

  const afterThirdPlace = {
    ...adminResults,
    "103": {
      homeScore: 1,
      awayScore: 0,
      homeTeamId: "fra",
      awayTeamId: "eng",
      events: [],
    },
  };
  assert.ok(!buildCardEligiblePlayoffTeamIds(afterThirdPlace).has("fra"));
  assert.ok(!buildCardEligiblePlayoffTeamIds(afterThirdPlace).has("eng"));
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
  const mexShooter = playerIdByTeamPosition("mex", "DEL");
  const korShooter = playerIdByTeamPosition("kor", "DEL");
  const korKeeper = playerIdByTeamPosition("kor", "POR");
  const prediction = {
    groups: {},
    bracket: { winners: { 73: "kor" } },
    extras: {},
    xi: [mexShooter, korKeeper],
    matchPredictions: {},
  } as any;
  const card = engine.calculateScorecard(prediction, {
    73: {
      homeScore: 1,
      awayScore: 1,
      homeTeamId: "mex",
      awayTeamId: "kor",
      events: [
        {
          id: "mex-shootout-goal",
          playerId: mexShooter,
          teamId: "mex",
          type: "penalty_goal",
          minute: 121,
          details: {
            phase: "shootout",
            shootoutOrder: 1,
            shootoutAttemptId: "mex-1",
            shootoutOutcome: "scored",
          },
        },
        {
          id: "kor-shootout-goal-1",
          playerId: korShooter,
          teamId: "kor",
          type: "penalty_goal",
          minute: 122,
          details: {
            phase: "shootout",
            shootoutOrder: 2,
            shootoutAttemptId: "kor-1",
            shootoutOutcome: "scored",
          },
        },
        {
          id: "mex-shootout-miss",
          playerId: mexShooter,
          teamId: "mex",
          type: "penalty_miss",
          minute: 123,
          details: {
            phase: "shootout",
            shootoutOrder: 3,
            shootoutAttemptId: "mex-2",
            shootoutOutcome: "saved",
          },
        },
        {
          id: "kor-shootout-save",
          playerId: korKeeper,
          teamId: "kor",
          type: "penalty_save",
          minute: 123,
          details: {
            phase: "shootout",
            shootoutOrder: 3,
            shootoutAttemptId: "mex-2",
            shootoutOutcome: "saved",
          },
        },
        {
          id: "kor-shootout-goal-2",
          playerId: korShooter,
          teamId: "kor",
          type: "penalty_goal",
          minute: 124,
          details: {
            phase: "shootout",
            shootoutOrder: 4,
            shootoutAttemptId: "kor-2",
            shootoutOutcome: "scored",
          },
        },
      ],
    },
  } as any);

  // El cuadro ("team_progression_hit") ya no puntua, asi que el pick correcto de
  // bracket.winners[73]="kor" no suma: solo cuentan los eventos de penaltis.
  assert.equal(card.total, 2);
  assert.deepEqual(
    card.entries.map((entry) => [entry.ruleCode, entry.points]),
    [
      ["player_penalty_goal", 1],
      ["player_penalty_miss", -1],
      ["player_penalty_save", 2],
    ],
  );
}

{
  const miniData = {
    teams: [
      { id: "a", name: "A", code: "mx", group: "A" },
      { id: "b", name: "B", code: "kr", group: "A" },
      { id: "c", name: "C", code: "za", group: "A" },
      { id: "d", name: "D", code: "cz", group: "A" },
    ],
    players: [],
  } as any;
  const miniSchedule = [
    ["a", "c", 7, 4],
    ["d", "a", 4, 0],
    ["b", "c", 0, 3],
    ["d", "b", 3, 0],
  ].map(([home, away], index) => ({
    number: index + 1,
    date: "2026-06-11",
    time: "12:00 p.m. UTC+0",
    home,
    away,
    venue: "Test",
    stage: "Test",
  })) as any;
  const results = Object.fromEntries(
    miniSchedule.map((match: any, index: number) => {
      const row = [
        [7, 4],
        [4, 0],
        [0, 3],
        [3, 0],
      ][index];
      return [String(match.number), { homeScore: row[0], awayScore: row[1], events: [] }];
    }),
  );
  const miniEngine = createEngine({ data: miniData, schedule: miniSchedule });
  const hitPrediction = { groups: {}, bracket: { winners: {} }, extras: { mostConcededTeam: "b" }, xi: [], matchPredictions: {} } as any;
  const tiedHitPrediction = { groups: {}, bracket: { winners: {} }, extras: { mostConcededTeam: "c" }, xi: [], matchPredictions: {} } as any;
  const missPrediction = { groups: {}, bracket: { winners: {} }, extras: { mostConcededTeam: "a" }, xi: [], matchPredictions: {} } as any;
  const tiedFinalResults = {
    worldChampion: "",
    highestScoringTeam: [],
    mostConcededTeam: ["b", "c"],
    mostRedsTeam: [],
    topScorer: "",
    mvp: "",
  };

  assert.equal(
    miniEngine.calculateScorecard(hitPrediction, results as any, "", tiedFinalResults)
      .entries.some((entry) => entry.ruleCode === "tournament_most_conceded_team_hit"),
    true,
  );
  assert.equal(
    miniEngine.calculateScorecard(tiedHitPrediction, results as any, "", tiedFinalResults)
      .entries.some((entry) => entry.ruleCode === "tournament_most_conceded_team_hit"),
    true,
  );
  assert.equal(
    miniEngine.calculateScorecard(missPrediction, results as any, "", tiedFinalResults)
      .entries.some((entry) => entry.ruleCode === "tournament_most_conceded_team_hit"),
    false,
  );
}

{
  const firstPlayer = data.players[0]?.id || "";
  const secondPlayer = data.players[1]?.id || firstPlayer;
  const prediction = {
    groups: {},
    bracket: { winners: {} },
    extras: {
      worldChampion: "esp",
      highestScoringTeam: "fra",
      mostConcededTeam: "mex",
      mostRedsTeam: "bra",
      topScorer: firstPlayer,
      mvp: secondPlayer,
    },
    xi: [],
    matchPredictions: {},
  } as any;

  const manualClose = engine.calculateScorecard(prediction, {}, "u1", {
    worldChampion: prediction.extras.worldChampion,
    highestScoringTeam: [prediction.extras.highestScoringTeam, "eng"],
    mostConcededTeam: [prediction.extras.mostConcededTeam],
    mostRedsTeam: [prediction.extras.mostRedsTeam, "arg"],
    topScorer: prediction.extras.topScorer,
    mvp: prediction.extras.mvp,
  });

  assert.equal(manualClose.total, 95);
  assert.deepEqual(
    manualClose.entries.map((entry) => entry.ruleCode).sort(),
    [
      "tournament_champion_hit",
      "tournament_highest_scoring_team_hit",
      "tournament_most_conceded_team_hit",
      "tournament_most_reds_team_hit",
      "tournament_mvp_hit",
      "tournament_top_scorer_hit",
    ].sort(),
  );
}

{
  const miniTeams = [
    { id: "a", name: "A", code: "aaa", group: "A" },
    { id: "b", name: "B", code: "bbb", group: "A" },
  ] as any;
  const miniSchedule = [
    {
      number: 1,
      date: "2026-06-11",
      time: "12:00 p.m. UTC+0",
      home: "a",
      away: "b",
      venue: "Test",
      stage: "Grupos",
    },
    {
      number: 73,
      date: "2026-06-28",
      time: "12:00 p.m. UTC+0",
      home: "a",
      away: "b",
      venue: "Test",
      stage: "Dieciseisavos",
    },
  ] as any;
  const results = {
    1: {
      homeScore: 3,
      awayScore: 1,
      events: [{ id: "red-b", playerId: "", teamId: "b", type: "red_card", minute: 80 }],
    },
    73: {
      homeScore: 0,
      awayScore: 2,
      homeTeamId: "a",
      awayTeamId: "b",
      events: [],
    },
  } as any;
  const standings = calculateTeamStandings(results, miniTeams, miniSchedule);
  const teamA = standings.find((row) => row.team.id === "a");
  const teamB = standings.find((row) => row.team.id === "b");

  assert.equal(teamA?.groupPoints, 3);
  assert.equal(teamA?.groupPosition, 1);
  assert.equal(teamB?.goalsFor, 3);
  assert.equal(teamB?.redCards, 1);
  assert.equal(teamB?.progressionPoints, 5);
  assert.equal(teamB?.stageLabel, "Octavos");
  assert.equal(teamA?.isEliminated, true);
  assert.equal(teamB?.isEliminated, false);
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
  assert.equal(groupScorecard.total, 0);
  assert.equal(groupScorecard.entries.filter((entry) => entry.ruleCode.startsWith("group_")).length, 0);
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

  assert.equal(groupScorecard.total, 7);
  assert.deepEqual(
    groupScorecard.entries.filter((entry) => entry.ruleCode.startsWith("group_")).map((entry) => [entry.ruleCode, entry.points]),
    [
      ["group_position_hit", 3],
      ["group_position_hit", 3],
      ["group_third_qualification_hit", 1],
    ],
  );

  const swappedTopTwoScorecard = miniEngine.calculateScorecard(
    {
      ...prediction,
      groups: { A: { a1: "2", a2: "1", a3: "3", a4: "4" } },
    },
    results as any,
  );
  assert.equal(swappedTopTwoScorecard.total, 5);
  assert.deepEqual(
    swappedTopTwoScorecard.entries.filter((entry) => entry.ruleCode.startsWith("group_")).map((entry) => [entry.ruleCode, entry.points]),
    [
      ["group_qualification_hit", 2],
      ["group_qualification_hit", 2],
      ["group_third_qualification_hit", 1],
    ],
  );
}

{
  const card = engine.scorecardFromEntries([
    { user_id: "u1", rule_code: "match_exact_score", points: 4, explanation: "Marcador exacto partido 1" },
    { user_id: "u1", rule_code: "group_position_hit", points: 3, explanation: "Entrada antigua de grupos" },
  ]);
  assert.equal(card.total, 7);
  assert.equal(card.entries.length, 2);
  assert.equal(card.categories.find((category) => category.label === "Fase de grupos")?.total, 3);
  assert.equal(card.categories.find((category) => category.label === "Marcadores")?.total, 4);
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
  const card = engine.calculateScorecard(knockoutHits, knockoutResults, "u1", {
    worldChampion: "mex",
    highestScoringTeam: [],
    mostConcededTeam: [],
    mostRedsTeam: [],
    topScorer: "",
    mvp: "",
  });
  // El cuadro ya no puntua: ni entradas team_progression_hit ni categoria "Cuadro".
  assert.deepEqual(
    card.entries.filter((entry) => entry.ruleCode === "team_progression_hit").map((entry) => entry.points),
    [],
  );
  assert.equal(card.categories.find((category) => category.label === "Cuadro"), undefined);
  // El bonus de Campeon del Mundial se mantiene (acertar el ganador del 104).
  assert.deepEqual(
    card.entries.filter((entry) => entry.ruleCode === "tournament_champion_hit").map((entry) => entry.points),
    [25],
  );

  const withoutManualClose = engine.calculateScorecard(
    knockoutHits,
    knockoutResults,
    "u1",
  );
  assert.equal(
    withoutManualClose.entries.some(
      (entry) => entry.ruleCode === "tournament_champion_hit",
    ),
    false,
  );
}

{
  const trainerPrediction = {
    groups: {},
    bracket: { winners: {} },
    extras: {},
    xi: [],
    matchPredictions: {
      73: { trainerTeamId: "mex", tacticId: "penalty" },
    },
  } as any;
  const missPrediction = {
    ...trainerPrediction,
    matchPredictions: {
      73: { trainerTeamId: "mex", tacticId: "clean-sheet" },
    },
  } as any;
  const redCardPrediction = {
    ...trainerPrediction,
    matchPredictions: {
      73: { trainerTeamId: "kor", tacticId: "red-card" },
    },
  } as any;
  const firstGoalPrediction = {
    ...trainerPrediction,
    matchPredictions: {
      73: { trainerTeamId: "mex", tacticId: "first-goal" },
    },
  } as any;
  const setPiecePrediction = {
    ...trainerPrediction,
    matchPredictions: {
      73: { trainerTeamId: "mex", tacticId: "set-piece" },
    },
  } as any;
  const goleadorPrediction = {
    ...trainerPrediction,
    matchPredictions: {
      73: { trainerTeamId: "mex", tacticId: "over-25" },
    },
  } as any;
  const results = {
    73: {
      homeScore: 1,
      awayScore: 0,
      homeTeamId: "mex",
      awayTeamId: "kor",
      trainerTactics: {
        "over-25": ["mex"],
        penalty: ["mex", "kor"],
        "set-piece": ["mex"],
        "red-card": ["kor"],
        "first-goal": ["mex"],
      },
      events: [],
    },
  } as any;

  const hit = engine.calculateScorecard(trainerPrediction, results, "u1");
  const miss = engine.calculateScorecard(missPrediction, results, "u1");
  const redCard = engine.calculateScorecard(redCardPrediction, results, "u1");
  const firstGoal = engine.calculateScorecard(firstGoalPrediction, results, "u1");
  const setPiece = engine.calculateScorecard(setPiecePrediction, results, "u1");
  const goleador = engine.calculateScorecard(goleadorPrediction, results, "u1");

  assert.equal(hit.entries.find((entry) => entry.ruleCode === "trainer_tactic_hit")?.points, 6);
  assert.equal(hit.categories.find((category) => category.label === "Entrenadores")?.total, 6);
  assert.equal(miss.entries.some((entry) => entry.ruleCode === "trainer_tactic_hit"), false);
  assert.equal(redCard.entries.find((entry) => entry.ruleCode === "trainer_tactic_hit")?.points, 5);
  assert.equal(firstGoal.entries.find((entry) => entry.ruleCode === "trainer_tactic_hit")?.points, 1);
  assert.equal(setPiece.entries.find((entry) => entry.ruleCode === "trainer_tactic_hit")?.points, 3);
  assert.equal(goleador.entries.find((entry) => entry.ruleCode === "trainer_tactic_hit")?.points, 3);
}

console.log("scoring tests passed");
