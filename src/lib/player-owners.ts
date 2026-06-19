import type { UserProfile } from "@/lib/types";

// Participantes que tienen a un futbolista en su once. El `xi` de cada usuario ya
// viene cargado en el leaderboard (y refleja los swaps de cofres), asi que esto
// se resuelve en cliente sin consultas extra. Se excluyen los ocultos y se ordena
// por puntos (los mejores primero). Misma semantica para la fila de la
// clasificacion (mapa completo) y para el modal de detalle (un solo jugador).

export function getPlayerOwners(
  leaderboard: UserProfile[],
  playerId: string,
): UserProfile[] {
  return leaderboard
    .filter(
      (profile) =>
        !profile.isHidden &&
        Array.isArray(profile.prediction?.xi) &&
        profile.prediction!.xi.includes(playerId),
    )
    .sort((a, b) => b.points - a.points);
}

export function buildPlayerOwnersMap(
  leaderboard: UserProfile[],
): Map<string, UserProfile[]> {
  const map = new Map<string, UserProfile[]>();
  for (const profile of leaderboard) {
    if (profile.isHidden) continue;
    const xi = profile.prediction?.xi;
    if (!Array.isArray(xi)) continue;
    for (const playerId of xi) {
      const list = map.get(playerId);
      if (list) list.push(profile);
      else map.set(playerId, [profile]);
    }
  }
  for (const list of map.values()) {
    list.sort((a, b) => b.points - a.points);
  }
  return map;
}
