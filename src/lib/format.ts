import { teamsById } from "@/lib/data";
import { playerPhotoOverrides } from "@/lib/generated/player-photos";
import type { Match, Player, Team } from "@/lib/types";

export function publicAssetUrl(path: string) {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
  if (!path.startsWith("/")) return path;
  return `${basePath}${path}`;
}

export function flagUrl(team: Team) {
  return `https://flagcdn.com/w80/${team.code}.png`;
}

export function playerPhotoUrl(player: Player) {
  if (player.photo) return player.photo;
  if (playerPhotoOverrides[player.id]) return publicAssetUrl(playerPhotoOverrides[player.id]);
  return player.apiPlayerId ? `https://media.api-sports.io/football/players/${player.apiPlayerId}.png` : "";
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
