"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import {
  Card,
  CommunitySwapRow,
  Notice,
  SectionHeading,
  TeamFlag,
} from "@/components/common";
import { adivinaCompletedEventName } from "@/components/adivina-modal";
import { hogueraCompletedEventName } from "@/components/hoguera-modal";
import { mourinhoBattleCompletedEventName } from "@/components/mourinho-battle-intro-modal";
import { PlayerCard } from "@/components/player-card";
import { porteroPenaltyCompletedEventName } from "@/components/portero-penalty-modal";
import { ronaldaoLimboCompletedEventName } from "@/components/ronaldao-limbo-modal";
import { ruletaCompletedEventName } from "@/components/ruleta-modal";
import { scratchCardsCompletedEventName } from "@/components/scratch-cards-modal";
import { soberaQuizCompletedEventName } from "@/components/sobera-quiz-modal";
import { suarezDentistCompletedEventName } from "@/components/suarez-dentist-modal";
import { useAppContext } from "@/lib/app-context";
import {
  APRILS_PACK_IMAGE,
  APRILS_PACK_TITLE,
  getAprilsCardPoints,
  isAprilsPlayerId,
} from "@/lib/aprils";
import { data, playersById, teamsById } from "@/lib/data";
import { initials, playerPhotoUrl } from "@/lib/format";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { calculatePlayerStandings } from "@/lib/scoring";
import {
  buildAlivePlayoffTeamIds,
  buildEliminatedPlayoffTeamIds,
  startedUnvalidatedMatchTeamIds,
} from "@/lib/playoff-teams";
import { STAR_PLAYER_IDS } from "@/lib/star-players";
import { TOP150_PLAYER_IDS } from "@/lib/top150-players";
import {
  cycleKeysSince,
  dailyCycleKey,
  DAILY_FIRST_CYCLE,
  formatCountdownHMS,
  isPrivateAwardPackId,
  notifyCardsChanged,
  secondsUntilNextDailyCard,
} from "@/lib/cofres";
import type { AdminEvent, AdminResults, Player, Position } from "@/lib/types";

const PackOpeningOverlay = dynamic(
  () =>
    import("@/components/pack-opening-overlay").then(
      (mod) => mod.PackOpeningOverlay,
    ),
  { ssr: false },
);

const CardUpgradeOverlay = dynamic(
  () =>
    import("@/components/card-upgrade-overlay").then(
      (mod) => mod.CardUpgradeOverlay,
    ),
  { ssr: false },
);

const packAwardCompletedEvents = [
  adivinaCompletedEventName,
  hogueraCompletedEventName,
  mourinhoBattleCompletedEventName,
  porteroPenaltyCompletedEventName,
  ronaldaoLimboCompletedEventName,
  ruletaCompletedEventName,
  scratchCardsCompletedEventName,
  soberaQuizCompletedEventName,
  suarezDentistCompletedEventName,
] as const;

type PackKind = "daily" | "special";
type ThemedPool =
  | "barcelona"
  | "madrid"
  | "sub21"
  | "stars"
  | "francia"
  | "premier"
  | "porteros"
  | "defensas"
  | "medios"
  | "delanteros";
type ShelfThemedPool = Extract<ThemedPool, "sub21" | "stars" | "premier">;
type PackFlap = "green" | "white" | "black" | "navy" | "royal" | "red";

type Pack = {
  id: string;
  kind: PackKind;
  title: string;
  subtitle: string;
  playerIds: string[];
  dateKey?: string;
  // Pool del servidor para los sobres temáticos.
  // Si está, en prod se abre con open_themed_card_pack(p_pool, p_day).
  pool?: ThemedPool;
  availableAt: string;
  // Imagen del sobre para el overlay 3D y el hero. Por defecto /sobre.webp.
  image?: string;
  // Color del cacho que vuela al cortar en el overlay 3D (por defecto verde).
  flap?: PackFlap;
  createdBy?: string | null;
};

type RemoteDropRow = {
  id: string;
  kind: PackKind;
  label: string;
  player_ids: string[];
  available_at?: string;
  created_at?: string;
  created_by?: string | null;
};

// Sobres agrupados por TIPO para la estantería del hero (los diarios cuentan
// como un solo tipo; cada especial es el suyo). `packs` son los sin abrir de ese
// tipo y `packs[0]` es el que se abre al seleccionarlo.
type PackGroup = {
  key: string;
  kind: PackKind;
  label: string;
  image: string;
  packs: Pack[];
};

type InventoryCard = {
  id: string;
  playerId: string;
  packId: string;
  packTitle: string;
  acquiredAt: string;
  usedAt?: string | null;
  remote?: boolean;
};

type SwapLog = {
  id: string;
  userId: string;
  userName: string;
  inPlayerId: string;
  outPlayerId: string;
  pointsIn: number;
  pointsOut: number;
  delta: number;
  createdAt: string;
};

type SwapCandidate = {
  outPlayer: Player;
  inPoints: number;
  outPoints: number;
  delta: number;
  eligible: boolean;
  reason: string;
};

type QueryError = { message: string } | null;
type QueryResult<T> = Promise<{ data: T | null; error: QueryError }>;
type QueryBuilder = {
  select: (columns: string) => QueryBuilder;
  eq: (column: string, value: unknown) => QueryBuilder;
  like: (column: string, pattern: string) => QueryBuilder;
  lte: (column: string, value: unknown) => QueryBuilder;
  order: (column: string, options?: { ascending?: boolean }) => QueryBuilder;
  limit: (count: number) => QueryResult<unknown[]>;
  then: PromiseLike<{ data: unknown[] | null; error: QueryError }>["then"];
};
type SupabaseLike = {
  from: (table: string) => QueryBuilder;
  rpc: (fn: string, params?: Record<string, unknown>) => QueryResult<unknown[]>;
};

const positionLabel: Record<Position, string> = {
  POR: "Portero",
  DEF: "Defensa",
  MED: "Medio",
  DEL: "Delantero",
};

// Desglose de acciones de un jugador (cuántos goles, MVP, etc.) para mostrar de
// dónde salen sus puntos. Las claves de evento siguen las reglas del scoring
// (`src/lib/scoring.ts`): goles puntúan según posición, MVP +3, parada +2,
// penalti +1, penalti fallado -1, roja -2.
type PlayerBreakdown = {
  goals: number;
  penaltyGoals: number;
  saves: number;
  mvps: number;
  missedPens: number;
  reds: number;
};

const emptyBreakdown = (): PlayerBreakdown => ({
  goals: 0,
  penaltyGoals: 0,
  saves: 0,
  mvps: 0,
  missedPens: 0,
  reds: 0,
});

const breakdownKeyByType: Record<string, keyof PlayerBreakdown> = {
  goal: "goals",
  gol: "goals",
  penalty_goal: "penaltyGoals",
  "penalti marcado": "penaltyGoals",
  penalty_save: "saves",
  "penalti parado": "saves",
  mvp: "mvps",
  MVP: "mvps",
  penalty_miss: "missedPens",
  "penalti fallado": "missedPens",
  red_card: "reds",
  roja: "reds",
};

const breakdownPills: {
  key: keyof PlayerBreakdown;
  icon: string;
  label: string;
  tone: "pos" | "neg";
}[] = [
  { key: "goals", icon: "⚽", label: "Goles", tone: "pos" },
  { key: "penaltyGoals", icon: "🥅", label: "Penaltis marcados", tone: "pos" },
  { key: "saves", icon: "🧤", label: "Penaltis parados", tone: "pos" },
  { key: "mvps", icon: "⭐", label: "MVP", tone: "pos" },
  { key: "missedPens", icon: "❌", label: "Penaltis fallados", tone: "neg" },
  { key: "reds", icon: "🟥", label: "Rojas", tone: "neg" },
];

function hasAnyEvent(breakdown: PlayerBreakdown) {
  return breakdownPills.some((pill) => breakdown[pill.key] > 0);
}

const seedXi = [
  "swe-01",
  "tun-03",
  "swe-05",
  "swe-15",
  "tun-04",
  "tun-10",
  "swe-13",
  "swe-16",
  "swe-18",
  "swe-09",
  "swe-11",
];

// Resultados de EJEMPLO para el modo muestra: damos acciones (goles según
// puesto, MVP, paradas, penaltis, rojas) de forma determinista al once de
// muestra y a una parte del resto de jugadores, para que el desglose de puntos
// se vea poblado mientras no hay resultados oficiales. NO se usa con datos
// reales ni con porra real guardada (ver `effectiveResults`).
const DEMO_RESULTS: AdminResults = (() => {
  const events: AdminEvent[] = [];
  const add = (playerId: string, type: string) =>
    events.push({
      id: `demo-${playerId}-${type}-${events.length}`,
      playerId,
      type,
      minute: 1,
    });
  const give = (playerId: string, position: Position, seed: number) => {
    if (position === "POR") {
      add(playerId, "penalty_save");
      return;
    }
    const goals = seed % 3 === 0 ? 2 : 1;
    for (let goal = 0; goal < goals; goal += 1) add(playerId, "goal");
    if (seed % 3 === 0) add(playerId, "mvp");
    if (seed % 4 === 0) add(playerId, "penalty_goal");
    if (seed % 6 === 1) add(playerId, "penalty_miss");
    if (seed % 9 === 2) add(playerId, "red_card");
  };
  const seedSet = new Set(seedXi);
  // El once de muestra siempre con acciones (son los titulares del swap).
  seedXi.forEach((playerId, index) => {
    const player = playersById.get(playerId);
    if (player) give(playerId, player.position, index + 1);
  });
  // Y ~40% del resto, para que las cartas del inventario también luzcan puntos.
  data.players.forEach((player) => {
    if (seedSet.has(player.id)) return;
    const seed = hashString(player.id);
    if (seed % 5 < 2) give(player.id, player.position, seed);
  });
  return { "demo-muestra": { homeScore: 0, awayScore: 0, events } };
})();

const localSpecialPacksKey = "porra26_card_special_packs";
// Tutorial de bienvenida de /cofres: se muestra solo la primera visita (igual
// que los intros de la porra). El botón "?" de la cabecera lo reabre cuando
// quieras.
const cofresIntroStorageKey = "porra26_cofres_intro_seen";
// Tutorial de la pestaña Forja: se muestra la primera vez que entras en ella.
const forjaIntroStorageKey = "porra26_forja_intro_seen";

// Sobre "Promesas sub-21": 1 carta de un joven crack. Lista CURADA por id (el
// dataset no trae edad/fecha de nacimiento). Si cambia, este es el ÚNICO sitio.
const SUB21_PLAYER_IDS = [
  "mex-19", // Gilberto Mora
  "esp-19", // Lamine Yamal
  "egy-09", // Hamza Abdelkarim
  "ned-25", // Jorrel Hato
  "bra-19", // Endrick
  "fra-20", // Désiré Doué
  "por-15", // João Neves
  "tur-08", // Arda Güler
  "arg-18", // Nico Paz
];

// Sobre "Premier": 1 carta de un crack de la Premier League. Lista curada por id
// (verificada contra el dataset). Se reparte como sobre de bienvenida extra.
const PREMIER_PLAYER_IDS = [
  "nor-09", // Erling Haaland
  "eng-04", // Declan Rice
  "eng-07", // Bukayo Saka
  "ger-17", // Florian Wirtz
  "ecu-23", // Moisés Caicedo
  "fra-17", // William Saliba
  "eng-17", // Morgan Rogers
  "arg-24", // Enzo Fernández
  "fra-24", // Rayan Cherki
  "swe-09", // Alexander Isak
  "gha-11", // Antoine Semenyo
  "ned-08", // Ryan Gravenberch
  "eng-08", // Elliot Anderson
  "bel-11", // Jérémy Doku
  "esp-18", // Martín Zubimendi
  "cro-04", // Joško Gvardiol
  "esp-24", // Marc Cucurella
  "bra-22", // Gabriel Martinelli
  "ger-07", // Kai Havertz
  "nor-10", // Martin Ødegaard
  "eng-18", // Anthony Gordon
  "swe-17", // Viktor Gyökeres
];

// Sobres temáticos de la estantería por defecto (tras el diario): Promesas,
// Estrellas y Premier. Mantener los `pool` en sync con SHELF_THEMED_POOLS de
// cofres.ts. Los sobres por puesto existen solo como drops de admin.
const THEMED_CONFIGS: Array<{
  pool: ShelfThemedPool;
  title: string;
  subtitle: string;
  image: string;
  flap: PackFlap;
  count: number;
  ids: string[];
}> = [
  {
    pool: "sub21",
    title: "Sobre Promesas",
    subtitle: "1 promesa sub-21",
    image: "/sobre21.webp",
    flap: "black",
    count: 1,
    ids: SUB21_PLAYER_IDS,
  },
  {
    pool: "stars",
    title: "Sobre Estrellas",
    subtitle: "1 estrella mundial",
    image: "/sobre-estrellas.webp",
    flap: "navy",
    count: 1,
    ids: STAR_PLAYER_IDS,
  },
  {
    pool: "premier",
    title: "Sobre Premier",
    subtitle: "1 crack de la Premier",
    image: "/sobre-premier.webp",
    flap: "royal",
    count: 1,
    ids: PREMIER_PLAYER_IDS,
  },
];

const PACK_VISUALS: Array<{
  title: string;
  image: string;
  flap: PackFlap;
}> = [
  ...THEMED_CONFIGS.map(({ title, image, flap }) => ({ title, image, flap })),
  {
    title: "Sobre Barcelona",
    image: "/sobre-barcelona.webp",
    flap: "red",
  },
  {
    title: APRILS_PACK_TITLE,
    image: APRILS_PACK_IMAGE,
    flap: "red",
  },
  {
    title: "Sobre Madrid",
    image: "/sobre-madrid.webp",
    flap: "white",
  },
  {
    title: "Sobre Francia",
    image: "/sobre-francia.webp",
    flap: "royal",
  },
  {
    title: "Sobre Porteros",
    image: "/sobre-porteros.webp",
    flap: "white",
  },
  {
    title: "Sobre Defensas",
    image: "/sobre-defensas.webp",
    flap: "navy",
  },
  {
    title: "Sobre Mediocentros",
    image: "/sobre-medios.webp",
    flap: "green",
  },
  {
    title: "Sobre Delanteros",
    image: "/sobre-delanteros.webp",
    flap: "red",
  },
];

