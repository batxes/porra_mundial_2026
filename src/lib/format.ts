import { teamsById } from "@/lib/data";
import { playerPhotoOverrides } from "@/lib/generated/player-photos";
import type { Match, Player, Team } from "@/lib/types";

export function flagUrl(team: Team) {
  return `https://flagcdn.com/w80/${team.code}.png`;
}

// Placeholder para los jugadores sin foto (ni override fotmob ni api-sports).
export const NO_PIC_URL = "/player-photos/fotmob/no-pic.png";

export function playerPhotoUrl(player: Player) {
  if (player.photo) return player.photo;
  if (playerPhotoOverrides[player.id]) return playerPhotoOverrides[player.id];
  if (player.apiPlayerId) return `https://media.api-sports.io/football/players/${player.apiPlayerId}.png`;
  return NO_PIC_URL;
}

export function formatDate(date: string) {
  return new Intl.DateTimeFormat("es-ES", { dateStyle: "full", timeZone: "UTC" }).format(
    new Date(`${date}T12:00:00Z`),
  );
}

export function formatScheduleDate(match: Match) {
  return `${formatDate(match.date)} · ${match.time}`;
}

export function translateSlot(value: string) {
  return String(value)
    .replace("Winner Group", "1º grupo")
    .replace("Runner-up Group", "2º grupo")
    .replace("Winner Match", "Ganador partido")
    .replace("Loser Match", "Perdedor partido")
    .replace("3rd Group", "3º grupo");
}

export function teamLabel(teamId: string) {
  const team = teamsById.get(teamId);
  return team ? team.name : "Sin elegir";
}

export function initials(name: string) {
  return String(name || "?")
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
