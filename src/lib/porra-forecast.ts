import { data, schedule, teamsById } from "@/lib/data";
import { buildResolvedPlayoffTeams } from "@/lib/playoff-teams";
import type { AdminResults, Player, Prediction, UserProfile } from "@/lib/types";

const SIMULATIONS = 20_000;
const electionPoints = { worldChampion: 25, highestScoringTeam: 10, mostConcededTeam: 10, mostRedsTeam: 10, topScorer: 20, mvp: 20 } as const;
type ElectionKey = keyof typeof electionPoints;
export type ForecastScenario = Partial<Record<ElectionKey, string>>;
export type ForecastMatchScenario = {
  homeScore?: number;
  awayScore?: number;
  winnerTeamId?: string;
  goalScorerIds?: string[];
  mvpPlayerId?: string;
  redPlayerIds?: string[];
};
export type ForecastMatchScenarios = Record<string, ForecastMatchScenario>;
type TeamStat = { goals: number; conceded: number; reds: number };
type Scenario = { champion: string; elections: Record<Exclude<ElectionKey, "worldChampion">, Set<string>>; playerPointDeltas: Map<string, number> };
const playersByTeam = new Map<string, Player[]>();
data.players.forEach((player) => playersByTeam.set(player.team, [...(playersByTeam.get(player.team) || []), player]));
export type ProvisionalElectionHit = { key: ElectionKey; id: string; points: number };
export type ForecastRow = { id: string; winProbability: number; topThreeProbability: number; averageFinalPoints: number; provisionalElectionPoints: number; provisionalElectionHits: ProvisionalElectionHit[]; scenarioElectionPoints: number; scenarioElectionHits: ProvisionalElectionHit[] };
export type PorraForecast = { rows: Map<string, ForecastRow>; simulations: number; pendingMatches: number; outsideTopTenProbability: number };

function score(value: unknown) { if (value === "" || value === null || value === undefined) return null; const parsed = Number(value); return Number.isFinite(parsed) && parsed >= 0 ? parsed : null; }
function resultIsScored(result: AdminResults[string] | undefined) { return score(result?.homeScore) !== null && score(result?.awayScore) !== null; }
function mulberry32(seed: number) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let value = Math.imul(seed ^ (seed >>> 15), 1 | seed); value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value; return ((value ^ (value >>> 14)) >>> 0) / 4294967296; }; }
function pick<T>(values: T[], random: () => number): T | undefined { return values[Math.floor(random() * values.length)]; }
function leaders(rows: Array<[string, number]>) { if (!rows.length) return new Set<string>(); const maximum = Math.max(...rows.map(([, value]) => value)); return new Set(rows.filter(([, value]) => value === maximum).map(([id]) => id)); }

function baseStats(adminResults: AdminResults) {
  const teams = new Map<string, TeamStat>(data.teams.map((team) => [team.id, { goals: 0, conceded: 0, reds: 0 }]));
  const goals = new Map<string, number>(); const mvps = new Map<string, number>(); let played = 0; let redCards = 0;
  Object.values(adminResults).forEach((result) => {
    const home = result.homeTeamId || ""; const away = result.awayTeamId || ""; const hs = score(result.homeScore); const as = score(result.awayScore);
    if (home && away && hs !== null && as !== null) { played += 1; teams.get(home)!.goals += hs; teams.get(home)!.conceded += as; teams.get(away)!.goals += as; teams.get(away)!.conceded += hs; }
    (result.events || []).forEach((event) => {
      const type = String(event.type || "").toLowerCase();
      if (["goal", "gol", "penalty_goal", "penalti marcado"].includes(type) && event.playerId) goals.set(event.playerId, (goals.get(event.playerId) || 0) + 1);
      if (type === "mvp" && event.playerId) mvps.set(event.playerId, (mvps.get(event.playerId) || 0) + 1);
      if (["red_card", "roja"].includes(type) && event.teamId) { teams.get(event.teamId)!.reds += 1; redCards += 1; }
    });
  });
  return { teams, goals, mvps, played, redCards };
}

function finalLeaders(teams: Map<string, TeamStat>, goals: Map<string, number>, mvps: Map<string, number>) {
  return { highestScoringTeam: leaders([...teams].map(([id, row]) => [id, row.goals])), mostConcededTeam: leaders([...teams].map(([id, row]) => [id, row.conceded - row.goals])), mostRedsTeam: leaders([...teams].map(([id, row]) => [id, row.reds])), topScorer: leaders([...goals]), mvp: leaders([...mvps]) };
}