function normalizePackTitle(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function packVisualForTitle(title: string) {
  const normalized = normalizePackTitle(title);
  return PACK_VISUALS.find(
    (visual) => normalizePackTitle(visual.title) === normalized,
  );
}

function isResidualPositionAutoPack(id: string) {
  return (
    id.startsWith("defensas-") ||
    id.startsWith("medios-") ||
    id.startsWith("delanteros-")
  );
}

function isAutomaticUserPackId(id: string) {
  return /^(daily|sub21|stars|premier|barcelona)-\d{4}-\d{2}-\d{2}-/i.test(
    id,
  );
}

// Premios privados POR USUARIO (minijuegos): solo los ve su dueño.
// Sin esto, los `special-suarez-*`/`special-sobera-*` de otros se colaban en la
// estantería (y al abrirlos el servidor respondía "Sobre no disponible").
function isForeignPrivateDrop(
  id: string,
  createdBy: string | null | undefined,
  userId: string,
) {
  return isPrivateAwardPackId(id) && createdBy !== userId;
}

function storageKey(userId: string, suffix: string) {
  return `porra26_cards_${userId || "guest"}_${suffix}`;
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    return JSON.parse(window.localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number) {
  return () => {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function pickDeterministicPlayers(
  seed: string,
  count = 3,
  allowedIds?: string[],
  alivePlayoffTeamIds?: ReadonlySet<string>,
  excludeIds: string[] = [],
) {
  const random = mulberry32(hashString(seed));
  const allow = allowedIds ? new Set(allowedIds) : null;
  const excluded = new Set(excludeIds);
  const filterAlive = Boolean(alivePlayoffTeamIds?.size);
  let pool = [...data.players].filter(
    (player) =>
      player.id &&
      !excluded.has(player.id) &&
      (!allow || allow.has(player.id)) &&
      (!filterAlive || alivePlayoffTeamIds?.has(player.team)),
  );
  if (!pool.length && allow && filterAlive) {
    pool = [...data.players].filter(
      (player) =>
        player.id &&
        !excluded.has(player.id) &&
        alivePlayoffTeamIds?.has(player.team),
    );
  }

  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
  }

  return pool.slice(0, count).map((player) => player.id);
}

// Tirada del sobre diario: 3 cartas con "pity" garantizado, todas distintas.
//   índice 0 → totalmente aleatoria (cualquier jugador del Mundial)
//   índice 1 → del Top-150 (jugadorazo asegurado)
//   índice 2 → de rareza máxima (estrella/legendaria); cae como revelado final,
//              que es el clímax del abanico.
function pickDailyPlayers(
  seed: string,
  alivePlayoffTeamIds?: ReadonlySet<string>,
): string[] {
  const star = pickDeterministicPlayers(
    `${seed}:star`,
    1,
    STAR_PLAYER_IDS,
    alivePlayoffTeamIds,
  );
  const top = pickDeterministicPlayers(
    `${seed}:top`,
    1,
    TOP150_PLAYER_IDS,
    alivePlayoffTeamIds,
    star,
  );
  const taken = new Set([...star, ...top]);
  const random = pickDeterministicPlayers(
    `${seed}:any`,
    1,
    undefined,
    alivePlayoffTeamIds,
    [...taken],
  );
  return [...random, ...top, ...star];
}

function rerollLocalPackForOpening(
  pack: Pack,
  seed: string,
  alivePlayoffTeamIds?: ReadonlySet<string>,
): Pack {
  if (pack.kind === "daily" || !pack.pool) return pack;
  const config = THEMED_CONFIGS.find((candidate) => candidate.pool === pack.pool);
  if (!config) return pack;
  return {
    ...pack,
    playerIds: pickDeterministicPlayers(
      `${config.pool}:${pack.dateKey || DAILY_FIRST_CYCLE}:${seed}`,
      config.count,
      config.ids,
      alivePlayoffTeamIds,
    ),
  };
}

function formatPackDate(key: string) {
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${key}T12:00:00Z`));
}

function formatSigned(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

// Normaliza para buscar: minúsculas y sin tildes (así "munoz" encuentra "Muñoz").
function normalizeSearch(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// Una carta coincide con la búsqueda por nombre de jugador, país o puesto.
function cardMatchesQuery(card: InventoryCard, normalizedQuery: string) {
  if (!normalizedQuery) return true;
  const player = playersById.get(card.playerId);
  if (!player) return false;
  const team = teamsById.get(player.team);
  const haystack = normalizeSearch(
    `${player.name} ${team?.name || ""} ${positionLabel[player.position]}`,
  );
  return haystack.includes(normalizedQuery);
}

function cardMatchesPosition(card: InventoryCard, position: Position | "all") {
  if (position === "all") return true;
  return playersById.get(card.playerId)?.position === position;
}

// Orden del inventario: por puntos (de más a menos) y, a igualdad de puntos,
// alfabético por nombre.
function sortCardsByPoints(
  cards: InventoryCard[],
  pointsFor: (playerId: string) => number,
) {
  return [...cards].sort((a, b) => {
    const diff = pointsFor(b.playerId) - pointsFor(a.playerId);
    if (diff !== 0) return diff;
    const nameA = playersById.get(a.playerId)?.name || "";
    const nameB = playersById.get(b.playerId)?.name || "";
    return nameA.localeCompare(nameB, "es");
  });
}

function packFromDrop(row: {
  id: string;
  kind: PackKind;
  label: string;
  player_ids: string[];
  available_at?: string;
  created_at?: string;
  created_by?: string | null;
}): Pack {
  const visual = packVisualForTitle(row.label);
  return {
    id: row.id,
    kind: row.kind,
    title: row.label,
    subtitle: row.kind === "special" ? "Drop especial" : "Sobre diario",
    playerIds: row.player_ids || [],
    availableAt: row.available_at || row.created_at || new Date().toISOString(),
    image: visual?.image,
    flap: visual?.flap,
    createdBy: row.created_by,
  };
}

function cardFromRemote(row: {
  card_id?: string;
  id?: string;
  drop_id: string;
  player_id: string;
  used_at?: string | null;
  created_at?: string;
  card_drops?: { label?: string } | Array<{ label?: string }> | null;
}): InventoryCard {
  const drop = Array.isArray(row.card_drops)
    ? row.card_drops[0]
    : row.card_drops;
  const fallbackTitle = row.drop_id.startsWith("forge-")
    ? "Forja"
    : row.drop_id;
  return {
    id: String(row.card_id || row.id || crypto.randomUUID()),
    playerId: row.player_id,
    packId: row.drop_id,
    packTitle: drop?.label || fallbackTitle,
    acquiredAt: row.created_at || new Date().toISOString(),
    usedAt: row.used_at,
    remote: true,
  };
}

// Modo demo de los cofres: los sobres/cartas NO tocan Supabase (todo en
// localStorage, robusto aunque las tablas no estén en prod) y los CAMBIOS DE
// JUGADOR (swaps) están deshabilitados. Poner en false para reactivarlo.
const CARDS_DEMO: boolean = false;

export function CofresView() {
  const {
    adminResults,
    applyCardSwap,
    prediction,
    ready,
    user,
    usingSupabase: usingSupabaseReal,
  } = useAppContext();
  // En modo demo, el cofres trabaja SIEMPRE en local (no toca Supabase).
  const usingSupabase = CARDS_DEMO ? false : usingSupabaseReal;
  const [inventory, setInventory] = useState<InventoryCard[]>([]);
  const [openedPackIds, setOpenedPackIds] = useState<string[]>([]);
  const [specialPacks, setSpecialPacks] = useState<Pack[]>([]);
  const [swapLog, setSwapLog] = useState<SwapLog[]>([]);
  const [selectedCardId, setSelectedCardId] = useState<string>("");
  const [inventoryTab, setInventoryTab] = useState<"unused" | "used">("unused");
  // Tab de página (arriba, tras el título): los sobres (hero + colección) o el
  // feed de swaps de la comunidad.
  // Inicial "sobres" SIEMPRE (igual en SSR y en el primer render del cliente)
  // para no romper la hidratación; la pestaña de la URL (?tab=swaps/forja) se
  // aplica tras montar (efecto de abajo). Antes el initializer leía la URL solo
  // en cliente → mismatch de aria-pressed en los botones de pestaña.
  const [pageTab, setPageTab] = useState<"sobres" | "swaps" | "forja">(
    "sobres",
  );
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const tab = new URLSearchParams(window.location.search).get("tab");
      if (tab === "swaps" || tab === "forja") setPageTab(tab);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  const [swapQuery, setSwapQuery] = useState("");
  const [swapsMineOnly, setSwapsMineOnly] = useState(false);
  const [newCardIds, setNewCardIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [positionFilter, setPositionFilter] = useState<Position | "all">("all");
  const [hydrated, setHydrated] = useState(false);
  // En modo Supabase con sesión, true solo cuando loadSupabaseCards ha traído el
  // inventario. Lo pone EXCLUSIVAMENTE loadSupabaseCards (no el efecto de
  // hidratación, que en el primer render aún no sabe si hay sesión).
  const [cardsLoaded, setCardsLoaded] = useState(false);
  const [activePack, setActivePack] = useState<Pack | null>(null);
  const [opening, setOpening] = useState(false);
  // En prod pedimos las cartas al servidor ANTES de abrir el overlay, para que
  // el revelado muestre exactamente lo que queda en la colección (no la tirada
  // de cliente). `preparing` enseña el spinner del botón mientras llega el RPC.
  const [preparing, setPreparing] = useState(false);
  // Semilla del "tiro" de los sobres ESPECIALES. Vacía en el render inicial
  // (determinista → sin hydration mismatch en SSR); al ABRIR se pone a
  // Math.random() y los especiales re-tiran carta aleatoria. Los diarios NO la
  // usan (siguen "iguales para todos").
  const [drawSeed, setDrawSeed] = useState("");
  // Claves de ciclo (10:00→10:00) desde la activación hasta hoy. Un timer la
  // actualiza al cruzar las 10:00 para que el sobre nuevo aparezca en vivo.
  const [cycleKeys, setCycleKeys] = useState<string[]>(() => cycleKeysSince());
  const [message, setMessage] = useState("");
  const heroButtonRef = useRef<HTMLButtonElement>(null);
  const swapPanelRef = useRef<HTMLDivElement>(null);
  const collectionRef = useRef<HTMLElement>(null);
  const wasOpening = useRef(false);
  const justAcceptedRef = useRef(false);
  // Cartas ya pedidas al servidor en openPack (prod), a la espera de que el
  // usuario corte el sobre. Se consumen en acceptPackOpening.
  const pendingCardsRef = useRef<{
    packId: string;
    cards: InventoryCard[];
  } | null>(null);
  const [demoXi, setDemoXi] = useState(seedXi);
  const [pendingSwap, setPendingSwap] = useState<SwapCandidate | null>(null);
  const [lastSwap, setLastSwap] = useState<{
    inPlayerId: string;
    outPlayerId: string;
  } | null>(null);
  const [swapBusy, setSwapBusy] = useState(false);
  // Forja (upgrade): selección de hasta 4 cartas comunes a fundir, estado del
  // botón y la fusión en curso (cartas de entrada + carta legendaria forjada
  // que el overlay revela). `forgeActive` no nulo => overlay abierto.
  const [forgeSelection, setForgeSelection] = useState<string[]>([]);
  const [forgeBusy, setForgeBusy] = useState(false);
  const [forgeActive, setForgeActive] = useState<{
    inputs: InventoryCard[];
    resultCard: InventoryCard;
  } | null>(null);
  // Tutorial de bienvenida (primera visita). `introQueuedRef` evita que el
  // efecto lo vuelva a encolar tras cerrarlo en la misma sesión.
  const [showIntro, setShowIntro] = useState(false);
  const introQueuedRef = useRef(false);
  // Tutorial de la Forja (primera vez que abres esa pestaña).
  const [showForjaIntro, setShowForjaIntro] = useState(false);
  const forjaIntroQueuedRef = useRef(false);

  const userStorageId = user?.id || "guest";
  const inventoryKey = storageKey(userStorageId, "inventory");
  const openedKey = storageKey(userStorageId, "opened");
  const logKey = storageKey(userStorageId, "log");
  const alivePlayoffTeamIds = useMemo(
    () => buildAlivePlayoffTeamIds(adminResults || {}),
    [adminResults],
  );
  const eliminatedPlayoffTeamIds = useMemo(
    () => buildEliminatedPlayoffTeamIds(adminResults || {}),
    [adminResults],
  );
  const lockedSwapTeamIds = useMemo(
    () => startedUnvalidatedMatchTeamIds(adminResults || {}),
    [adminResults],
  );
  const isPlayerEliminated = useCallback(
    (playerId: string) => {
      const teamId = playersById.get(playerId)?.team;
      return Boolean(teamId && eliminatedPlayoffTeamIds.has(teamId));
    },
    [eliminatedPlayoffTeamIds],
  );

  // Sobre diario por ciclo (3 cartas con tiering). POR USUARIO: el id incluye el
  // uid para que case con el drop del servidor (`daily-<fecha>-<uid>`). Acumulan;
  // el [0] (ciclo actual) es el destacado.
  const dailyPacks = useMemo<Pack[]>(
    () =>
      cycleKeys.map((dateKey, index) => ({
        id: `daily-${dateKey}-${userStorageId}`,
        kind: "daily" as const,
        title:
          index === 0 ? "Sobre diario" : `Sobre ${formatPackDate(dateKey)}`,
        subtitle: "3 cartas · 1 legendaria asegurada",
        playerIds: pickDailyPlayers(
          `daily:${dateKey}:${userStorageId}`,
          alivePlayoffTeamIds,
        ),
        dateKey,
        availableAt: `${dateKey}T00:00:00.000Z`,
      })),
    [alivePlayoffTeamIds, cycleKeys, userStorageId],
  );

  // Sobres temáticos de BIENVENIDA: uno de cada, fijos al ciclo de activación,
  // NO se renuevan solos. POR USUARIO (id con uid → `<pool>-<fecha>-<uid>`). Se
  // quedan hasta que los abras.
  const themedPacks = useMemo<Pack[]>(
    () =>
      THEMED_CONFIGS.map((cfg) => ({
        id: `${cfg.pool}-${DAILY_FIRST_CYCLE}-${userStorageId}`,
        kind: "special" as const,
        pool: cfg.pool,
        dateKey: DAILY_FIRST_CYCLE,
        title: cfg.title,
        subtitle: cfg.subtitle,
        playerIds: pickDeterministicPlayers(
          `${cfg.pool}:${DAILY_FIRST_CYCLE}:${drawSeed}`,
          cfg.count,
          cfg.ids,
          alivePlayoffTeamIds,
        ),
        availableAt: `${DAILY_FIRST_CYCLE}T00:00:00.000Z`,
        image: cfg.image,
        flap: cfg.flap,
      })),
    [alivePlayoffTeamIds, drawSeed, userStorageId],
  );

  // A las 10:00 (Madrid) entra un ciclo nuevo de sobres: un timer se reprograma
  // a cada reparto y refresca la estantería en vivo (sin recargar).
  useEffect(() => {
    let timer: number;
    const schedule = () => {
      const ms = (secondsUntilNextDailyCard() + 2) * 1000;
      timer = window.setTimeout(() => {
        setCycleKeys(cycleKeysSince());
        schedule();
      }, ms);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, []);

  const hasRealXi = prediction.xi.some((playerId) => playersById.has(playerId));
  const activeXi = hasRealXi ? prediction.xi : demoXi;

  // En modo MUESTRA (sin porra real guardada) y sin resultados oficiales aún,
  // usamos unos resultados de EJEMPLO para que se vean puntos/goles/MVP en las
  // cartas y el swap. Con porra real, o en cuanto hay resultados oficiales,
  // mandan los datos reales (igual que el "once de muestra" cede al once real).
  const effectiveResults = useMemo(() => {
    const hasResults = Boolean(
      adminResults && Object.keys(adminResults).length,
    );
    return !hasResults && !hasRealXi ? DEMO_RESULTS : adminResults || {};
  }, [adminResults, hasRealXi]);

  const playerPoints = useMemo(() => {
    const map = new Map<string, number>();
    calculatePlayerStandings(effectiveResults, data.players).forEach((row) => {
      map.set(row.player.id, row.points);
    });
    return map;
  }, [effectiveResults]);

  const pointsFor = useCallback(
    (playerId: string) => getAprilsCardPoints(playerId) ?? playerPoints.get(playerId) ?? 0,
    [playerPoints],
  );

  // Desglose de acciones por jugador (mismas reglas que el scoring), para
  // mostrar de dónde vienen sus puntos en el panel de swap.
  const playerBreakdown = useMemo(() => {
    const map = new Map<string, PlayerBreakdown>();
    Object.values(effectiveResults || {}).forEach((result) => {
      (result.events || []).forEach((event) => {
        const key = breakdownKeyByType[String(event.type)];
        if (!key || !playersById.has(event.playerId)) return;
        const entry = map.get(event.playerId) || emptyBreakdown();
        entry[key] += 1;
        map.set(event.playerId, entry);
      });
    });
    return map;
  }, [effectiveResults]);

  const breakdownFor = useCallback(
    (playerId: string) => playerBreakdown.get(playerId) || emptyBreakdown(),
    [playerBreakdown],
  );
  const unusedCards = useMemo(
    () =>
      inventory
        .filter((card) => !card.usedAt)
        .sort((a, b) => b.acquiredAt.localeCompare(a.acquiredAt)),
    [inventory],
  );
  const usedCards = useMemo(
    () =>
      inventory
        .filter((card) => card.usedAt)
        .sort((a, b) => (b.usedAt || "").localeCompare(a.usedAt || "")),
    [inventory],
  );
  const selectedCard = unusedCards.find((card) => card.id === selectedCardId);
  const selectedPlayer = selectedCard
    ? playersById.get(selectedCard.playerId)
    : null;
  // Forja: se puede fundir CUALQUIER carta sin usar (comunes o legendarias; 4
  // legendarias → otra legendaria). El premio siempre es legendaria.
  const forgeableCards = unusedCards.filter(
    (card) => !isAprilsPlayerId(card.playerId),
  );
  // Cartas seleccionadas, resueltas a InventoryCard y filtradas a las que aún
  // existen y siguen siendo forjables (si una se usa/desaparece, se cae sola).
  const forgeInputs = useMemo(() => {
    const byId = new Map(forgeableCards.map((card) => [card.id, card]));
    return forgeSelection
      .map((id) => byId.get(id))
      .filter((card): card is InventoryCard => Boolean(card));
  }, [forgeSelection, forgeableCards]);
  // Puesto común de las 4 entradas (null si están mezcladas o no hay 4).
  const forgeSamePosition = useMemo<Position | null>(() => {
    if (forgeInputs.length !== 4) return null;
    const positions = new Set(
      forgeInputs
        .map((card) => playersById.get(card.playerId)?.position)
        .filter((position): position is Position => Boolean(position)),
    );
    return positions.size === 1 ? ([...positions][0] as Position) : null;
  }, [forgeInputs]);
  // Feed de swaps filtrado: "Míos" (por userId) + buscador por nombre.
  const filteredSwaps = useMemo(() => {
    const q = normalizeSearch(swapQuery.trim());
    return swapLog.filter((entry) => {
      if (swapsMineOnly && entry.userId !== (user?.id || "")) return false;
      if (q && !normalizeSearch(entry.userName).includes(q)) return false;
      return true;
    });
  }, [swapLog, swapQuery, swapsMineOnly, user]);
  const normalizedQuery = normalizeSearch(query.trim());
  const shownUnused = useMemo(
    () =>
      sortCardsByPoints(
        unusedCards.filter(
          (card) =>
            cardMatchesQuery(card, normalizedQuery) &&
            cardMatchesPosition(card, positionFilter),
        ),
        pointsFor,
      ),
    [unusedCards, normalizedQuery, positionFilter, pointsFor],
  );
  const shownUsed = useMemo(
    () =>
      sortCardsByPoints(
        usedCards.filter(
          (card) =>
            cardMatchesQuery(card, normalizedQuery) &&
            cardMatchesPosition(card, positionFilter),
        ),
        pointsFor,
      ),
    [usedCards, normalizedQuery, positionFilter, pointsFor],
  );
  const openedIds = useMemo(() => {
    const opened = new Set([
      ...openedPackIds,
      ...inventory.map((card) => card.packId),
    ]);
    // Transición a sobres POR USUARIO: un sobre abierto en la era "igual para
    // todos" tiene id compartido sin uid (p.ej. `daily-2026-06-17`). Lo contamos
    // como abierto también en su id por-usuario `<id>-<uid>`, para no
    // re-mostrarlo tras el cambio (bug de "tengo 4 sobres" al pasar a por-usuario).
    const uuidTail =
      /-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const id of [...opened]) {
      if (!uuidTail.test(id)) opened.add(`${id}-${userStorageId}`);
    }
    return opened;
  }, [inventory, openedPackIds, userStorageId]);
  // ¿Sabemos ya qué sobres tiene abiertos? Hasta entonces NO mostramos la
  // estantería (skeleton), para no enseñar los sobres "abribles" un instante y
  // que luego desaparezcan al cargar (y poder reabrirlos = cartas repetidas).
  //  - sin sesión resuelta (`!ready`): aún no sabemos → espera.
  //  - local / sin login: el estado es síncrono → listo.
  //  - Supabase con sesión: listo solo cuando loadSupabaseCards terminó.
  const inventoryReady = ready && (!usingSupabase || !user || cardsLoaded);
  const packs = useMemo(
    // El DIARIO (destacado), luego Promesas y Estrellas; todos acumulan por
    // ciclo. Madrid y Francia quedan solo como drops de admin (pools en SQL).
    () =>
      [...dailyPacks, ...themedPacks, ...specialPacks].filter(
        (pack) => !isResidualPositionAutoPack(pack.id),
      ),
    [dailyPacks, themedPacks, specialPacks],
  );
  const unopenedPacks = useMemo(
    () => packs.filter((pack) => !openedIds.has(pack.id)),
    [openedIds, packs],
  );
  // El sobre "de la cima": el DIARIO tiene prioridad (es el destacado por
  // defecto); si no, el primero disponible (por el orden de `packs`).
  const topPack =
    unopenedPacks.find((pack) => pack.kind === "daily") ||
    unopenedPacks[0] ||
    null;
  const unopenedCount = unopenedPacks.length;

  // Agrupa los sobres sin abrir por tipo para la estantería del hero. El diario
  // va primero (es el destacado por defecto), igual que el orden de `topPack`.
  const packGroups = useMemo<PackGroup[]>(() => {
    const order: PackGroup[] = [];
    const byKey = new Map<string, PackGroup>();
    for (const pack of unopenedPacks) {
      const key = pack.kind === "daily" ? "daily" : pack.image || pack.id;
      let group = byKey.get(key);
      if (!group) {
        group = {
          key,
          kind: pack.kind,
          label:
            pack.kind === "daily"
              ? "Diario"
              : pack.title.replace(/^Sobre\s+/i, ""),
          image: pack.image || "/sobre.webp",
          packs: [],
        };
        byKey.set(key, group);
        order.push(group);
      }
      group.packs.push(pack);
    }
    // El diario va PRIMERO (el destacado que sale para abrir); luego los
    // especiales en su orden (Promesas, Estrellas).
    return order.sort(
      (a, b) => Number(b.kind === "daily") - Number(a.kind === "daily"),
    );
  }, [unopenedPacks]);

  // Tipo de sobre seleccionado en la estantería (null = el primero, que por el
  // orden de `packGroups` es el diario). El sobre destacado es el primero sin
  // abrir de ese tipo; ese es el que abre el botón.
  const [selectedTypeKey, setSelectedTypeKey] = useState<string | null>(null);
  const featuredGroup =
    packGroups.find((group) => group.key === selectedTypeKey) ||
    packGroups[0] ||
    null;
  const featuredPack = featuredGroup?.packs[0] || topPack;

  const overlayPacks = useMemo(() => {
    if (!activePack) return unopenedPacks.length ? unopenedPacks : packs;
    const pool = unopenedPacks.length ? unopenedPacks : packs;
    // El activePack lleva las cartas REALES del servidor (pre-fetch); sustituye
    // al del pool (que trae la tirada de cliente) para que el overlay revele lo
    // correcto. Si no estaba, lo añadimos delante.
    return pool.some((pack) => pack.id === activePack.id)
      ? pool.map((pack) => (pack.id === activePack.id ? activePack : pack))
      : [activePack, ...pool];
  }, [activePack, packs, unopenedPacks]);

  const loadSupabaseCards = useCallback(async () => {
    if (!usingSupabase || !user) return;

    const supabase = getSupabaseBrowserClient() as SupabaseLike | null;
    if (!supabase) {
      setCardsLoaded(true);
      return;
    }

    const [
      { data: drops, error: dropsError },
      { data: ownedDrops },
      { data: cards, error: cardsError },
      { data: swaps },
      { data: openedDrops },
    ] = await Promise.all([
      supabase
        .from("card_drops")
        .select(
          "id, kind, label, player_ids, available_at, created_at, created_by",
        )
        .eq("kind", "special")
        // Drops especiales visibles para este usuario: admin y quiz Sobera.
        // Los temáticos por usuario
        // (`stars-<fecha>-<uid>`…) también son kind='special' y de lectura
        // pública; sin este filtro inundarían el limit y los representaría dos
        // veces (ya están en themedPacks).
        .like("id", "special-%")
        .lte("available_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(16),
      supabase
        .from("card_drops")
        .select(
          "id, kind, label, player_ids, available_at, created_at, created_by",
        )
        .eq("created_by", user.id)
        .like("id", "special-%")
        .lte("available_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(500),
      supabase
        .from("user_cards")
        .select(
          "id, drop_id, card_index, player_id, used_at, created_at, card_drops(label)",
        )
        .order("created_at", { ascending: false }),
      supabase
        .from("card_swaps")
        .select(
          "id, user_id, in_player_id, out_player_id, points_in, points_out, delta, created_at, profiles(display_name)",
        )
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("card_drops")
        .select("id")
        .eq("created_by", user.id)
        .lte("available_at", new Date().toISOString())
        .limit(500),
    ]);

    if (dropsError || cardsError) {
      setMessage(
        "La base todavia no tiene las tablas de cartas. Puedes probar la pantalla en modo local.",
      );
      setCardsLoaded(true);
      return;
    }

    setSpecialPacks(
      Array.from(
        new Map(
          [
            ...((drops || []) as RemoteDropRow[]),
            ...((ownedDrops || []) as RemoteDropRow[]).filter((drop) =>
              isPrivateAwardPackId(drop.id),
            ),
          ]
            // Solo los drops especiales servidos como sobres sueltos. Los temáticos por día
            // (`sub21-<fecha>`, `stars-<fecha>`, etc.) también son kind='special' en
            // la BBDD, pero ya los representan los packs de la estantería
            // (themedPacks); incluirlos duplicaría.
            .filter(
              (drop) =>
                drop.id.startsWith("special-") &&
                !isResidualPositionAutoPack(drop.id) &&
                !isForeignPrivateDrop(drop.id, drop.created_by, user.id),
            )
            .map((drop) => [drop.id, drop]),
        ).values(),
      ).map(packFromDrop),
    );
    setInventory(
      (
        (cards || []) as Array<{
          id: string;
          drop_id: string;
          player_id: string;
          used_at?: string | null;
          created_at?: string;
          card_drops?: { label?: string } | Array<{ label?: string }> | null;
        }>
      ).map(cardFromRemote),
    );
    setOpenedPackIds(
      [
        ...new Set(
          (
            (openedDrops || []) as Array<{
              id?: unknown;
            }>
          )
            .map((row) => row.id)
            .filter(
              (id): id is string =>
                typeof id === "string" && isAutomaticUserPackId(id),
            ),
        ),
      ],
    );
    setSwapLog(
      (
        (swaps || []) as Array<{
          id: string;
          user_id?: string;
          in_player_id: string;
          out_player_id: string;
          points_in: number;
          points_out: number;
          delta: number;
          created_at: string;
          profiles?:
            | { display_name?: string }
            | Array<{ display_name?: string }>
            | null;
        }>
      ).map((row) => {
        const profile = Array.isArray(row.profiles)
          ? row.profiles[0]
          : row.profiles;
        return {
          id: row.id,
          userId: row.user_id || "",
          userName: profile?.display_name || "Jugador",
          inPlayerId: row.in_player_id,
          outPlayerId: row.out_player_id,
          pointsIn: Number(row.points_in) || 0,
          pointsOut: Number(row.points_out) || 0,
          delta: Number(row.delta) || 0,
          createdAt: row.created_at,
        };
      }),
    );
    setCardsLoaded(true);
  }, [usingSupabase, user]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void import("@/components/pack-opening-overlay");
      void fetch("/pack.glb", { cache: "force-cache" }).catch(() => undefined);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      // En modo demo (CARDS_DEMO) NO tocamos localStorage: cada montaje/F5
      // arranca en limpio (el estado vive solo en memoria), así la demo se
      // resetea y puedes volver a abrir los sobres. En modo Supabase la fuente
      // de verdad es `loadSupabaseCards` (tampoco leemos el localStorage local,
      // su setState podría pisar el inventario real con datos viejos). En ambos
      // casos solo marcamos hydrated para quitar el skeleton.
      if (usingSupabase) {
        // Modo Supabase (logueado o no, o con la sesión aún cargando): la fuente
        // de verdad es loadSupabaseCards; NO leemos localStorage ni marcamos
        // cardsLoaded aquí. La estantería se gatea con `inventoryReady` (espera a
        // que cargue el inventario antes de mostrarse abrible).
        setHydrated(true);
        return;
      }
      if (CARDS_DEMO) {
        setHydrated(true);
        return;
      }
      // Local real (sin Supabase): el localStorage es síncrono, mostramos ya.
      setInventory(readJson<InventoryCard[]>(inventoryKey, []));
      setOpenedPackIds(readJson<string[]>(openedKey, []));
      setSwapLog(readJson<SwapLog[]>(logKey, []));
      setSpecialPacks(
        readJson<Pack[]>(localSpecialPacksKey, []).filter(
          (pack) =>
            !isResidualPositionAutoPack(pack.id) &&
            !isForeignPrivateDrop(pack.id, pack.createdBy, userStorageId),
        ),
      );
      setSelectedCardId("");
      setOpening(false);
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [inventoryKey, logKey, openedKey, usingSupabase, user, userStorageId]);

  // Tras cerrar el overlay de apertura, devolvemos el foco al sobre del hero
  // (accesibilidad: el foco no se pierde en el body al desmontar el overlay).
  useEffect(() => {
    if (wasOpening.current && !opening) {
      if (justAcceptedRef.current) {
        // Acaba de meter cartas: llevamos la vista a la colección, donde
        // aparecen las nuevas (en vez de devolver el foco arriba, al hero).
        justAcceptedRef.current = false;
        window.setTimeout(() => {
          collectionRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        }, 80);
      } else {
        heroButtonRef.current?.focus();
      }
    }
    wasOpening.current = opening;
  }, [opening]);

  // En móvil/tablet el panel de swap aparece bajo el inventario; al seleccionar
  // una carta lo traemos a la vista. En xl ya está fijo al lado, sin scroll.
  useEffect(() => {
    if (!selectedCardId || typeof window === "undefined") return;
    if (window.matchMedia("(min-width: 1280px)").matches) return;
    const timer = window.setTimeout(() => {
      swapPanelRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 70);
    return () => window.clearTimeout(timer);
  }, [selectedCardId]);

  useEffect(() => {
    if (!usingSupabase || !ready || !user) return;
    const timer = window.setTimeout(() => {
      void loadSupabaseCards();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadSupabaseCards, ready, usingSupabase, user]);

  useEffect(() => {
    if (!usingSupabase || !user) return;
    const onCompleted = () => {
      setPageTab("sobres");
      void loadSupabaseCards();
    };
    packAwardCompletedEvents.forEach((eventName) => {
      window.addEventListener(eventName, onCompleted);
    });
    return () => {
      packAwardCompletedEvents.forEach((eventName) => {
        window.removeEventListener(eventName, onCompleted);
      });
    };
  }, [loadSupabaseCards, usingSupabase, user]);

  // Persistencia local SOLO fuera de demo y fuera de Supabase. En demo
  // (CARDS_DEMO) NO escribimos: el estado es en memoria y se resetea en cada
  // F5 (a propósito). El gate `hydrated` evita además que el render inicial
  // vacío pise el localStorage antes de que el efecto de carga lo lea.
  useEffect(() => {
    if (!hydrated || CARDS_DEMO || (usingSupabase && user)) return;
    writeJson(inventoryKey, inventory);
  }, [hydrated, inventory, inventoryKey, usingSupabase, user]);

  useEffect(() => {
    if (!hydrated || CARDS_DEMO || (usingSupabase && user)) return;
    writeJson(openedKey, openedPackIds);
    notifyCardsChanged();
  }, [hydrated, openedPackIds, openedKey, usingSupabase, user]);

  useEffect(() => {
    if (!hydrated || CARDS_DEMO || (usingSupabase && user)) return;
    writeJson(logKey, swapLog);
  }, [hydrated, logKey, swapLog, usingSupabase, user]);

  useEffect(() => {
    if (!hydrated || CARDS_DEMO || (usingSupabase && user)) return;
    writeJson(localSpecialPacksKey, specialPacks);
  }, [hydrated, specialPacks, usingSupabase, user]);

  const localCardsForPack = useCallback((pack: Pack) => {
    const now = new Date().toISOString();
    return pack.playerIds.map((playerId, index) => ({
      id: `${pack.id}-${index + 1}-${playerId}`,
      playerId,
      packId: pack.id,
      packTitle: pack.title,
      acquiredAt: now,
      usedAt: null,
      remote: false,
    }));
  }, []);

  const openPackInStorage = useCallback(
    async (pack: Pack) => {
      if (usingSupabase && user) {
        const supabase = getSupabaseBrowserClient() as SupabaseLike | null;
        if (!supabase)
          throw new Error("No se ha podido conectar con Supabase.");
        const rpcName = pack.pool
          ? "open_themed_card_pack"
          : pack.kind === "daily"
            ? "open_daily_card_pack"
            : "open_card_drop";
        const params = pack.pool
          ? { p_pool: pack.pool, p_day: pack.dateKey || dailyCycleKey() }
          : pack.kind === "daily"
            ? { p_day: pack.dateKey || pack.id.replace("daily-", "") }
            : { p_drop_id: pack.id };
        const { data: rows, error } = await supabase.rpc(rpcName, params);
        if (error) throw new Error(error.message);
        return (
          (rows || []) as Array<{
            card_id: string;
            drop_id: string;
            player_id: string;
            used_at?: string | null;
            created_at?: string;
          }>
        ).map((row) =>
          cardFromRemote({
            ...row,
            card_drops: { label: pack.title },
          }),
        );
      }

      return localCardsForPack(pack);
    },
    [localCardsForPack, usingSupabase, user],
  );

  const acceptPackOpening = useCallback(
    async (pack: Pack) => {
      if (openedIds.has(pack.id)) {
        setActivePack(pack);
        setInventoryTab("unused");
        setQuery("");
        justAcceptedRef.current = true;
        setOpening(false);
        setMessage("Sobre ya abierto. Sus cartas ya están en tu colección.");
        return;
      }

      // En prod las cartas ya se pidieron en openPack (para revelar lo real);
      // aquí las consumimos. En local/demo se generan en el momento.
      const stash = pendingCardsRef.current;
      const cards =
        stash && stash.packId === pack.id
          ? stash.cards
          : await openPackInStorage(pack);
      pendingCardsRef.current = null;
      setInventory((current) => {
        const existingIds = new Set(current.map((card) => card.id));
        return [
          ...cards.filter((card) => !existingIds.has(card.id)),
          ...current,
        ];
      });
      setOpenedPackIds((current) =>
        current.includes(pack.id) ? current : [pack.id, ...current],
      );
      setActivePack(pack);
      setInventoryTab("unused");
      setQuery("");
      setPositionFilter("all");
      setNewCardIds(cards.map((card) => card.id));
      justAcceptedRef.current = true;
      setOpening(false);
      // Sin mensaje: el auto-scroll a la colección y el badge "NUEVA" ya lo
      // comunican (el Notice ni se llegaba a leer).
      setMessage("");
      if (usingSupabase && user) notifyCardsChanged();
    },
    [openedIds, openPackInStorage, usingSupabase, user],
  );

  const openPack = useCallback(
    async (pack: Pack) => {
      if (opening || preparing) return;
      // Inventario aún sin cargar (openedIds no es fiable): no dejamos abrir, así
      // se evita reabrir un sobre ya abierto durante el F5 (cartas repetidas).
      if (!inventoryReady) return;

      if (openedIds.has(pack.id)) {
        setMessage("Sobre ya abierto. Sus cartas ya están en tu colección.");
        return;
      }
      setMessage("");

      if (usingSupabase && user) {
        // Prod: pide las cartas al servidor ANTES de abrir el overlay y revela
        // exactamente esas (así el revelado == la colección). Si el RPC falla,
        // avisamos y NO abrimos el overlay (no se queda colgado).
        setPreparing(true);
        try {
          const cards = await openPackInStorage(pack);
          pendingCardsRef.current = { packId: pack.id, cards };
          setActivePack({
            ...pack,
            playerIds: cards.map((card) => card.playerId),
          });
          setOpening(true);
        } catch (caught) {
          setMessage(
            caught instanceof Error
              ? caught.message
              : "No se ha podido abrir el sobre.",
          );
        } finally {
          setPreparing(false);
        }
        return;
      }

      // Local/demo: la tirada es de cliente; re-tira los ESPECIALES por apertura
      // para que la carta sea aleatoria. Math.random es seguro (evento, no render).
      const nextSeed = String(Math.random());
      setDrawSeed(nextSeed);
      setActivePack(
        rerollLocalPackForOpening(pack, nextSeed, alivePlayoffTeamIds),
      );
      setOpening(true);
    },
    [
      openedIds,
      opening,
      preparing,
      openPackInStorage,
      usingSupabase,
      user,
      inventoryReady,
      alivePlayoffTeamIds,
    ],
  );

  // Añade/quita una carta de la selección de la forja (tope de 4).
  const toggleForgeCard = useCallback((cardId: string) => {
    setForgeSelection((current) => {
      if (current.includes(cardId))
        return current.filter((id) => id !== cardId);
      if (current.length >= 4) return current;
      return [...current, cardId];
    });
  }, []);

  // Resuelve la carta forjada: en prod la decide el servidor (RPC, que también
  // consume las 4 y guarda la nueva); en local/demo se calcula igual que el SQL
  // (mismo puesto → legendaria de ese puesto; mezcla → aleatoria).
  const forgeCardsInStorage = useCallback(
    async (
      cardIds: string[],
      inputs: InventoryCard[],
    ): Promise<InventoryCard> => {
      if (usingSupabase && user) {
        const supabase = getSupabaseBrowserClient() as SupabaseLike | null;
        if (!supabase)
          throw new Error("No se ha podido conectar con Supabase.");
        const { data: rows, error } = await supabase.rpc("apply_card_upgrade", {
          p_card_ids: cardIds,
        });
        if (error) throw new Error(error.message);
        const row = (
          (rows || []) as Array<{
            card_id: string;
            drop_id: string;
            card_index?: number;
            player_id: string;
            used_at?: string | null;
            created_at?: string;
          }>
        )[0];
        if (!row) throw new Error("La forja no ha devuelto ninguna carta.");
        return cardFromRemote({ ...row, card_drops: { label: "Forja" } });
      }

      const positions = new Set(
        inputs
          .map((card) => playersById.get(card.playerId)?.position)
          .filter((position): position is Position => Boolean(position)),
      );
      const samePosition = positions.size === 1 ? [...positions][0] : null;
      const filterAlive = Boolean(alivePlayoffTeamIds.size);
      const aliveStarIds = STAR_PLAYER_IDS.filter((id) => {
        const player = playersById.get(id);
        return player && (!filterAlive || alivePlayoffTeamIds.has(player.team));
      });
      const samePositionPool = samePosition
        ? aliveStarIds.filter(
            (id) => playersById.get(id)?.position === samePosition,
          )
        : [];
      const candidates =
        samePosition && samePositionPool.length
          ? samePositionPool
          : aliveStarIds;
      if (!candidates.length) {
        throw new Error("No hay legendarias vivas disponibles.");
      }
      const resultPlayerId =
        candidates[Math.floor(Math.random() * candidates.length)];
      const id = `forge-${crypto.randomUUID()}`;
      return {
        id,
        playerId: resultPlayerId,
        packId: id,
        packTitle: "Forja",
        acquiredAt: new Date().toISOString(),
        usedAt: null,
        remote: false,
      };
    },
    [alivePlayoffTeamIds, usingSupabase, user],
  );

  // Lanza la forja: valida las 4 entradas, pide/forja la carta y abre el
  // overlay. NO toca el inventario aún (lo hace finishForge al revelar), igual
  // que el sobre. En prod el RPC ya ha consumido/guardado en BBDD.
  const startForge = useCallback(async () => {
    if (forgeBusy) return;
    const byId = new Map(unusedCards.map((card) => [card.id, card]));
    const inputs = forgeSelection
      .map((id) => byId.get(id))
      .filter((card): card is InventoryCard => Boolean(card));
    if (inputs.length !== 4) return;
    // En prod las cartas vienen de Supabase (remote); una local no se puede forjar.
    if (usingSupabase && user && inputs.some((card) => !card.remote)) {
      setMessage(
        "Hay cartas locales en la selección. Recarga e inténtalo de nuevo.",
      );
      return;
    }
    setForgeBusy(true);
    setMessage("");
    try {
      const resultCard = await forgeCardsInStorage(forgeSelection, inputs);
      setForgeActive({ inputs, resultCard });
    } catch (caught) {
      setMessage(
        caught instanceof Error ? caught.message : "No se ha podido forjar.",
      );
      if (usingSupabase && user) {
        void loadSupabaseCards();
        notifyCardsChanged();
      }
    } finally {
      setForgeBusy(false);
    }
  }, [
    forgeBusy,
    forgeSelection,
    unusedCards,
    usingSupabase,
    user,
    forgeCardsInStorage,
    loadSupabaseCards,
  ]);

  // Confirma la forja (al cerrar el revelado): marca las 4 cartas como usadas
  // y mete la legendaria. No las borramos: conservar su packId evita que el
  // sobre original vuelva a aparecer como sin abrir al refrescar.
  const finishForge = useCallback(() => {
    if (!forgeActive) return;
    const consumedIds = new Set(forgeActive.inputs.map((card) => card.id));
    const { resultCard } = forgeActive;
    const consumedAt = new Date().toISOString();
    setInventory((current) => {
      const existingIds = new Set(current.map((card) => card.id));
      const next = current.map((card) =>
        consumedIds.has(card.id)
          ? { ...card, usedAt: card.usedAt || consumedAt }
          : card,
      );
      return existingIds.has(resultCard.id) ? next : [resultCard, ...next];
    });
    setForgeSelection([]);
    setNewCardIds([resultCard.id]);
    setForgeActive(null);
    setInventoryTab("unused");
    setPageTab("sobres");
    setQuery("");
    setPositionFilter("all");
    if (usingSupabase && user) {
      // Reconcilia con el servidor (fuente de verdad): el RPC ya marcó como
      // usadas las 4 y creó la legendaria. El setInventory de arriba da feedback instantáneo;
      // esto garantiza que el inventario quede idéntico a la BBDD.
      void loadSupabaseCards();
      notifyCardsChanged();
    }
    window.setTimeout(() => {
      collectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 80);
  }, [forgeActive, usingSupabase, user, loadSupabaseCards]);

  const candidateFor = useCallback(
    (outPlayer: Player): SwapCandidate => {
      const inPoints = selectedPlayer ? pointsFor(selectedPlayer.id) : 0;
      const outPoints = pointsFor(outPlayer.id);
      const samePosition = selectedPlayer?.position === outPlayer.position;
      const alreadyInXi = selectedPlayer
        ? activeXi.includes(selectedPlayer.id)
        : false;
      const inTeamLocked = selectedPlayer
        ? lockedSwapTeamIds.has(selectedPlayer.team)
        : false;
      const outTeamLocked = lockedSwapTeamIds.has(outPlayer.team);
      // La carta no puede subir el marcador a posteriori. Los empates valen
      // para cualquier puntuación (0 -> 0, 10 -> 10, etc.).
      const cardEligible = inPoints <= outPoints;
      const eligible = Boolean(
        selectedPlayer &&
          samePosition &&
          !alreadyInXi &&
          !inTeamLocked &&
          !outTeamLocked &&
          cardEligible,
      );

      let reason = "Disponible";
      if (!selectedPlayer) reason = "Elige una carta";
      else if (!samePosition)
        reason = `Solo ${positionLabel[selectedPlayer.position]}`;
      else if (alreadyInXi) reason = "Ya esta en tu once";
      else if (inTeamLocked && outTeamLocked)
        reason = "Sus equipos estan en juego";
      else if (inTeamLocked) reason = "La carta esta en juego";
      else if (outTeamLocked) reason = "Su equipo esta en juego";
      else if (!cardEligible)
        reason = `Tiene mas puntos que tu titular (${formatSigned(outPoints)})`;

      return {
        outPlayer,
        inPoints,
        outPoints,
        delta: inPoints - outPoints,
        eligible,
        reason,
      };
    },
    [activeXi, lockedSwapTeamIds, pointsFor, selectedPlayer],
  );

  const requestSwap = (candidate: SwapCandidate) => {
    if (!candidate.eligible) return;
    setPendingSwap(candidate);
  };

  const swapBlockedByLiveMatch = (candidate: SwapCandidate) =>
    Boolean(
      selectedPlayer &&
        (lockedSwapTeamIds.has(selectedPlayer.team) ||
          lockedSwapTeamIds.has(candidate.outPlayer.team)),
    );

  const finishLocalSwap = (candidate: SwapCandidate, card: InventoryCard) => {
    const usedAt = new Date().toISOString();
    setDemoXi((current) =>
      current.map((playerId) =>
        playerId === candidate.outPlayer.id ? card.playerId : playerId,
      ),
    );
    setInventory((current) =>
      current.map((item) => (item.id === card.id ? { ...item, usedAt } : item)),
    );
    setSwapLog((current) => [
      {
        id: crypto.randomUUID(),
        userId: user?.id || "",
        userName: user?.name || "Demo",
        inPlayerId: card.playerId,
        outPlayerId: candidate.outPlayer.id,
        pointsIn: candidate.inPoints,
        pointsOut: candidate.outPoints,
        delta: candidate.delta,
        createdAt: usedAt,
      },
      ...current,
    ]);
    setSelectedCardId("");
    setMessage("");
    setLastSwap({
      inPlayerId: card.playerId,
      outPlayerId: candidate.outPlayer.id,
    });
    toast.success("¡Cambio hecho!", {
      description: `${playersById.get(card.playerId)?.name || "Tu carta"} entra por ${candidate.outPlayer.name}.`,
    });
  };

  const confirmSwap = async () => {
    if (CARDS_DEMO) return; // swaps deshabilitados en modo demo
    if (!pendingSwap || !selectedCard || !selectedPlayer || swapBusy) return;
    if (swapBlockedByLiveMatch(pendingSwap)) {
      setPendingSwap(null);
      setMessage(
        "No puedes cambiar a un jugador mientras su equipo esta en juego. Disponible cuando se valide el partido.",
      );
      toast.error("Cambio bloqueado", {
        description: "Ese equipo tiene un partido en juego.",
      });
      return;
    }
    setSwapBusy(true);
    setMessage("");

    try {
      if (!hasRealXi || !user) {
        finishLocalSwap(pendingSwap, selectedCard);
        setPendingSwap(null);
        return;
      }

      if (usingSupabase && !selectedCard.remote) {
        setMessage(
          "Esta carta es local. Abre el sobre desde Supabase para guardarla.",
        );
        setPendingSwap(null);
        return;
      }

      const result = await applyCardSwap({
        cardId: selectedCard.id,
        inPlayerId: selectedPlayer.id,
        outPlayerId: pendingSwap.outPlayer.id,
        pointsIn: pendingSwap.inPoints,
        pointsOut: pendingSwap.outPoints,
        sourcePackId: selectedCard.packId,
      });

      if (!result.ok) {
        setMessage(result.message);
        setPendingSwap(null);
        return;
      }

      const usedAt = new Date().toISOString();
      setInventory((current) =>
        current.map((item) =>
          item.id === selectedCard.id ? { ...item, usedAt } : item,
        ),
      );
      setSwapLog((current) => [
        {
          id: crypto.randomUUID(),
          userId: user.id,
          userName: user.name,
          inPlayerId: selectedPlayer.id,
          outPlayerId: pendingSwap.outPlayer.id,
          pointsIn: pendingSwap.inPoints,
          pointsOut: pendingSwap.outPoints,
          delta: pendingSwap.delta,
          createdAt: usedAt,
        },
        ...current,
      ]);
      setSelectedCardId("");
      setMessage("");
      setLastSwap({
        inPlayerId: selectedPlayer.id,
        outPlayerId: pendingSwap.outPlayer.id,
      });
      toast.success("¡Cambio hecho!", {
        description: `${selectedPlayer.name} entra por ${pendingSwap.outPlayer.name}.`,
      });
      if (usingSupabase) void loadSupabaseCards();
    } finally {
      setSwapBusy(false);
      setPendingSwap(null);
    }
  };

  // Primera visita: en cuanto el hero está listo, abrimos el tutorial salvo que
  // ya se haya visto (localStorage es la fuente de verdad).
  useEffect(() => {
    if (!hydrated || introQueuedRef.current) return;
    try {
      if (window.localStorage.getItem(cofresIntroStorageKey) === "1") return;
    } catch {
      // Si falla el storage, mostramos el tutorial igualmente esta sesión.
    }
    const timer = window.setTimeout(() => {
      introQueuedRef.current = true;
      setShowIntro(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [hydrated]);

  const dismissIntro = () => {
    try {
      window.localStorage.setItem(cofresIntroStorageKey, "1");
    } catch {
      // Ignoramos fallos de storage.
    }
    setShowIntro(false);
  };

  // Tutorial de Maldini la primera vez (máxima difusión): salta al entrar a
  // /cofres (pestaña Sobres) o a Forja, si aún no se ha visto. Nunca a la vez
  // que el tutorial de sobres (guard `showIntro`): a un usuario nuevo le salen
  // en secuencia (sobres → forja), no apilados.
  useEffect(() => {
    if (
      !hydrated ||
      (pageTab !== "sobres" && pageTab !== "forja") ||
      showIntro ||
      forjaIntroQueuedRef.current
    ) {
      return;
    }
    try {
      if (window.localStorage.getItem(forjaIntroStorageKey) === "1") return;
      // No apilar con el tutorial de sobres: si aún no se ha visto, va a salir
      // (su setShowIntro está diferido, por eso `showIntro` todavía no basta).
      // Esperamos; al cerrarlo su key pasa a "1" y este efecto reintenta
      // (depende de `showIntro`).
      if (window.localStorage.getItem(cofresIntroStorageKey) !== "1") return;
    } catch {
      // Si falla el storage, mostramos el tutorial igualmente esta sesión.
    }
    const timer = window.setTimeout(() => {
      forjaIntroQueuedRef.current = true;
      setShowForjaIntro(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [hydrated, pageTab, showIntro]);

  const dismissForjaIntro = () => {
    try {
      window.localStorage.setItem(forjaIntroStorageKey, "1");
    } catch {
      // Ignoramos fallos de storage.
    }
    setShowForjaIntro(false);
  };

  return (
    <div className="space-y-8">
      <SectionHeading
        eyebrow="Sobres"
        title="Cartas de la Triliporra"
        description="Añade un crack a tu once pagando su coste."
        actions={
          <div className="flex flex-wrap items-center justify-center gap-2 sm:flex-nowrap sm:justify-end">
            <button
              type="button"
              onClick={() => setShowIntro(true)}
              aria-label="Cómo funcionan los sobres"
              title="Cómo funciona"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-base font-bold text-zinc-300 transition hover:bg-white/10 hover:text-white"
            >
              ?
            </button>
            <NextCardCountdown />
          </div>
        }
      />

      {/* Región viva persistente: anuncia a lectores de pantalla los mensajes
          de éxito/error sin afectar al layout (el Notice visible va aparte). */}
      <div className="sr-only" role="status" aria-live="polite">
        {message}
      </div>
      {message ? <Notice tone="neutral">{message}</Notice> : null}

      <div className="flex justify-center">
        <div className="inline-flex rounded-xl border border-white/10 bg-white/[0.04] p-1 text-sm font-bold">
          <button
            type="button"
            aria-pressed={pageTab === "sobres"}
            onClick={() => setPageTab("sobres")}
            className={`rounded-lg px-5 py-2 transition ${
              pageTab === "sobres"
                ? "bg-zinc-200 text-zinc-900"
                : "text-zinc-300 hover:bg-white/[0.06] hover:text-white"
            }`}
          >
            Sobres
          </button>
          <button
            type="button"
            aria-pressed={pageTab === "forja"}
            onClick={() => setPageTab("forja")}
            className={`rounded-lg px-5 py-2 transition ${
              pageTab === "forja"
                ? "bg-[#f7c84a] text-black"
                : "text-zinc-300 hover:bg-white/[0.06] hover:text-white"
            }`}
          >
            Forja
          </button>
          <button
            type="button"
            aria-pressed={pageTab === "swaps"}
            onClick={() => setPageTab("swaps")}
            className={`rounded-lg px-5 py-2 transition ${
              pageTab === "swaps"
                ? "bg-zinc-200 text-zinc-900"
                : "text-zinc-300 hover:bg-white/[0.06] hover:text-white"
            }`}
          >
            Swaps
          </button>
        </div>
      </div>

      {pageTab === "sobres" ? (
        <>
          <PackHero
            featuredPack={featuredPack}
            groups={packGroups}
            selectedKey={featuredGroup?.key ?? null}
            onSelectType={setSelectedTypeKey}
            count={unopenedCount}
            opening={opening || preparing}
            hydrated={hydrated && inventoryReady}
            buttonRef={heroButtonRef}
            onOpen={() => {
              if (featuredPack) void openPack(featuredPack);
            }}
          />

          <section ref={collectionRef} className="scroll-mt-4 space-y-4">
            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-white/[0.08]" />
              <span className="text-xs font-bold uppercase tracking-[0.24em] text-[#a7f600]">
                Mi colección
              </span>
              <span className="h-px flex-1 bg-white/[0.08]" />
            </div>

            <div className="grid gap-6 xl:h-[clamp(540px,calc(100vh_-_6rem),820px)] xl:grid-cols-[minmax(0,1fr)_minmax(380px,440px)]">
              <Card className="space-y-4 xl:flex xl:flex-col xl:overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-bold tracking-tight text-white">
                      Tus cartas
                    </h2>
                    <p className="text-sm text-zinc-500">
                      {unusedCards.length
                        ? `${unusedCards.length} sin usar${
                            usedCards.length
                              ? ` · ${usedCards.length} usadas`
                              : ""
                          }`
                        : usedCards.length
                          ? `${usedCards.length} usadas`
                          : "Tu colección está vacía"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedCard ? (
                      <button
                        type="button"
                        onClick={() => setSelectedCardId("")}
                        className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-white/10"
                      >
                        Quitar selección
                      </button>
                    ) : null}
                    <div className="flex rounded-lg border border-white/10 bg-black/20 p-0.5 text-xs font-bold">
                      <button
                        type="button"
                        aria-pressed={inventoryTab === "unused"}
                        onClick={() => setInventoryTab("unused")}
                        className={`rounded-md px-3 py-1.5 transition ${
                          inventoryTab === "unused"
                            ? "bg-[#a7f600] text-black"
                            : "text-zinc-400 hover:text-white"
                        }`}
                      >
                        Sin usar
                        {unusedCards.length ? (
                          <span className="ml-1 opacity-70">
                            {unusedCards.length}
                          </span>
                        ) : null}
                      </button>
                      <button
                        type="button"
                        aria-pressed={inventoryTab === "used"}
                        onClick={() => setInventoryTab("used")}
                        className={`rounded-md px-3 py-1.5 transition ${
                          inventoryTab === "used"
                            ? "bg-[#a7f600] text-black"
                            : "text-zinc-400 hover:text-white"
                        }`}
                      >
                        Usadas
                        {usedCards.length ? (
                          <span className="ml-1 opacity-70">
                            {usedCards.length}
                          </span>
                        ) : null}
                      </button>
                    </div>
                  </div>
                </div>

                {hydrated &&
                (unusedCards.length > 0 || usedCards.length > 0) ? (
                  <div className="relative">
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="11" cy="11" r="7" />
                      <path d="m21 21-4.3-4.3" />
                    </svg>
                    <input
                      type="search"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Buscar jugador, país o puesto"
                      aria-label="Buscar en tu colección"
                      className="w-full rounded-lg border border-white/10 bg-black/20 py-2 pl-9 pr-9 text-sm text-white outline-none transition placeholder:text-zinc-500 focus:border-[#a7f600]/40"
                    />
                    {query ? (
                      <button
                        type="button"
                        onClick={() => setQuery("")}
                        aria-label="Limpiar búsqueda"
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs font-bold text-zinc-400 transition hover:text-white"
                      >
                        ✕
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {hydrated &&
                (unusedCards.length > 0 || usedCards.length > 0) ? (
                  <div className="flex flex-wrap gap-1.5">
                    {(["all", "POR", "DEF", "MED", "DEL"] as const).map(
                      (pos) => (
                        <button
                          key={pos}
                          type="button"
                          aria-pressed={positionFilter === pos}
                          onClick={() => setPositionFilter(pos)}
                          className={`rounded-md px-2.5 py-1 text-xs font-bold transition ${
                            positionFilter === pos
                              ? "bg-[#a7f600] text-black"
                              : "border border-white/10 bg-black/20 text-zinc-400 hover:text-white"
                          }`}
                        >
                          {pos === "all" ? "Todos" : pos}
                        </button>
                      ),
                    )}
                  </div>
                ) : null}

                <div className="team-picker-scroll -ml-1 -mr-2 max-h-[60vh] overflow-y-auto pl-1 pr-2 pt-1 xl:max-h-none xl:min-h-0 xl:flex-1">
                  {!hydrated ? (
                    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5">
                      {Array.from({ length: 10 }).map((_, index) => (
                        <div
                          key={index}
                          className="aspect-[5/7] animate-pulse rounded-lg bg-white/[0.04]"
                        />
                      ))}
                    </div>
                  ) : inventoryTab === "unused" ? (
                    unusedCards.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-white/[0.12] bg-white/[0.03] px-4 py-10 text-center">
                        <p className="text-sm font-semibold text-zinc-300">
                          Aún no tienes cartas sin usar.
                        </p>
                        <p className="mt-1 text-sm text-zinc-500">
                          Abre un sobre de arriba para conseguir cartas.
                        </p>
                      </div>
                    ) : shownUnused.length ? (
                      <div
                        className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5"
                        style={{ perspective: "1000px" }}
                      >
                        {shownUnused.map((card, index) => (
                          <button
                            key={card.id}
                            type="button"
                            aria-pressed={selectedCardId === card.id}
                            onClick={() => {
                              setNewCardIds((current) =>
                                current.filter((id) => id !== card.id),
                              );
                              setLastSwap(null);
                              setSelectedCardId((current) =>
                                current === card.id ? "" : card.id,
                              );
                            }}
                            style={{
                              animationDelay: `${Math.min(index, 9) * 45}ms`,
                            }}
                            className={`cofre-card-reveal relative rounded-lg text-left outline-none transition focus-visible:ring-2 focus-visible:ring-[#a7f600]/60 ${
                              selectedCardId === card.id
                                ? "scale-[1.03]"
                                : "hover:-translate-y-1"
                            }`}
                          >
                            <PlayerCard
                              playerId={card.playerId}
                              points={pointsFor(card.playerId)}
                              eliminated={isPlayerEliminated(card.playerId)}
                              selected={selectedCardId === card.id}
                            />
                            {newCardIds.includes(card.id) ? (
                              <span className="absolute left-1/2 top-1.5 z-10 -translate-x-1/2 rounded-full bg-[#a7f600] px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.1em] text-black shadow-md shadow-black/40">
                                NEW
                              </span>
                            ) : null}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <NoSearchResults query={query} />
                    )
                  ) : usedCards.length === 0 ? (
                    <div className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-8 text-center text-sm text-zinc-500">
                      Todavía no has usado ninguna carta.
                    </div>
                  ) : shownUsed.length ? (
                    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5">
                      {shownUsed.map((card) => (
                        <div
                          key={card.id}
                          className="relative rounded-lg opacity-60"
                        >
                          <PlayerCard
                            playerId={card.playerId}
                            points={pointsFor(card.playerId)}
                            eliminated={isPlayerEliminated(card.playerId)}
                          />
                          <span className="absolute left-2 top-2 rounded-md border border-[#a7f600]/30 bg-[#a7f600]/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[#a7f600]">
                            Usada
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <NoSearchResults query={query} />
                  )}
                </div>
              </Card>

              <div ref={swapPanelRef} className="scroll-mt-4 xl:self-start">
                <SwapPanel
                  activeXi={activeXi}
                  breakdownFor={breakdownFor}
                  candidateFor={candidateFor}
                  lastSwap={lastSwap}
                  isPlayerEliminated={isPlayerEliminated}
                  onClear={() => setSelectedCardId("")}
                  onDismissResult={() => setLastSwap(null)}
                  pointsFor={pointsFor}
                  requestSwap={requestSwap}
                  selectedCard={selectedCard}
                  selectedPlayer={selectedPlayer}
                />
              </div>
            </div>
          </section>
        </>
      ) : pageTab === "forja" ? (
        <section className="space-y-6">
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-white/[0.08]" />
            <span className="text-xs font-bold uppercase tracking-[0.24em] text-[#f7c84a]">
              Forja
            </span>
            <span className="h-px flex-1 bg-white/[0.08]" />
          </div>
          <ForgePanel
            forgeable={forgeableCards}
            inputs={forgeInputs}
            samePosition={forgeSamePosition}
            busy={forgeBusy}
            isPlayerEliminated={isPlayerEliminated}
            pointsFor={pointsFor}
            onToggle={toggleForgeCard}
            onForge={() => void startForge()}
            onShowIntro={() => setShowForjaIntro(true)}
            hydrated={hydrated && inventoryReady}
          />
        </section>
      ) : (
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-white/[0.08]" />
            <span className="text-xs font-bold uppercase tracking-[0.24em] text-[#a7f600]">
              Swaps
            </span>
            <span className="h-px flex-1 bg-white/[0.08]" />
          </div>
          <Card className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold tracking-tight text-white">
                  Swaps de la comunidad
                </h2>
                <p className="text-sm text-zinc-500">
                  {swapLog.length
                    ? `${swapLog.length} fichaje${swapLog.length === 1 ? "" : "s"} en total`
                    : "Aquí aparecen los fichajes de todos los jugadores"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {user ? (
                  <button
                    type="button"
                    aria-pressed={swapsMineOnly}
                    onClick={() => setSwapsMineOnly((value) => !value)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
                      swapsMineOnly
                        ? "border-transparent bg-[#a7f600] text-black"
                        : "border-white/10 text-zinc-300 hover:bg-white/10"
                    }`}
                  >
                    Míos
                  </button>
                ) : null}
                <input
                  type="text"
                  value={swapQuery}
                  onChange={(event) => setSwapQuery(event.target.value)}
                  placeholder="Buscar por nombre"
                  className="w-36 rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-white/25 sm:w-44"
                />
              </div>
            </div>
            {filteredSwaps.length ? (
              <div className="divide-y divide-white/[0.06]">
                {filteredSwaps.slice(0, 30).map((entry) => (
                  <SwapLogRow key={entry.id} entry={entry} />
                ))}
              </div>
            ) : (
              <p className="py-10 text-center text-sm text-zinc-500">
                {swapLog.length
                  ? "Ningún fichaje coincide con el filtro."
                  : "Todavía no hay swaps. Los fichajes de la comunidad aparecerán aquí."}
              </p>
            )}
          </Card>
        </section>
      )}

      {pendingSwap && selectedPlayer ? (
        <ConfirmSwapModal
          candidate={pendingSwap}
          inPlayer={selectedPlayer}
          isPlayerEliminated={isPlayerEliminated}
          busy={swapBusy}
          demo={CARDS_DEMO}
          onCancel={() => setPendingSwap(null)}
          onConfirm={() => void confirmSwap()}
        />
      ) : null}

      {/* Modales auxiliares de /cofres. */}
      {showIntro ? <CofresIntroModal onClose={dismissIntro} /> : null}
      {showForjaIntro ? <ForjaIntroModal onClose={dismissForjaIntro} /> : null}

      {opening && activePack ? (
        <PackOpeningOverlay
          initialPackId={activePack.id}
          onAccept={(pack) =>
            acceptPackOpening(
              packs.find((item) => item.id === pack.id) || activePack,
            )
          }
          onClose={() => setOpening(false)}
          isPlayerEliminated={isPlayerEliminated}
          packs={overlayPacks}
          pointsFor={pointsFor}
        />
      ) : null}

      {forgeActive ? (
        <CardUpgradeOverlay
          inputs={forgeActive.inputs.map((card) => ({
            id: card.id,
            playerId: card.playerId,
          }))}
          resultPlayerId={forgeActive.resultCard.playerId}
          isPlayerEliminated={isPlayerEliminated}
          pointsFor={pointsFor}
          onDone={finishForge}
        />
      ) : null}
    </div>
  );
}

