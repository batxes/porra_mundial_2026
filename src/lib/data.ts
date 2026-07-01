import type { Match, Player, PorraData, Team } from "@/lib/types";
import { APRILS_PLAYER } from "@/lib/aprils";
import { porraData } from "@/lib/generated/data";
import { porraSchedule } from "@/lib/generated/schedule";

export const data = porraData as PorraData;
export const schedule = porraSchedule as unknown as Match[];

export const teamsById = new Map<string, Team>(data.teams.map((team) => [team.id, team]));
export const playersById = new Map<string, Player>(
  [...data.players, APRILS_PLAYER].map((player) => [player.id, player]),
);
export const knockoutMatches = schedule.filter((match) => match.number >= 73);

export const sections = [
  { id: "extras", label: "Tus elecciones", step: "1" },
  { id: "xi", label: "Tu once", step: "2" },
  { id: "groups", label: "Fase de grupos", step: "3" },
  { id: "knockout", label: "Fase final", step: "3.b" },
  { id: "results", label: "Resultados", step: "4" },
] as const;

export const extraPredictionFields = [
  "worldChampion",
  "highestScoringTeam",
  "mostConcededTeam",
  "mostRedsTeam",
  "topScorer",
  "mvp",
] as const;

export const xiLimits = {
  POR: 1,
  DEF: 4,
  MED: 4,
  DEL: 2,
} as const;

export const xiDefaultFormation = "4-4-2";
export const xiFormations = ["4-4-2", "4-3-3", "4-2-3-1", "4-1-4-1", "4-3-2-1", "3-4-3", "3-5-2", "5-3-2", "5-4-1"] as const;

export const xiLabels = {
  POR: "Porteros",
  DEF: "Defensas",
  MED: "Mediocampistas",
  DEL: "Delanteros",
} as const;

export const knockoutStages = [
  "Dieciseisavos",
  "Octavos",
  "Cuartos",
  "Semifinales",
  "Tercer puesto",
  "Final",
] as const;