function provisionalElectionPoints(prediction: Prediction, adminResults: AdminResults) {
  const stats = baseStats(adminResults); const current = finalLeaders(stats.teams, stats.goals, stats.mvps); const hits: ProvisionalElectionHit[] = [];
  (Object.keys(current) as Array<Exclude<ElectionKey, "worldChampion">>).forEach((key) => { const selected = prediction.extras?.[key]; if (selected && current[key].has(selected)) hits.push({ key, id: selected, points: electionPoints[key] }); });
  const final = adminResults["104"];
  if (resultIsScored(final)) { const champion = score(final.homeScore)! > score(final.awayScore)! ? final.homeTeamId : final.awayTeamId; if (champion && prediction.extras.worldChampion === champion) hits.push({ key: "worldChampion", id: champion, points: electionPoints.worldChampion }); }
  return hits;
}

function scenarioElectionHits(prediction: Prediction, overrides: ForecastScenario) {
  return (Object.entries(overrides) as Array<[ElectionKey, string]>).flatMap(([key, id]) =>
    id && id !== "__nobody__" && prediction.extras?.[key] === id
      ? [{ key, id, points: electionPoints[key] }]
      : [],
  );
}

function weightedPlayer(teamId: string, metric: Map<string, number>, random: () => number) {
  const players = playersByTeam.get(teamId) || []; if (!players.length) return undefined;
  const weighted: Player[] = [];
  players.forEach((player) => { const positionWeight = player.position === "DEL" ? 4 : player.position === "MED" ? 3 : player.position === "DEF" ? 1 : 0.35; const copies = Math.max(1, Math.round(positionWeight + (metric.get(player.id) || 0) * 5)); for (let index = 0; index < copies; index += 1) weighted.push(player); });
  return pick(weighted, random);
}

function slotTeam(slot: string, simulated: Map<number, { winner: string; loser: string }>) { if (teamsById.has(slot)) return slot; const match = slot.match(/^(Winner|Loser) Match (\d+)$/); if (!match) return ""; const result = simulated.get(Number(match[2])); return match[1] === "Winner" ? result?.winner || "" : result?.loser || ""; }
function goalPoints(player: Player) { return player.position === "POR" ? 35 : player.position === "DEF" ? 11 : player.position === "MED" ? 6 : 2; }

function createScenario(base: ReturnType<typeof baseStats>, currentResolved: ReturnType<typeof buildResolvedPlayoffTeams>, pending: typeof schedule, scorePools: Map<number, Array<[number, number]>>, winnerPools: Map<number, string[]>, overrides: ForecastScenario, matchOverrides: ForecastMatchScenarios, random: () => number): Scenario {
  const teams = new Map([...base.teams].map(([id, row]) => [id, { ...row }])); const goals = new Map(base.goals); const mvps = new Map(base.mvps);
  const simulated = new Map<number, { winner: string; loser: string }>(); const playerPointDeltas = new Map<string, number>();
  const redChance = Math.min(0.45, Math.max(0.04, (base.redCards + 1) / (base.played + 12))); const addPlayerPoints = (id: string, points: number) => playerPointDeltas.set(id, (playerPointDeltas.get(id) || 0) + points);
  pending.forEach((match) => {
    const resolved = currentResolved[String(match.number)]; const home = resolved?.home || slotTeam(match.home, simulated); const away = resolved?.away || slotTeam(match.away, simulated);
    const configured = matchOverrides[String(match.number)];
    const sampled = pick(scorePools.get(match.number)!, random)!;
    const homeScore = configured?.homeScore ?? sampled[0]; const awayScore = configured?.awayScore ?? sampled[1];
    let winner = homeScore > awayScore ? home : awayScore > homeScore ? away : "";
    if (!winner) { const validPicks = (winnerPools.get(match.number) || []).filter((id) => id === home || id === away); winner = configured?.winnerTeamId || pick(validPicks, random) || (random() < 0.5 ? home : away); }
    const loser = winner === home ? away : home; simulated.set(match.number, { winner, loser });
    if (home && away) { teams.get(home)!.goals += homeScore; teams.get(home)!.conceded += awayScore; teams.get(away)!.goals += awayScore; teams.get(away)!.conceded += homeScore; }
    const configuredScorers = configured?.goalScorerIds || [];
    for (let index = 0; index < homeScore; index += 1) { const configuredPlayer = playersByTeam.get(home)?.find((player) => player.id === configuredScorers[index]); const player = configuredPlayer || weightedPlayer(home, goals, random); if (player) { goals.set(player.id, (goals.get(player.id) || 0) + 1); addPlayerPoints(player.id, goalPoints(player)); } }
    for (let index = 0; index < awayScore; index += 1) { const configuredPlayer = playersByTeam.get(away)?.find((player) => player.id === configuredScorers[homeScore + index]); const player = configuredPlayer || weightedPlayer(away, goals, random); if (player) { goals.set(player.id, (goals.get(player.id) || 0) + 1); addPlayerPoints(player.id, goalPoints(player)); } }
    const configuredMvp = configured?.mvpPlayerId ? data.players.find((player) => player.id === configured.mvpPlayerId) : undefined;
    const mvpTeam = random() < 0.72 ? winner : loser; const mvp = configuredMvp || weightedPlayer(mvpTeam, mvps, random); if (mvp) { mvps.set(mvp.id, (mvps.get(mvp.id) || 0) + 1); addPlayerPoints(mvp.id, 3); }
    if (configured?.redPlayerIds?.length) {
      configured.redPlayerIds.forEach((playerId) => { const player = data.players.find((candidate) => candidate.id === playerId); if (player && teams.has(player.team)) { teams.get(player.team)!.reds += 1; addPlayerPoints(player.id, -2); } });
    } else if (random() < redChance) { const redTeam = random() < 0.5 ? home : away; if (redTeam) { teams.get(redTeam)!.reds += 1; const redPlayer = weightedPlayer(redTeam, new Map(), random); if (redPlayer) addPlayerPoints(redPlayer.id, -2); } }
  });
  const elections = finalLeaders(teams, goals, mvps);
  (Object.keys(elections) as Array<Exclude<ElectionKey, "worldChampion">>).forEach((key) => {
    if (overrides[key]) elections[key] = new Set([overrides[key]!]);
  });
  return { champion: overrides.worldChampion || simulated.get(104)?.winner || "", elections, playerPointDeltas };
}

