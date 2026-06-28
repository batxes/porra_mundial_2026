export type Position = "POR" | "DEF" | "MED" | "DEL";

export type Tournament = {
  name: string;
  startsAt: string;
  endsAt: string;
  lockAt: string;
};

export type Team = {
  id: string;
  name: string;
  code: string;
  group: string;
  logo?: string | null;
  apiTeamId?: number | null;
};

export type Player = {
  id: string;
  name: string;
  team: string;
  position: Position;
  apiPlayerId?: number | null;
  photo?: string | null;
};

export type PorraData = {
  tournament: Tournament;
  teams: Team[];
  players: Player[];
  pointsRules?: Array<{ label: string; value: string }>;
  [key: string]: unknown;
};

export type Match = {
  number: number;
  date: string;
  time: string;
  home: string;
  away: string;
  venue: string;
  stage: string;
  scheduledAt?: string | null;
  apiFixtureId?: number | null;
};

export type PredictionMatch = {
  homeScore: string;
  awayScore: string;
  trainerTeamId?: string;
  tacticId?: string;
};

export type PredictionExtras = {
  worldChampion: string;
  highestScoringTeam: string;
  topScorer: string;
  mostConcededTeam: string;
  mostRedsTeam: string;
  fewestRedsTeam: string;
  mvp: string;
};

export type Prediction = {
  groups: Record<string, Record<string, string>>;
  bracket: {
    thirdQualifiers: string[];
    thirdSlots: Record<string, string>;
    winners: Record<string, string>;
  };
  matchPredictions: Record<string, PredictionMatch>;
  extras: PredictionExtras;
  xi: string[];
  xiFormation: string;
  isDefinitive: boolean;
  updatedAt: string | null;
};

export type AdminEvent = {
  id: string;
  playerId: string;
  teamId?: string;
  type: string;
  minute: number | string;
  source?: string;
  details?: {
    phase?: string;
    shootoutOrder?: number;
    shootoutAttemptId?: string;
    shootoutOutcome?: string;
    relatedEventId?: string;
    [key: string]: unknown;
  };
};

export type AdminResult = {
  homeScore: number | string;
  awayScore: number | string;
  homeTeamId?: string;
  awayTeamId?: string;
  fixtureId?: number;
  status?: string;
  source?: string;
  syncedAt?: string;
  events: AdminEvent[];
  trainerTactics?: Record<string, string[]>;
};

export type AdminResults = Record<string, AdminResult>;

export type ScoreEntry = {
  userId: string;
  matchId: string | null;
  matchNumber: number | null;
  ruleCode: string;
  label: string;
  category: string;
  points: number;
  explanation: string;
  sourceRef: string;
};

export type ScoreCategory = {
  label: string;
  total: number;
  entries: ScoreEntry[];
};

export type Scorecard = {
  total: number;
  entries: ScoreEntry[];
  categories: ScoreCategory[];
};

export type UserProfile = {
  id: string;
  name: string;
  email: string;
  avatarUrl: string;
  points: number;
  isAdmin: boolean;
  isPro: boolean;
  isWolf: boolean;
  lateEdit?: boolean;
  isHidden: boolean;
  complete: number;
  champion?: string;
  prediction: Prediction | null;
  scorecard: Scorecard;
};

export type AuthMode = "login" | "register";

export type ProviderCoverage = {
  fixtures: {
    events: boolean;
    lineups: boolean;
    statistics_fixtures: boolean;
    statistics_players: boolean;
  };
  standings: boolean;
  players: boolean;
  top_scorers: boolean;
  top_assists: boolean;
  top_cards: boolean;
  injuries: boolean;
  predictions: boolean;
  odds: boolean;
};

export type ProviderSummary = {
  coverage: ProviderCoverage | null;
  fixtures: unknown[];
  standings: unknown[];
  topScorers: unknown[];
  topCards: unknown[];
};