// Color del glow del hero según el sobre (misma paleta que las luces de la
// escena 3D): verde diario/promesas, plata Madrid, oro sobre21, azul Estrellas.
// Devuelve "r,g,b" para componer rgba(...).
const PACK_GLOW: Record<NonNullable<Pack["flap"]>, string> = {
  green: "167,246,0",
  white: "215,227,255",
  black: "255,210,77",
  navy: "106,166,255",
  royal: "96,150,255", // Francia: azul royal
  red: "255,78,70",
};
function packGlowRgb(pack: Pack | null): string {
  return PACK_GLOW[pack?.flap ?? "green"] ?? PACK_GLOW.green;
}

// Panel de la Forja: 4 ranuras para cartas comunes + previsualización del premio
// + el picker de tu colección. El botón Upgrade dispara la fusión (overlay).
function ForgePanel({
  busy,
  forgeable,
  hydrated,
  inputs,
  isPlayerEliminated,
  onForge,
  onShowIntro,
  onToggle,
  pointsFor,
  samePosition,
}: {
  busy: boolean;
  forgeable: InventoryCard[];
  hydrated: boolean;
  inputs: InventoryCard[];
  isPlayerEliminated: (playerId: string) => boolean;
  onForge: () => void;
  onShowIntro: () => void;
  onToggle: (cardId: string) => void;
  pointsFor: (playerId: string) => number;
  samePosition: Position | null;
}) {
  const ready = inputs.length === 4;
  const statusText = !ready
    ? `${inputs.length}/4 cartas seleccionadas`
    : samePosition
      ? `Saldrá una legendaria de ${positionLabel[samePosition].toLowerCase()}`
      : "Saldrá una legendaria aleatoria";

  // Buscador + filtro por puesto del picker (estado propio, no toca el del
  // inventario de la pestaña Sobres).
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerPosition, setPickerPosition] = useState<Position | "all">("all");
  const normalizedQuery = normalizeSearch(pickerQuery.trim());
  const shown = useMemo(
    () =>
      sortCardsByPoints(
        forgeable.filter(
          (card) =>
            cardMatchesQuery(card, normalizedQuery) &&
            cardMatchesPosition(card, pickerPosition),
        ),
        pointsFor,
      ),
    [forgeable, normalizedQuery, pickerPosition, pointsFor],
  );

  return (
    <Card className="space-y-6">
      <div className="space-y-1 text-center">
        <div className="flex items-center justify-center gap-2">
          <h2 className="text-xl font-bold tracking-tight text-white">
            Forja una legendaria
          </h2>
          <button
            type="button"
            onClick={onShowIntro}
            aria-label="Cómo funciona la forja"
            title="Cómo funciona"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[#f7c84a]/30 bg-[#f7c84a]/10 text-sm font-bold text-[#f7c84a] transition hover:bg-[#f7c84a]/20"
          >
            ?
          </button>
        </div>
        <p className="mx-auto max-w-md text-sm text-zinc-400">
          Funde 4 cartas en 1 de máxima rareza. Si las 4 son del mismo puesto,
          la legendaria saldrá de ese puesto.
        </p>
      </div>

      {/* Altar: 4 ranuras → premio. */}
      <div className="flex flex-col items-center gap-4 lg:flex-row lg:justify-center lg:gap-7">
        <div className="grid grid-cols-4 gap-2 sm:gap-3">
          {Array.from({ length: 4 }).map((_, index) => {
            const card = inputs[index];
            if (!card) {
              return (
                <div
                  key={`slot-${index}`}
                  className="flex aspect-[5/7] w-[68px] flex-col items-center justify-center rounded-lg border border-dashed border-[#f7c84a]/25 bg-white/[0.02] text-[#f7c84a]/50 sm:w-[84px]"
                >
                  <span className="text-2xl font-bold leading-none">+</span>
                  <span className="mt-1 text-[9px] font-bold uppercase tracking-wide">
                    carta
                  </span>
                </div>
              );
            }
            return (
              <button
                key={card.id}
                type="button"
                onClick={() => onToggle(card.id)}
                disabled={busy}
                aria-label={`Quitar ${playersById.get(card.playerId)?.name ?? "carta"}`}
                className="group relative w-[68px] rounded-lg outline-none transition focus-visible:ring-2 focus-visible:ring-[#f7c84a]/60 disabled:opacity-60 sm:w-[84px]"
              >
                <PlayerCard
                  playerId={card.playerId}
                  points={pointsFor(card.playerId)}
                  eliminated={isPlayerEliminated(card.playerId)}
                />
                <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/0 opacity-0 transition group-hover:bg-black/45 group-hover:opacity-100">
                  <span className="rounded-full bg-black/70 px-2 py-1 text-[10px] font-bold text-white">
                    Quitar
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <span
          aria-hidden="true"
          className="rotate-90 text-2xl font-bold text-[#f7c84a] lg:rotate-0"
        >
          →
        </span>

        {/* Previsualización del premio (legendaria misteriosa). Es una carta:
            theme-dark para que su oro siga vivo aunque la web esté en claro. */}
        <div
          className="theme-dark flex aspect-[5/7] w-[92px] flex-col items-center justify-center rounded-lg border sm:w-[108px]"
          style={{
            borderColor: "rgba(247,200,74,0.6)",
            // Base oscura OPACA + degradado encima: sin esto el degradado es
            // semitransparente y en light mode se cuela el blanco por el centro.
            backgroundColor: "#0a0f1a",
            backgroundImage:
              "radial-gradient(70% 60% at 50% 38%, rgba(247,200,74,0.22), rgba(10,15,26,0.95))",
            boxShadow: ready ? "0 0 26px rgba(247,200,74,0.28)" : "none",
          }}
        >
          <span className="text-3xl text-[#f7c84a]">✦</span>
          <span className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[#f7c84a]">
            Legendaria
          </span>
        </div>
      </div>

      {/* Estado + botón. */}
      <div className="flex flex-col items-center gap-3">
        <span className="text-sm font-semibold text-zinc-300">
          {statusText}
        </span>
        <button
          type="button"
          onClick={onForge}
          disabled={!ready || busy}
          className="w-full max-w-xs rounded-full bg-[#f7c84a] px-8 py-3.5 text-base font-bold uppercase tracking-wide text-black shadow-2xl shadow-[#f7c84a]/20 transition hover:bg-[#ffd966] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
        >
          {busy ? "Forjando…" : "Upgrade"}
        </button>
      </div>

      {/* Picker: tus cartas sin usar (buscador + filtro por puesto). */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <span className="h-px flex-1 bg-white/[0.08]" />
          <span className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-400">
            Tus cartas
          </span>
          <span className="h-px flex-1 bg-white/[0.08]" />
        </div>

        {hydrated && forgeable.length > 0 ? (
          <>
            <div className="relative">
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <input
                type="search"
                value={pickerQuery}
                onChange={(event) => setPickerQuery(event.target.value)}
                placeholder="Buscar jugador, país o puesto"
                aria-label="Buscar entre tus cartas"
                className="w-full rounded-lg border border-white/10 bg-black/20 py-2 pl-9 pr-9 text-sm text-white outline-none transition placeholder:text-zinc-500 focus:border-[#f7c84a]/40"
              />
              {pickerQuery ? (
                <button
                  type="button"
                  onClick={() => setPickerQuery("")}
                  aria-label="Limpiar búsqueda"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs font-bold text-zinc-400 transition hover:text-white"
                >
                  ✕
                </button>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(["all", "POR", "DEF", "MED", "DEL"] as const).map((pos) => (
                <button
                  key={pos}
                  type="button"
                  aria-pressed={pickerPosition === pos}
                  onClick={() => setPickerPosition(pos)}
                  className={`rounded-md px-2.5 py-1 text-xs font-bold transition ${
                    pickerPosition === pos
                      ? "bg-[#f7c84a] text-black"
                      : "border border-white/10 bg-black/20 text-zinc-400 hover:text-white"
                  }`}
                >
                  {pos === "all" ? "Todos" : pos}
                </button>
              ))}
            </div>
          </>
        ) : null}

        {!hydrated ? (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5">
            {Array.from({ length: 5 }).map((_, index) => (
              <div
                key={index}
                className="aspect-[5/7] animate-pulse rounded-lg bg-white/[0.04]"
              />
            ))}
          </div>
        ) : forgeable.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/[0.12] bg-white/[0.03] px-4 py-10 text-center">
            <p className="text-sm font-semibold text-zinc-300">
              No tienes cartas sin usar.
            </p>
            <p className="mt-1 text-sm text-zinc-500">
              Abre sobres para conseguir cartas que forjar.
            </p>
          </div>
        ) : shown.length === 0 ? (
          <NoSearchResults query={pickerQuery} />
        ) : (
          <div
            className="grid grid-cols-3 gap-3 pt-3 sm:grid-cols-4 lg:grid-cols-5"
            style={{ perspective: "1000px" }}
          >
            {shown.map((card) => {
              const order = inputs.findIndex((item) => item.id === card.id);
              const selected = order >= 0;
              const full = inputs.length >= 4;
              return (
                <button
                  key={card.id}
                  type="button"
                  aria-pressed={selected}
                  disabled={busy || (!selected && full)}
                  onClick={() => onToggle(card.id)}
                  className={`relative rounded-lg text-left outline-none transition focus-visible:ring-2 focus-visible:ring-[#f7c84a]/60 ${
                    selected
                      ? "scale-[1.03]"
                      : full
                        ? "opacity-40"
                        : "hover:-translate-y-1"
                  }`}
                >
                  <PlayerCard
                    playerId={card.playerId}
                    points={pointsFor(card.playerId)}
                    eliminated={isPlayerEliminated(card.playerId)}
                    selected={selected}
                  />
                  {selected ? (
                    <span className="absolute right-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-[#f7c84a] text-xs font-bold text-black shadow-md shadow-black/40">
                      {order + 1}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}

function PackHero({
  buttonRef,
  count,
  featuredPack,
  groups,
  hydrated,
  onOpen,
  onSelectType,
  opening,
  selectedKey,
}: {
  buttonRef: RefObject<HTMLButtonElement | null>;
  count: number;
  featuredPack: Pack | null;
  groups: PackGroup[];
  hydrated: boolean;
  onOpen: () => void;
  onSelectType: (key: string) => void;
  opening: boolean;
  selectedKey: string | null;
}) {
  const special = featuredPack?.kind === "special";
  const empty = count === 0;
  // Cuántos sobres tienes del tipo seleccionado (para el chip de la píldora).
  const selectedCount =
    groups.find((group) => group.key === selectedKey)?.packs.length ?? 0;
  // Color del glow según el sobre (verde, plata, oro o azul).
  const glow = packGlowRgb(featuredPack);

  // El <Image> del sobre tarda en descargar/optimizar (sobre todo el 1er hit en
  // prod) y dejaba el hueco en blanco. Mostramos un skeleton hasta que carga y
  // lo fundimos al entrar. Guardamos la SRC ya cargada (no un bool) para que al
  // cambiar de sobre en la estantería reaparezca el skeleton sin parpadeo.
  const sobreSrc = featuredPack?.image || "/sobre.webp";
  const [loadedSrc, setLoadedSrc] = useState("");
  const sobreLoaded = loadedSrc === sobreSrc;

  if (!hydrated) {
    // El skeleton replica la estructura real (pill + sobre + contador + label +
    // CTA) con los mismos márgenes para que al hidratar no haya salto de layout.
    return (
      <section className="relative flex min-h-[58svh] flex-col items-center justify-center py-6">
        <div className="mb-5 h-7 w-28 animate-pulse rounded-full bg-white/[0.04]" />
        <div className="aspect-[818/1206] w-[clamp(190px,56vw,300px)] animate-pulse rounded-2xl bg-white/[0.04]" />
        <div className="mt-7 h-12 w-14 animate-pulse rounded-lg bg-white/[0.04]" />
        <div className="mt-1.5 h-3 w-32 animate-pulse rounded bg-white/[0.04]" />
        <div className="mt-6 h-11 w-40 animate-pulse rounded-lg bg-white/[0.04]" />
      </section>
    );
  }

  return (
    <section className="relative flex min-h-[58svh] flex-col items-center justify-center overflow-hidden py-6">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={
          empty
            ? undefined
            : {
                background: `radial-gradient(58% 46% at 50% 42%, rgba(${glow},0.16), transparent 70%)`,
              }
        }
      />

      <span
        className={`z-10 mb-5 inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-bold uppercase tracking-[0.18em] ${
          empty
            ? "border-white/10 bg-white/[0.04] text-zinc-400"
            : special
              ? "border-[#ffd252]/30 bg-[#ffd252]/10 text-[#ffd252]"
              : "border-[#a7f600]/30 bg-[#a7f600]/10 text-[#a7f600]"
        }`}
      >
        {empty
          ? "Sin sobres"
          : special
            ? featuredPack?.title || "Drop especial"
            : "Sobre diario"}
        {!empty && selectedCount > 0 ? (
          <span className="rounded-full bg-white/15 px-1.5 py-px text-[11px] font-bold leading-none">
            ×{selectedCount}
          </span>
        ) : null}
      </span>

      <button
        ref={buttonRef}
        type="button"
        onClick={onOpen}
        disabled={opening || empty}
        aria-label={
          empty
            ? "No hay sobres disponibles"
            : `Abrir sobre. Te quedan ${count} por abrir.`
        }
        className="group relative z-10 flex aspect-[818/1206] w-[clamp(190px,56vw,300px)] items-center justify-center rounded-2xl outline-none [perspective:1200px] focus-visible:ring-2 focus-visible:ring-[#a7f600]/60 disabled:cursor-default"
      >
        {/* Glow del sobre: radial ESTÁTICO detrás (no flota ni se inclina ni
            usa filter). Antes era un filter:drop-shadow sobre la capa animada +
            preserve-3d, que en iOS Safari se rasterizaba como un RECTÁNGULO y
            parpadeaba/desaparecía al hacer scroll. Color según el sobre. */}
        {empty ? null : (
          <span
            aria-hidden
            className="pointer-events-none absolute -inset-4 sm:-inset-6"
            style={{
              background: `radial-gradient(60% 56% at 50% 56%, rgba(${glow},0.42), rgba(${glow},0.12) 58%, transparent 80%)`,
            }}
          />
        )}
        {/* Dos capas: la EXTERIOR flota (cofre-hero-float, transform propio); la
            INTERIOR hace el tilt de hover y el scale de active. Si fueran el
            mismo elemento, la animación en curso pisaría el transform del hover
            y el tilt/scale nunca se verían. */}
        <span
          className={`relative block h-full w-full ${
            empty
              ? ""
              : "motion-safe:animate-[cofre-hero-float_5s_ease-in-out_infinite]"
          }`}
        >
          <span
            className={`relative block h-full w-full transition-transform duration-300 [transform-style:preserve-3d] ${
              empty
                ? "opacity-40 grayscale"
                : "group-hover:[transform:rotateX(6deg)_rotateY(-8deg)_translateY(-6px)] group-active:scale-[1.04]"
            }`}
          >
            {/* Skeleton en el hueco del sobre hasta que la imagen carga. */}
            {sobreLoaded ? null : (
              <span
                aria-hidden
                className="absolute inset-0 animate-pulse rounded-2xl bg-white/[0.05]"
              />
            )}
            <Image
              src={sobreSrc}
              alt="Sobre de cartas de la Triliporra 2026"
              fill
              priority
              sizes="(max-width: 640px) 56vw, 300px"
              onLoad={() => setLoadedSrc(sobreSrc)}
              className={`select-none object-contain transition-opacity duration-500 ${
                sobreLoaded ? "opacity-100" : "opacity-0"
              }`}
            />
          </span>
        </span>
      </button>

      <p
        className="z-10 mt-7 text-5xl font-bold leading-none text-white tabular-nums sm:text-6xl"
        aria-live="polite"
        aria-label={`${count} ${count === 1 ? "sobre" : "sobres"} por abrir`}
      >
        {count}
      </p>
      <p
        aria-hidden
        className="z-10 mt-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500"
      >
        {count === 1 ? "sobre por abrir" : "sobres por abrir"}
      </p>

      {/* Estantería: una miniatura pequeña y sutil por tipo de sobre, con su
          cantidad. Al pulsar se cambia el sobre destacado (el grande de arriba).
          Solo aparece si hay más de un tipo disponible. */}
      {!empty && groups.length > 1 ? (
        <div className="z-10 mt-4 flex items-start justify-center gap-3">
          {groups.map((group) => {
            const isSel = group.key === selectedKey;
            return (
              <button
                key={group.key}
                type="button"
                onClick={() => onSelectType(group.key)}
                aria-pressed={isSel}
                aria-label={`${group.label}: ${group.packs.length} ${
                  group.packs.length === 1 ? "sobre" : "sobres"
                }`}
                className={`flex flex-col items-center gap-1 transition ${
                  isSel ? "" : "opacity-40 hover:opacity-75"
                }`}
              >
                <span
                  className={`relative block aspect-[818/1206] w-7 overflow-hidden rounded-[3px] transition ${
                    isSel ? "ring-1 ring-white/70" : ""
                  }`}
                >
                  <Image
                    src={group.image}
                    alt=""
                    fill
                    sizes="32px"
                    className="object-contain"
                  />
                </span>
                <span className="text-[10px] font-bold leading-none tabular-nums text-zinc-300">
                  ×{group.packs.length}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      <button
        type="button"
        onClick={onOpen}
        disabled={opening || empty}
        className="z-10 mt-6 rounded-lg bg-[#a7f600] px-7 py-3 text-sm font-bold text-black shadow-lg shadow-[#a7f600]/10 transition hover:bg-[#c7ff43] disabled:opacity-50 disabled:hover:bg-[#a7f600]"
      >
        {opening ? "Abriendo…" : empty ? "Vuelve mañana" : "Abrir sobre"}
      </button>
      {empty ? (
        <p className="z-10 mt-3 max-w-xs text-center text-xs text-zinc-400">
          Has abierto todos tus sobres. Vuelve mañana a por el diario.
        </p>
      ) : null}
    </section>
  );
}

function SwapPanel({
  activeXi,
  breakdownFor,
  candidateFor,
  isPlayerEliminated,
  lastSwap,
  onClear,
  onDismissResult,
  pointsFor,
  requestSwap,
  selectedCard,
  selectedPlayer,
}: {
  activeXi: string[];
  breakdownFor: (playerId: string) => PlayerBreakdown;
  candidateFor: (outPlayer: Player) => SwapCandidate;
  isPlayerEliminated: (playerId: string) => boolean;
  lastSwap: { inPlayerId: string; outPlayerId: string } | null;
  onClear: () => void;
  onDismissResult: () => void;
  pointsFor: (playerId: string) => number;
  requestSwap: (candidate: SwapCandidate) => void;
  selectedCard: InventoryCard | undefined;
  selectedPlayer: Player | null | undefined;
}) {
  // Tras un cambio (no demo): muestra el NUEVO once con el fichaje resaltado.
  if (lastSwap && (!selectedCard || !selectedPlayer)) {
    return (
      <SwapResult
        activeXi={activeXi}
        breakdownFor={breakdownFor}
        lastSwap={lastSwap}
        onDismiss={onDismissResult}
        pointsFor={pointsFor}
      />
    );
  }

  // El panel se muestra SIEMPRE con el once; el slot de la carta enseña un
  // placeholder cuando no hay carta seleccionada. Estos datos solo se usan
  // cuando hay carta.
  const samePosTitulares = selectedPlayer
    ? activeXi
        .map((playerId) => playersById.get(playerId))
        .filter(
          (player): player is Player =>
            player != null && player.position === selectedPlayer.position,
        )
    : [];
  const eligibleCount = samePosTitulares.filter(
    (player) => candidateFor(player).eligible,
  ).length;
  const selectedPhoto = selectedPlayer ? playerPhotoUrl(selectedPlayer) : "";
  const selectedPts = selectedPlayer ? pointsFor(selectedPlayer.id) : 0;
  const selectedBreakdown = selectedPlayer
    ? breakdownFor(selectedPlayer.id)
    : null;
  const selectedEliminated = selectedPlayer
    ? isPlayerEliminated(selectedPlayer.id)
    : false;

  return (
    <Card className="space-y-4 select-none">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white">
            Mete tu carta
          </h2>
          <p className="text-sm text-zinc-500">
            Cambia un jugador de tu once por tu carta.
          </p>
        </div>
        {selectedPlayer ? (
          <button
            type="button"
            onClick={onClear}
            className="shrink-0 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-white/10"
          >
            Cerrar
          </button>
        ) : null}
      </div>

      {selectedPlayer ? (
        <div className="rounded-xl border border-[#a7f600]/30 bg-gradient-to-br from-[#a7f600]/[0.14] to-transparent p-3">
          <div className="flex items-center gap-3">
            <span className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[#a7f600]/40 bg-zinc-900">
              {selectedPhoto ? (
                <Image
                  src={selectedPhoto}
                  alt=""
                  fill
                  sizes="56px"
                  className="object-cover"
                  unoptimized
                />
              ) : (
                <span className="text-sm font-bold text-[#a7f600]">
                  {initials(selectedPlayer.name)}
                </span>
              )}
            </span>
            <div className="min-w-0 flex-1">
              <span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-[#a7f600]/80">
                Entra a tu once
              </span>
              <p className="mt-0.5 flex items-center gap-1.5">
                <TeamFlag
                  teamId={selectedPlayer.team}
                  className="h-3.5 w-5 shrink-0 rounded-sm"
                />
                <span className="min-w-0 truncate text-base font-bold text-white">
                  {selectedPlayer.name}
                </span>
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {selectedEliminated ? (
                  <span className="rounded-md border border-red-400/25 bg-red-500/10 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em] text-red-200">
                    Equipo eliminado
                  </span>
                ) : null}
                {selectedBreakdown && hasAnyEvent(selectedBreakdown) ? (
                  <EventPills breakdown={selectedBreakdown} />
                ) : (
                  <span className="text-[11px] text-zinc-400">
                    Sin acciones todavía
                  </span>
                )}
              </div>
            </div>
            <div className="shrink-0 self-stretch text-right">
              <span
                className={`block text-3xl font-bold leading-none tabular-nums ${
                  selectedPts > 0
                    ? "text-[#a7f600]"
                    : selectedPts < 0
                      ? "text-rose-300"
                      : "text-white"
                }`}
              >
                {formatSigned(selectedPts)}
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                puntos
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-xl border border-dashed border-white/[0.14] bg-white/[0.02] p-3">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border-2 border-dashed border-[#a7f600]/30 bg-[#a7f600]/[0.04]">
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="h-6 w-6 text-[#a7f600]/60"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
          </span>
          <div className="min-w-0">
            <span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
              Tu carta
            </span>
            <p className="mt-0.5 text-sm font-bold text-white">
              Selecciona una carta
            </p>
            <p className="mt-0.5 text-xs text-zinc-500">
              Elígela de tu colección para cambiarla por un jugador de tu once.
            </p>
          </div>
        </div>
      )}

      {CARDS_DEMO ? (
        <Notice tone="warm">
          Modo demo: pulsa un titular de tu puesto para ver cómo quedaría el
          cambio. Confirmarlo estará disponible pronto.
        </Notice>
      ) : !selectedPlayer ? null : samePosTitulares.length === 0 ? (
        <Notice tone="warm">No hay titulares de este puesto en tu once.</Notice>
      ) : eligibleCount === 0 ? (
        <Notice tone="danger">
          Tu carta tiene más puntos que todos los titulares de su puesto.
        </Notice>
      ) : (
        <p className="text-xs text-zinc-500">
          Toca un{" "}
          <span className="font-bold text-[#a7f600]">
            {positionLabel[selectedPlayer.position].toLowerCase()}
          </span>{" "}
          resaltado del campo para cambiarlo por tu carta.
        </p>
      )}

      <SwapPitch
        activeXi={activeXi}
        breakdownFor={breakdownFor}
        candidateFor={candidateFor}
        pointsFor={pointsFor}
        requestSwap={requestSwap}
        selectedPosition={selectedPlayer?.position}
      />
    </Card>
  );
}

// Vista tras un cambio: en vez de resetear a vacío, muestra tu NUEVO once con
// el jugador que acaba de entrar resaltado (✓), para que el cambio se sienta.
function SwapResult({
  activeXi,
  breakdownFor,
  lastSwap,
  onDismiss,
  pointsFor,
}: {
  activeXi: string[];
  breakdownFor: (playerId: string) => PlayerBreakdown;
  lastSwap: { inPlayerId: string; outPlayerId: string };
  onDismiss: () => void;
  pointsFor: (playerId: string) => number;
}) {
  const inPlayer = playersById.get(lastSwap.inPlayerId);
  const outPlayer = playersById.get(lastSwap.outPlayerId);
  return (
    <Card className="space-y-4 select-none xl:flex xl:h-full xl:flex-col">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#a7f600]/15 text-[#a7f600]">
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-bold tracking-tight text-white">
              ¡Cambio hecho!
            </h2>
            <p className="truncate text-xs text-zinc-500">
              {inPlayer?.name || "Tu carta"} entra
              {outPlayer ? ` por ${outPlayer.name}` : ""}.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-white/10"
        >
          Listo
        </button>
      </div>
      <p className="text-sm text-zinc-500">
        Este es tu nuevo once. Selecciona otra carta para seguir cambiando.
      </p>
      <SwapPitch
        activeXi={activeXi}
        breakdownFor={breakdownFor}
        enteredId={lastSwap.inPlayerId}
        pointsFor={pointsFor}
      />
    </Card>
  );
}

// Mini-campo de fútbol para el swap (mismo lenguaje visual que el "once" del
// perfil). Coloca el once por puestos (delanteros arriba, portero abajo); cada
// jugador muestra sus puntos. Los del MISMO puesto que la carta seleccionada se
// resaltan y son pulsables (cambiar); el resto es contexto. Debajo, el total.
function SwapPitchLines() {
  return (
    <div className="pointer-events-none absolute inset-0 text-emerald-100/35">
      <div className="absolute inset-0 border-2 border-current" />
      <div className="absolute left-0 right-0 top-1/2 border-t-2 border-current" />
      <div className="absolute left-1/2 top-1/2 h-20 w-20 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-current sm:h-28 sm:w-28" />
      <div className="absolute left-1/2 top-0 h-12 w-28 -translate-x-1/2 rounded-b-2xl border-2 border-t-0 border-current sm:h-16 sm:w-40" />
      <div className="absolute bottom-0 left-1/2 h-12 w-28 -translate-x-1/2 rounded-t-2xl border-2 border-b-0 border-current sm:h-16 sm:w-40" />
    </div>
  );
}

function PitchPlayer({
  breakdown,
  dimmed,
  eligible,
  entered,
  onSwap,
  player,
  points,
  swappable,
}: {
  breakdown: PlayerBreakdown;
  dimmed: boolean;
  eligible: boolean;
  entered: boolean;
  onSwap?: () => void;
  player: Player;
  points: number;
  swappable: boolean;
}) {
  const photo = playerPhotoUrl(player);
  const pills = breakdownPills.filter((pill) => breakdown[pill.key] > 0);
  const ring =
    entered || eligible
      ? "border-[#a7f600] shadow-[0_0_0_3px_rgba(167,246,0,0.45)]"
      : swappable
        ? "border-amber-300/70"
        : "border-white/70";
  const inner = (
    <>
      <span className="relative inline-flex">
        <span
          className={`relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border-2 bg-zinc-900 sm:h-12 sm:w-12 ${ring}`}
        >
          {photo ? (
            <Image
              src={photo}
              alt=""
              fill
              sizes="48px"
              className="object-cover"
              unoptimized
            />
          ) : (
            <span className="text-[10px] font-bold text-[#a7f600]">
              {initials(player.name)}
            </span>
          )}
        </span>
        <span
          className={`absolute -bottom-1.5 left-1/2 -translate-x-1/2 rounded-md border border-black/40 bg-[#0b140b] px-1.5 py-px text-[10px] font-bold leading-none tabular-nums shadow ${
            points > 0
              ? "text-[#a7f600]"
              : points < 0
                ? "text-rose-300"
                : "text-zinc-300"
          }`}
        >
          {formatSigned(points)}
        </span>
        {entered ? (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#a7f600] text-[10px] font-bold text-black shadow">
            ✓
          </span>
        ) : eligible ? (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#a7f600] text-[9px] font-bold text-black shadow">
            ↔
          </span>
        ) : null}
      </span>
      <span className="mt-2 flex max-w-full items-center justify-center gap-1">
        <TeamFlag
          teamId={player.team}
          className="h-2.5 w-3.5 shrink-0 rounded-[2px]"
        />
        <span className="truncate text-[10px] font-bold leading-tight text-white drop-shadow sm:text-xs">
          {player.name}
        </span>
      </span>
      {pills.length ? (
        <span className="mt-1 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5">
          {pills.map((pill) => (
            <span
              key={pill.key}
              title={`${pill.label}: ${breakdown[pill.key]}`}
              className="inline-flex items-center gap-0.5 text-[9px] font-bold leading-none text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)] sm:text-[10px]"
            >
              <span aria-hidden>{pill.icon}</span>
              {breakdown[pill.key]}
              <span className="sr-only">{pill.label}</span>
            </span>
          ))}
        </span>
      ) : null}
    </>
  );
  const base =
    "mx-auto flex w-14 flex-col items-center text-center sm:w-[4.75rem]";
  if (onSwap) {
    return (
      <button
        type="button"
        onClick={onSwap}
        aria-label={`Cambiar a ${player.name} (${formatSigned(points)} pts) por tu carta`}
        className={`${base} rounded-lg outline-none transition hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-[#a7f600]/70`}
      >
        {inner}
      </button>
    );
  }
  return <div className={`${base} ${dimmed ? "opacity-45" : ""}`}>{inner}</div>;
}

function SwapPitch({
  activeXi,
  breakdownFor,
  candidateFor,
  enteredId,
  pointsFor,
  requestSwap,
  selectedPosition,
}: {
  activeXi: string[];
  breakdownFor: (playerId: string) => PlayerBreakdown;
  candidateFor?: (outPlayer: Player) => SwapCandidate;
  enteredId?: string;
  pointsFor: (playerId: string) => number;
  requestSwap?: (candidate: SwapCandidate) => void;
  selectedPosition?: Position;
}) {
  const rowOrder: Position[] = ["DEL", "MED", "DEF", "POR"];
  const rows = rowOrder
    .map((position) => ({
      position,
      players: activeXi
        .map((playerId) => playersById.get(playerId))
        .filter(
          (player): player is Player =>
            player != null && player.position === position,
        ),
    }))
    .filter((row) => row.players.length > 0);
  const total = activeXi.reduce(
    (sum, playerId) => sum + pointsFor(playerId),
    0,
  );

  return (
    <div className="space-y-3">
      {/* Frame verde que ESCALA con el panel; dentro, el campo con ancho FIJO
          (max-w + mx-auto) para que no se estire gigante cuando el panel va a
          ancho completo. Mismo patrón que el LineupBuilder de predicción. */}
      <div className="theme-dark overflow-hidden rounded-xl border border-emerald-300/15 bg-emerald-700 p-3 shadow-lg shadow-emerald-950/20">
        <div className="relative mx-auto aspect-[5/6] w-full max-w-[460px] overflow-hidden rounded-lg border border-emerald-200/20 bg-emerald-600">
          <SwapPitchLines />
          <div className="relative z-10 flex h-full flex-col justify-between px-2 py-4 sm:px-4">
            {rows.map((row) => (
              <div
                key={row.position}
                className="grid items-center gap-1"
                style={{
                  gridTemplateColumns: `repeat(${row.players.length}, minmax(0, 1fr))`,
                }}
              >
                {row.players.map((player) => {
                  const inSwapMode = selectedPosition != null;
                  const swappable =
                    inSwapMode && player.position === selectedPosition;
                  const candidate =
                    swappable && candidateFor ? candidateFor(player) : null;
                  const eligible = Boolean(candidate?.eligible);
                  const entered = player.id === enteredId;
                  return (
                    <PitchPlayer
                      key={player.id}
                      player={player}
                      points={pointsFor(player.id)}
                      breakdown={breakdownFor(player.id)}
                      swappable={swappable}
                      eligible={eligible}
                      entered={entered}
                      dimmed={inSwapMode && !swappable}
                      onSwap={
                        candidate && eligible && requestSwap
                          ? () => requestSwap(candidate)
                          : undefined
                      }
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2.5">
        <span className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-400">
          Total del once
        </span>
        <span
          className={`text-2xl font-bold leading-none tabular-nums ${
            total > 0
              ? "text-[#a7f600]"
              : total < 0
                ? "text-rose-300"
                : "text-white"
          }`}
        >
          {formatSigned(total)}
          <span className="ml-1 text-xs font-semibold text-zinc-500">pts</span>
        </span>
      </div>
    </div>
  );
}

// Pill de la cabecera: cuenta atrás hasta la próxima carta diaria (10:00 Madrid).
function NextCardCountdown() {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setRemaining(secondsUntilNextDailyCard());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="flex items-center gap-2 rounded-lg border border-[#a7f600]/25 bg-[#a7f600]/[0.08] px-3 py-2">
      <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#a7f600]/70">
        Nuevo sobre en
      </span>
      <span className="text-base font-bold leading-none text-white tabular-nums sm:text-lg">
        {remaining == null ? "--:--:--" : formatCountdownHMS(remaining)}
      </span>
    </div>
  );
}

function NoSearchResults({ query }: { query: string }) {
  return (
    <div className="rounded-lg border border-dashed border-white/[0.12] bg-white/[0.03] px-4 py-10 text-center text-sm text-zinc-400">
      {query ? (
        <>
          Ningún jugador coincide con{" "}
          <strong className="text-white">«{query}»</strong>.
        </>
      ) : (
        "No tienes cartas de ese puesto."
      )}
    </div>
  );
}

// Desglose visual: una pill por tipo de acción con su icono y el número de veces.
function EventPills({ breakdown }: { breakdown: PlayerBreakdown }) {
  const items = breakdownPills.filter((pill) => breakdown[pill.key] > 0);
  if (!items.length) return null;
  return (
    <>
      {items.map((pill) => (
        <span
          key={pill.key}
          title={`${pill.label}: ${breakdown[pill.key]}`}
          className={`inline-flex items-center gap-0.5 rounded-md border px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${
            pill.tone === "pos"
              ? "border-[#a7f600]/20 bg-[#a7f600]/[0.08] text-[#a7f600]"
              : "border-rose-400/20 bg-rose-400/[0.08] text-rose-200"
          }`}
        >
          <span aria-hidden>{pill.icon}</span>
          <span className="text-white">{breakdown[pill.key]}</span>
          <span className="sr-only">{pill.label}</span>
        </span>
      ))}
    </>
  );
}

function ConfirmSwapModal({
  busy,
  candidate,
  demo,
  inPlayer,
  isPlayerEliminated,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  candidate: SwapCandidate;
  demo: boolean;
  inPlayer: Player;
  isPlayerEliminated: (playerId: string) => boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { outPlayer, inPoints, outPoints, delta } = candidate;
  const down = delta < 0;
  const up = delta > 0;
  const [acknowledged, setAcknowledged] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-[#0f0f0f] shadow-2xl shadow-black/60 motion-safe:animate-[cofre-modal-pop_220ms_cubic-bezier(0.2,0.9,0.3,1)_both]">
        <div className="px-5 pt-5 text-center">
          <h3 className="text-xl font-bold text-white">Confirmar cambio</h3>
          <p className="mt-1 text-sm text-zinc-500">
            Esto modifica tu once al instante.
          </p>
        </div>

        {/* Las dos cartas con la flecha de canje en medio. */}
        <div className="flex items-center justify-center gap-2 px-4 py-6">
          <SwapModalCard
            label="Pierdes"
            tone="out"
            playerId={outPlayer.id}
            points={outPoints}
            eliminated={isPlayerEliminated(outPlayer.id)}
          />
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-xl text-white shadow-lg">
            ⇄
          </span>
          <SwapModalCard
            label="Entra"
            tone="in"
            playerId={inPlayer.id}
            points={inPoints}
            eliminated={isPlayerEliminated(inPlayer.id)}
            highlighted
          />
        </div>

        {/* Impacto en puntos: lo que pierdes, lo que te queda y el marcador. */}
        <div className="mx-5 mb-5 overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]">
          <div className="grid grid-cols-2 divide-x divide-white/[0.06]">
            <div className="px-3 py-3 text-center">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-red-400/70">
                Pierdes
              </p>
              <p className="mt-1 text-xl font-bold leading-none tabular-nums text-white line-through decoration-red-400 decoration-2">
                {formatSigned(outPoints)}
              </p>
              <p className="mt-1 truncate text-[11px] text-zinc-500">
                {outPlayer.name}
              </p>
            </div>
            <div className="px-3 py-3 text-center">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#a7f600]/70">
                Te quedas
              </p>
              <p className="mt-1 text-xl font-bold leading-none tabular-nums text-white">
                {formatSigned(inPoints)}
              </p>
              <p className="mt-1 truncate text-[11px] text-zinc-500">
                {inPlayer.name}
              </p>
            </div>
          </div>
          <div className="flex items-center justify-between border-t border-white/[0.06] bg-black/30 px-4 py-3">
            <span className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-400">
              Tu marcador
            </span>
            <span className="flex items-baseline gap-1.5">
              <span
                className={`text-2xl font-bold leading-none tabular-nums ${
                  down ? "text-red-400" : up ? "text-[#a7f600]" : "text-white"
                }`}
              >
                {formatSigned(delta)}
              </span>
              <span className="text-xs font-semibold text-zinc-500">
                {down ? "baja" : up ? "sube" : "igual"}
              </span>
            </span>
          </div>
        </div>

        {demo ? (
          <div className="mx-5 mb-4 rounded-lg border border-amber-300/25 bg-amber-300/10 px-3 py-2.5 text-xs font-semibold text-amber-200">
            Modo demo: así se ve el cambio, pero confirmarlo estará disponible
            pronto.
          </div>
        ) : (
          <label className="mx-5 mb-4 flex cursor-pointer select-none items-center gap-2.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2.5 transition hover:bg-white/[0.06]">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
              className="h-4 w-4 shrink-0 accent-[#a7f600]"
            />
            <span className="text-xs font-semibold text-zinc-300">
              Entiendo que este cambio es definitivo y no se puede deshacer.
            </span>
          </label>
        )}

        <div className="grid gap-2 px-4 pb-4 sm:grid-cols-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-white/10 px-4 py-3 text-sm font-bold text-white transition hover:bg-white/10 disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || demo || !acknowledged}
            className="rounded-lg bg-[#a7f600] px-4 py-3 text-sm font-bold text-black shadow-lg shadow-[#a7f600]/10 transition hover:bg-[#c7ff43] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {demo
              ? "Disponible pronto"
              : busy
                ? "Guardando…"
                : "Confirmar cambio"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SwapModalCard({
  eliminated = false,
  highlighted = false,
  label,
  playerId,
  points,
  tone,
}: {
  eliminated?: boolean;
  highlighted?: boolean;
  label: string;
  playerId: string;
  points: number;
  tone: "out" | "in";
}) {
  const out = tone === "out";
  const badge = out
    ? "border-red-500/40 bg-red-500/15 text-red-300"
    : "border-[#a7f600]/40 bg-[#a7f600]/15 text-[#a7f600]";
  return (
    <div className="flex w-[42%] max-w-[150px] flex-col items-center">
      <span
        className={`mb-2 rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] ${badge}`}
      >
        {label}
      </span>
      {/* La carta que SALE va en escala de grises (saturate-0) para que se vea
          "apagada"; la que ENTRA, a todo color con anillo lima. */}
      <div
        className={`relative w-full ${out ? "opacity-90 saturate-[.2]" : ""}`}
      >
        <PlayerCard
          playerId={playerId}
          points={points}
          eliminated={eliminated}
          selected={highlighted}
        />
        <div
          className={`pointer-events-none absolute inset-0 rounded-lg ring-1 ring-inset ${
            out ? "ring-white/15" : "ring-[#a7f600]/50"
          }`}
        />
      </div>
    </div>
  );
}

// Foto del jugador con un badge de sus puntos. El que sale va atenuado (gris) y
// el que entra a todo color; el badge del que entra resalta en lima.
function SwapLogRow({ entry }: { entry: SwapLog }) {
  return (
    <CommunitySwapRow
      userName={entry.userName}
      userId={entry.userId}
      inPlayerId={entry.inPlayerId}
      outPlayerId={entry.outPlayerId}
      pointsIn={entry.pointsIn}
      pointsOut={entry.pointsOut}
    />
  );
}

// Tutorial de bienvenida de /cofres (primera visita). Tres pasos con mini-demos
// en bucle, en la línea de los intros animados de la porra. Recalca los dos
// puntos clave: el titular que sacas DESAPARECE y solo entran cartas con los
// mismos puntos o menos. Reutiliza el lenguaje visual de los swaps (lima, rojo,
// chips de puntos) para que se sienta parte de la misma pantalla.
const introSteps = [
  {
    title: "Abre sobres, consigue cartas",
    body: "Cada día recibes sobres. Ábrelos para sacar cartas de jugadores: cada carta vale los puntos que ese jugador suma de verdad (goles, MVP, paradas…).",
  },
  {
    title: "Mete una carta en tu once",
    body: "Elige una carta y cámbiala por un titular de tu once del mismo puesto.",
  },
  {
    title: "La regla de oro: los puntos",
    body: "No vale fichar a cualquiera para inflar tu marcador a posteriori.",
  },
  {
    title: "Recuerda: no hay vuelta atrás",
    body: "Si cambias a un jugador, desaparece de tu once para siempre. No podrás volver a ponerlo.",
  },
];

const forjaIntroSteps = [
  {
    title: "Forja nuevo talento",
    body: "Convierte las cartas que ya no necesitas en cracks de máxima rareza.",
  },
  {
    title: "4 cartas → 1 legendaria",
    body: "Elige 4 cartas cualesquiera de tu colección y fúndelas. A cambio recibes 1 carta legendaria garantizada.",
  },
  {
    title: "Mismo puesto, misma posición",
    body: "Si las 4 cartas son del mismo puesto, la legendaria saldrá de ese puesto. Si mezclas puestos, será de uno aleatorio.",
  },
];

// Escenario paso 1: Maldini estático, grande y anclado al fondo del rectángulo
// (object-bottom). La imagen es apaisada (160x120): al rellenar el alto del
// recuadro ocupa casi todo el ancho.
function ForjaStageMaldini() {
  return (
    <div className="relative h-full w-full">
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-2 left-1/2 h-28 w-48 -translate-x-1/2 rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(247,200,74,0.3), transparent 70%)",
        }}
      />
      <Image
        src="/maldini.webp"
        alt="Paolo Maldini"
        fill
        sizes="320px"
        className="z-10 object-contain object-bottom"
      />
    </div>
  );
}

// Escenario paso 2: 4 cartas → 1 legendaria dorada.
function ForjaStageFuse() {
  const ids = ["por-15", "arg-24", "tur-08", "tur-20"];
  return (
    <div className="flex h-full w-full items-center justify-center gap-2.5 px-3">
      <div className="grid grid-cols-2 gap-1">
        {ids.map((id) => (
          <div key={id} className="w-9">
            <PlayerCard playerId={id} points={0} />
          </div>
        ))}
      </div>
      <span aria-hidden className="text-2xl text-[#f7c84a]">
        →
      </span>
      <div
        className="flex aspect-[5/7] w-[58px] flex-col items-center justify-center rounded-lg border"
        style={{
          borderColor: "rgba(247,200,74,0.6)",
          background:
            "radial-gradient(70% 60% at 50% 38%, rgba(247,200,74,0.22), rgba(10,15,26,0.95))",
          boxShadow: "0 0 22px rgba(247,200,74,0.3)",
        }}
      >
        <span className="text-2xl text-[#f7c84a]">✦</span>
      </div>
    </div>
  );
}

// Escenario paso 3: 4 del mismo puesto → legendaria de ese puesto.
function ForjaStagePosition() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2.5 px-3">
      <div className="flex items-center gap-2">
        {[0, 1, 2, 3].map((index) => (
          <span
            key={index}
            className="rounded-md bg-white/[0.08] px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-sky-300"
          >
            DEF
          </span>
        ))}
      </div>
      <span aria-hidden className="text-xl text-[#f7c84a]">
        ↓
      </span>
      <span className="rounded-md border border-[#f7c84a]/50 bg-[#f7c84a]/15 px-3 py-1.5 text-sm font-bold uppercase tracking-wide text-[#f7c84a]">
        ★ Legendaria DEF
      </span>
    </div>
  );
}

function ForjaIntroModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const total = forjaIntroSteps.length;
  const isLast = step === total - 1;
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    primaryRef.current?.focus();
  }, [step]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const content = forjaIntroSteps[step];

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 px-4 py-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="forja-intro-title"
    >
      <div className="relative flex w-full max-w-md flex-col overflow-hidden rounded-2xl border border-[#f7c84a]/20 bg-[#121212] text-white shadow-2xl shadow-black/60 motion-safe:animate-[cofre-modal-pop_240ms_cubic-bezier(0.2,0.9,0.3,1)_both]">
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f7c84a]/15 text-base"
            >
              🔨
            </span>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#f7c84a]">
              Cómo funciona la forja
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-xs font-bold text-zinc-500 transition hover:text-white"
          >
            Saltar
          </button>
        </div>

        <div className="px-5 pt-5">
          <div className="relative mb-4 flex h-44 items-center justify-center overflow-hidden rounded-xl border border-white/[0.07] bg-gradient-to-b from-[#f7c84a]/[0.08] to-transparent">
            {step === 0 ? (
              <ForjaStageMaldini />
            ) : step === 1 ? (
              <ForjaStageFuse />
            ) : (
              <ForjaStagePosition />
            )}
          </div>

          <h3
            id="forja-intro-title"
            className="text-xl font-bold tracking-tight text-white"
          >
            {content.title}
          </h3>
          <p className="mt-1.5 text-sm leading-6 text-zinc-300">
            {content.body}
          </p>
        </div>

        {step === 1 ? (
          <div className="mx-5 mt-3 flex items-start gap-2.5 rounded-xl border border-[#f7c84a]/25 bg-[#f7c84a]/[0.08] px-3.5 py-3">
            <span aria-hidden className="text-lg leading-none">
              ✨
            </span>
            <p className="text-[13px] font-semibold leading-5 text-[#ffe6a3]">
              La legendaria está{" "}
              <span className="font-bold text-[#f7c84a]">garantizada</span>. Las
              4 cartas que metes se consumen.
            </p>
          </div>
        ) : null}
        {step === 2 ? (
          <div className="mx-5 mt-3 flex items-start gap-2.5 rounded-xl border border-[#f7c84a]/25 bg-[#f7c84a]/[0.08] px-3.5 py-3">
            <span aria-hidden className="text-lg leading-none">
              🎯
            </span>
            <p className="text-[13px] font-semibold leading-5 text-[#ffe6a3]">
              Junta 4 del{" "}
              <span className="font-bold text-[#f7c84a]">mismo puesto</span>{" "}
              para asegurar la posición de tu nueva estrella.
            </p>
          </div>
        ) : null}

        <div className="mt-4 flex items-center justify-between gap-3 px-5 pb-5">
          <div className="flex items-center gap-1.5" aria-hidden>
            {forjaIntroSteps.map((_, index) => (
              <span
                key={index}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  index === step ? "w-5 bg-[#f7c84a]" : "w-1.5 bg-white/20"
                }`}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {step > 0 ? (
              <button
                type="button"
                onClick={() => setStep((current) => Math.max(0, current - 1))}
                className="rounded-lg border border-white/10 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-white/10"
              >
                Atrás
              </button>
            ) : null}
            <button
              ref={primaryRef}
              type="button"
              onClick={() => (isLast ? onClose() : setStep((c) => c + 1))}
              className="rounded-lg bg-[#f7c84a] px-5 py-2.5 text-sm font-bold text-black shadow-lg shadow-[#f7c84a]/10 transition hover:bg-[#ffd966]"
            >
              {isLast ? "¡A forjar!" : "Siguiente"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CofresIntroModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const total = introSteps.length;
  const isLast = step === total - 1;
  const primaryRef = useRef<HTMLButtonElement>(null);

  // Foco al botón principal en cada paso (accesibilidad) y Escape para saltar.
  useEffect(() => {
    primaryRef.current?.focus();
  }, [step]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const content = introSteps[step];

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 px-4 py-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cofres-intro-title"
    >
      <div className="relative flex w-full max-w-md flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#121212] text-white shadow-2xl shadow-black/60 motion-safe:animate-[cofre-modal-pop_240ms_cubic-bezier(0.2,0.9,0.3,1)_both]">
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#a7f600]/15 text-base"
            >
              🃏
            </span>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#a7f600]">
              Cómo funcionan los sobres
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-xs font-bold text-zinc-500 transition hover:text-white"
          >
            Saltar
          </button>
        </div>

        <div className="px-5 pt-5">
          {/* Escenario animado: cambia por paso, alto fijo para que no salte. */}
          <div className="relative mb-4 flex h-44 items-center justify-center overflow-hidden rounded-xl border border-white/[0.07] bg-gradient-to-b from-white/[0.05] to-transparent">
            {step === 0 ? (
              <IntroStageOpen />
            ) : step === 1 ? (
              <IntroStageVanish />
            ) : step === 2 ? (
              <IntroStagePoints />
            ) : (
              <IntroStageGone />
            )}
          </div>

          <h3
            id="cofres-intro-title"
            className="text-xl font-bold tracking-tight text-white"
          >
            {content.title}
          </h3>
          <p className="mt-1.5 text-sm leading-6 text-zinc-300">
            {content.body}
          </p>
        </div>

        {/* Avisos clave: el que sale desaparece (rojo) y la regla de puntos. */}
        {step === 1 ? (
          <div className="mx-5 mt-3 flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-3">
            <span aria-hidden className="text-lg leading-none">
              ⚠️
            </span>
            <p className="text-[13px] font-semibold leading-5 text-red-100">
              El jugador que sacas{" "}
              <span className="font-bold text-red-300">
                desaparece para siempre
              </span>
              . El cambio es definitivo y no se puede deshacer.
            </p>
          </div>
        ) : null}
        {step === 2 ? (
          <div className="mx-5 mt-3 flex items-start gap-2.5 rounded-xl border border-[#a7f600]/25 bg-[#a7f600]/[0.08] px-3.5 py-3">
            <span aria-hidden className="text-lg leading-none">
              🎯
            </span>
            <p className="text-[13px] font-semibold leading-5 text-[#d7ffa8]">
              Tu carta debe valer los{" "}
              <span className="font-bold text-[#a7f600]">
                mismos puntos o menos
              </span>{" "}
              que el titular al que sustituye. Los empates valen.
            </p>
          </div>
        ) : null}
        {step === 3 ? (
          <div className="mx-5 mt-3 flex items-start gap-2.5 rounded-xl border border-red-500/40 bg-red-500/15 px-3.5 py-3">
            <span aria-hidden className="text-lg leading-none">
              🚫
            </span>
            <p className="text-[13px] font-semibold leading-5 text-red-100">
              Una vez hecho el cambio, ese jugador{" "}
              <span className="font-bold text-red-300">se va para siempre</span>
              : no se puede deshacer ni volver a ponerlo.
            </p>
          </div>
        ) : null}

        <div className="mt-4 flex items-center justify-between gap-3 px-5 pb-5">
          <div className="flex items-center gap-1.5" aria-hidden>
            {introSteps.map((_, index) => (
              <span
                key={index}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  index === step ? "w-5 bg-[#a7f600]" : "w-1.5 bg-white/20"
                }`}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {step > 0 ? (
              <button
                type="button"
                onClick={() => setStep((current) => Math.max(0, current - 1))}
                className="rounded-lg border border-white/10 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-white/10"
              >
                Atrás
              </button>
            ) : null}
            <button
              ref={primaryRef}
              type="button"
              onClick={() => (isLast ? onClose() : setStep((c) => c + 1))}
              className="rounded-lg bg-[#a7f600] px-5 py-2.5 text-sm font-bold text-black shadow-lg shadow-[#a7f600]/10 transition hover:bg-[#c7ff43]"
            >
              {isLast ? "¡Entendido!" : "Siguiente"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Paso 1: el sobre flota y una carta asoma de él, en bucle.
function IntroStageOpen() {
  return (
    <div className="relative flex h-full w-full items-end justify-center pb-3">
      <span
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-32 w-32 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(167,246,0,0.22), transparent 70%)",
        }}
      />
      {/* La carta REAL que asoma va DETRÁS del sobre (sin z) para que parezca
          salir de él. */}
      <div
        aria-hidden
        className="absolute bottom-6 left-1/2 w-[64px] -translate-x-1/2 motion-safe:animate-[cofres-intro-emerge_3.2s_ease-in-out_infinite]"
      >
        <PlayerCard playerId="esp-19" points={5} selected />
      </div>
      <span className="relative z-10 block h-28 w-[76px] motion-safe:animate-[cofre-hero-float_5s_ease-in-out_infinite]">
        <Image
          src="/sobre.webp"
          alt=""
          fill
          sizes="80px"
          className="object-contain"
        />
      </span>
    </div>
  );
}

// Paso 2: el titular (carta real) se desvanece con un puff y tu carta real entra
// en su hueco. Mismo lenguaje que el modal de confirmar (Sale rojo / Entra lima).
// El cambio del ejemplo respeta la regla: tu carta (3) ≤ titular (4).
function IntroStageVanish() {
  return (
    <div className="relative flex h-full w-full items-center justify-center gap-2.5 px-2">
      <div className="relative flex flex-col items-center">
        <span className="mb-1.5 rounded-full border border-red-500/40 bg-red-500/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-red-300">
          Sale
        </span>
        <div className="relative w-[82px]">
          <span
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1/2 z-10 h-14 w-14 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-red-400/60 motion-safe:animate-[cofres-intro-puff_3.2s_ease-in-out_infinite]"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute -right-2 -top-2 z-20 text-lg motion-safe:animate-[cofres-intro-puff_3.2s_ease-in-out_infinite]"
          >
            💨
          </span>
          <div className="motion-safe:animate-[cofres-intro-vanish_3.2s_ease-in-out_infinite]">
            <PlayerCard playerId="eng-10" points={4} />
          </div>
        </div>
      </div>

      <span aria-hidden className="shrink-0 text-lg text-white/70">
        ⇄
      </span>

      <div className="flex flex-col items-center">
        <span className="mb-1.5 rounded-full border border-[#a7f600]/40 bg-[#a7f600]/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-[#a7f600]">
          Entra
        </span>
        <div className="w-[82px] motion-safe:animate-[cofres-intro-enter_3.2s_ease-in-out_infinite]">
          <PlayerCard playerId="fra-10" points={3} selected />
        </div>
      </div>
    </div>
  );
}

// Paso 4: recordatorio final. El titular (carta real) se desvanece y deja un
// hueco vacío y bloqueado: no hay forma de devolverlo. Recalca que es para
// siempre y sin vuelta atrás.
function IntroStageGone() {
  return (
    <div className="relative flex h-full w-full items-center justify-center gap-4">
      <div className="relative w-[82px]">
        {/* Hueco vacío y bloqueado que queda al irse el titular (fondo). */}
        <div className="flex aspect-[5/7] flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-red-400/30 bg-red-500/[0.05]">
          <span aria-hidden className="text-2xl opacity-80">
            🔒
          </span>
          <span className="text-[8px] font-bold uppercase tracking-[0.12em] text-red-300/70">
            Hueco vacío
          </span>
        </div>
        <span
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 z-10 h-14 w-14 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-red-400/60 motion-safe:animate-[cofres-intro-puff_3.2s_ease-in-out_infinite]"
        />
        {/* La carta REAL se desvanece por encima y revela el hueco bloqueado. */}
        <div className="absolute inset-0 z-20 motion-safe:animate-[cofres-intro-vanish_3.2s_ease-in-out_infinite]">
          <PlayerCard playerId="eng-10" points={4} />
        </div>
      </div>

      {/* Símbolo "no vuelve": flecha de deshacer tachada. */}
      <div className="flex flex-col items-center gap-1.5">
        <span className="relative flex h-12 w-12 items-center justify-center rounded-full border-2 border-red-400/60 bg-red-500/10 text-red-300">
          <svg
            viewBox="0 0 24 24"
            className="h-6 w-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M9 14 4 9l5-5" />
            <path d="M4 9h10a6 6 0 0 1 0 12H8" />
          </svg>
          <span
            aria-hidden
            className="absolute left-1/2 top-1/2 h-0.5 w-12 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-full bg-red-400"
          />
        </span>
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-red-300">
          No vuelve
        </span>
      </div>
    </div>
  );
}

// Paso 3: dos comparaciones (✓ entra / ✗ no entra) según la regla de puntos.
function IntroStagePoints() {
  return (
    <div className="flex h-full w-full flex-col justify-center gap-3 px-4">
      <IntroCompareRow cardPts={3} titularPts={5} ok />
      <IntroCompareRow cardPts={6} titularPts={4} ok={false} delayed />
    </div>
  );
}

function IntroCompareRow({
  cardPts,
  titularPts,
  ok,
  delayed = false,
}: {
  cardPts: number;
  titularPts: number;
  ok: boolean;
  delayed?: boolean;
}) {
  return (
    <div className="flex items-center justify-center gap-2">
      <IntroPointChip label="Tu carta" pts={cardPts} tone="lime" />
      <span aria-hidden className="text-xs font-bold text-zinc-500">
        vs
      </span>
      <IntroPointChip label="Titular" pts={titularPts} tone="neutral" />
      <span
        aria-hidden
        className={`ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold motion-safe:animate-[cofres-intro-verdict_3s_ease-in-out_infinite] ${
          delayed ? "motion-safe:[animation-delay:1.1s]" : ""
        } ${ok ? "bg-[#a7f600] text-black" : "bg-red-500 text-white"}`}
      >
        {ok ? "✓" : "✗"}
      </span>
    </div>
  );
}

function IntroPointChip({
  label,
  pts,
  tone,
}: {
  label: string;
  pts: number;
  tone: "lime" | "neutral";
}) {
  const lime = tone === "lime";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 ${
        lime
          ? "border-[#a7f600]/40 bg-[#a7f600]/10"
          : "border-white/[0.12] bg-white/[0.05]"
      }`}
    >
      <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-zinc-400">
        {label}
      </span>
      <span
        className={`text-sm font-bold leading-none tabular-nums ${
          lime ? "text-[#a7f600]" : "text-white"
        }`}
      >
        {formatSigned(pts)}
      </span>
    </span>
  );
}