export function calculatePorraForecast(input: UserProfile[], adminResults: AdminResults, overrides: ForecastScenario = {}, matchOverrides: ForecastMatchScenarios = {}): PorraForecast {
  const profiles = input.filter((profile) => !profile.isHidden && profile.prediction); const pending = schedule.filter((match) => !resultIsScored(adminResults[String(match.number)]));
  const base = baseStats(adminResults); const currentResolved = buildResolvedPlayoffTeams(adminResults);
  const scorePools = new Map<number, Array<[number, number]>>(); const winnerPools = new Map<number, string[]>();
  // El simulador público no usa pronósticos de marcador ni ganadores de cuadro
  // privados. Solo trabaja con el once y “Tus elecciones”, que sí son visibles.
  // Los resultados abiertos parten de una distribución neutral y los resultados
  // fijados por el usuario entran mediante `matchOverrides`.
  pending.forEach((match) => { scorePools.set(match.number, [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2], [2, 0], [0, 2]]); winnerPools.set(match.number, []); });
  const wins = new Map(profiles.map((p) => [p.id, 0])); const topThrees = new Map(profiles.map((p) => [p.id, 0])); const totals = new Map(profiles.map((p) => [p.id, 0])); const random = mulberry32(20260712 + profiles.length * 97 + pending.length * 13);
  for (let simulation = 0; simulation < SIMULATIONS; simulation += 1) {
    const scenario = createScenario(base, currentResolved, pending, scorePools, winnerPools, overrides, matchOverrides, random);
    const standings = profiles.map((profile) => { const prediction = profile.prediction!; let points = profile.points;
      if (scenario.champion && prediction.extras.worldChampion === scenario.champion) points += electionPoints.worldChampion;
      (Object.keys(scenario.elections) as Array<Exclude<ElectionKey, "worldChampion">>).forEach((key) => { if (prediction.extras?.[key] && scenario.elections[key].has(prediction.extras[key])) points += electionPoints[key]; });
      prediction.xi.forEach((playerId) => { points += scenario.playerPointDeltas.get(playerId) || 0; }); totals.set(profile.id, totals.get(profile.id)! + points); return { id: profile.id, points }; }).sort((a, b) => b.points - a.points || a.id.localeCompare(b.id));
    const winners = standings.filter((row) => row.points === standings[0]?.points); winners.forEach((winner) => wins.set(winner.id, wins.get(winner.id)! + 1 / winners.length)); const thirdScore = standings[Math.min(2, standings.length - 1)]?.points; standings.filter((row) => row.points >= thirdScore).forEach((row) => topThrees.set(row.id, topThrees.get(row.id)! + 1));
  }
  const rows = new Map<string, ForecastRow>(); profiles.forEach((profile) => { const provisionalElectionHits = provisionalElectionPoints(profile.prediction!, adminResults); const fixedHits = scenarioElectionHits(profile.prediction!, overrides); rows.set(profile.id, { id: profile.id, winProbability: wins.get(profile.id)! / SIMULATIONS * 100, topThreeProbability: topThrees.get(profile.id)! / SIMULATIONS * 100, averageFinalPoints: totals.get(profile.id)! / SIMULATIONS, provisionalElectionPoints: provisionalElectionHits.reduce((sum, hit) => sum + hit.points, 0), provisionalElectionHits, scenarioElectionPoints: fixedHits.reduce((sum, hit) => sum + hit.points, 0), scenarioElectionHits: fixedHits }); });
  const topTen = profiles.slice().sort((a, b) => b.points - a.points || a.name.localeCompare(b.name)).slice(0, 10); return { rows, simulations: SIMULATIONS, pendingMatches: pending.length, outsideTopTenProbability: Math.max(0, 100 - topTen.reduce((sum, p) => sum + (rows.get(p.id)?.winProbability || 0), 0)) };
}
