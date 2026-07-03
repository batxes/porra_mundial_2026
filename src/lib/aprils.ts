import type { Player } from "@/lib/types";

export const APRILS_PLAYER_ID = "apr-bicho";
export const APRILS_INDIO_PLAYER_ID = "apr-indio";
export const APRILS_PLAYER_IDS = [
  APRILS_PLAYER_ID,
  APRILS_INDIO_PLAYER_ID,
] as const;
export const APRILS_PACK_PLAYER_IDS = [APRILS_INDIO_PLAYER_ID] as const;

export const APRILS_CARD_POINTS_BY_ID = {
  [APRILS_PLAYER_ID]: 99,
  [APRILS_INDIO_PLAYER_ID]: 6,
} as const;
export const APRILS_CARD_POINTS = APRILS_CARD_POINTS_BY_ID[APRILS_PLAYER_ID];
export const APRILS_PACK_POOL = "aprils";
export const APRILS_PACK_TITLE = "Sobre Leyendas";
export const APRILS_PACK_IMAGE = "/sobre-leyendas-ndio.webp";

export const APRILS_PLAYER: Player = {
  id: APRILS_PLAYER_ID,
  name: "El Bicho",
  team: "por",
  position: "DEL",
  photo: "/player-photos/fotmob/apr-bicho.webp",
};

export const APRILS_INDIO_PLAYER: Player = {
  id: APRILS_INDIO_PLAYER_ID,
  name: "Ndio Yankler",
  team: "gha",
  position: "POR",
  photo: "/player-photos/fotmob/apr-indio.webp",
};

export const APRILS_PLAYERS: Player[] = [
  APRILS_PLAYER,
  APRILS_INDIO_PLAYER,
];

export function getAprilsCardPoints(playerId: string): number | undefined {
  return (APRILS_CARD_POINTS_BY_ID as Record<string, number | undefined>)[
    playerId
  ];
}

export function isAprilsPlayerId(playerId: string) {
  return getAprilsCardPoints(playerId) !== undefined;
}
