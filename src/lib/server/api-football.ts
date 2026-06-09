/* eslint-disable @typescript-eslint/no-explicit-any */
const API_BASE = "https://v3.football.api-sports.io";
export const WORLD_CUP_LEAGUE_ID = 1;
export const WORLD_CUP_SEASON = 2026;

type ApiFootballResponse<T> = {
  response: T[];
};

function getApiKey() {
  return process.env.APIFOOTBALL_API_KEY || process.env.API_FOOTBALL_KEY || "";
}

export function hasApiFootballKey() {
  return Boolean(getApiKey());
}

export async function apiFootballGet<T>(path: string) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("Falta `APIFOOTBALL_API_KEY` en el entorno.");
  }

  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "x-apisports-key": apiKey,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`API-Football respondió ${response.status}`);
  }

  return (await response.json()) as ApiFootballResponse<T>;
}

export async function getWorldCupProviderSummary() {
  const [coverage, fixtures, standings, topScorers, topYellowCards, topRedCards] = await Promise.all([
    apiFootballGet<any>(`/leagues?id=${WORLD_CUP_LEAGUE_ID}&season=${WORLD_CUP_SEASON}`),
    apiFootballGet<any>(`/fixtures?league=${WORLD_CUP_LEAGUE_ID}&season=${WORLD_CUP_SEASON}&last=20`),
    apiFootballGet<any>(`/standings?league=${WORLD_CUP_LEAGUE_ID}&season=${WORLD_CUP_SEASON}`),
    apiFootballGet<any>(`/players/topscorers?league=${WORLD_CUP_LEAGUE_ID}&season=${WORLD_CUP_SEASON}`),
    apiFootballGet<any>(`/players/topyellowcards?league=${WORLD_CUP_LEAGUE_ID}&season=${WORLD_CUP_SEASON}`),
    apiFootballGet<any>(`/players/topredcards?league=${WORLD_CUP_LEAGUE_ID}&season=${WORLD_CUP_SEASON}`),
  ]);

  return {
    meta: {
      league: WORLD_CUP_LEAGUE_ID,
      season: WORLD_CUP_SEASON,
      source: "API-Football",
    },
    coverage: coverage.response?.[0]?.seasons?.find((season: any) => season.year === WORLD_CUP_SEASON)?.coverage || null,
    fixtures: fixtures.response || [],
    standings: standings.response || [],
    topScorers: topScorers.response || [],
    topCards: [
      ...(topYellowCards.response || []).map((item: any) => ({ ...item, cardType: "yellow" })),
      ...(topRedCards.response || []).map((item: any) => ({ ...item, cardType: "red" })),
    ],
  };
}
