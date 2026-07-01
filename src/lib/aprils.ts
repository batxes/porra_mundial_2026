import type { Player } from "@/lib/types";

export const APRILS_PLAYER_ID = "apr-bicho";
export const APRILS_CARD_POINTS = 99;
export const APRILS_PACK_POOL = "aprils";
export const APRILS_PACK_TITLE = "Sobre Aprils";
export const APRILS_PACK_IMAGE = "/sobre-aprils.webp";

export const APRILS_PLAYER: Player = {
  id: APRILS_PLAYER_ID,
  name: "El Bicho",
  team: "por",
  position: "DEL",
  photo: "/player-photos/fotmob/apr-bicho.webp",
};

export function isAprilsPlayerId(playerId: string) {
  return playerId === APRILS_PLAYER_ID;
}
