import type { Match, Player, PorraData, Team } from "@/lib/types";
import { porraData } from "@/lib/generated/data";
import { porraSchedule } from "@/lib/generated/schedule";

export const data = porraData as PorraData;
export const schedule = porraSchedule as unknown as Match[];

export const teamsById = new Map<string, Team>(data.teams.map((team) => [team.id, team]));
export const playersById = new Map<string, Player>(data.players.map((player) => [player.id, player]));
export const knockoutMatches = schedule.filter((match) => match.number >= 73);

export const sections = [
  { id: "groups", label: "1. Grupos" },
  { id: "knockout", label: "2. Eliminatorias" },
  { id: "results", label: "3. Marcadores" },
  { id: "extras", label: "4. Extras" },
  { id: "xi", label: "5. Tu once" },
] as const;

export const xiLimits = {
  POR: 1,
  DEF: 4,
  MED: 4,
  DEL: 2,
} as const;

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
