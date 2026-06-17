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
import { PlayerCard } from "@/components/player-card";
import { useAppContext } from "@/lib/app-context";
import { data, playersById, teamsById } from "@/lib/data";
import { initials, playerPhotoUrl } from "@/lib/format";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { calculatePlayerStandings } from "@/lib/scoring";
import { STAR_PLAYER_IDS } from "@/lib/star-players";
import { TOP150_PLAYER_IDS } from "@/lib/top150-players";
import { formatCountdownHMS, secondsUntilNextDailyCard } from "@/lib/cofres";
import type { AdminEvent, AdminResults, Player, Position } from "@/lib/types";

const PackOpeningOverlay = dynamic(
  () =>
    import("@/components/pack-opening-overlay").then(
      (mod) => mod.PackOpeningOverlay,
    ),
  { ssr: false },
);

type PackKind = "daily" | "special";

type Pack = {
  id: string;
  kind: PackKind;
  title: string;
  subtitle: string;
  playerIds: string[];
  dateKey?: string;
  // Pool del servidor para los sobres temáticos (madrid/sub21/stars/francia).
  // Si está, en prod se abre con open_themed_card_pack(p_pool, p_day).
  pool?: "madrid" | "sub21" | "stars" | "francia";
  availableAt: string;
  // Imagen del sobre para el overlay 3D y el hero. Por defecto /sobre.webp.
  image?: string;
  // Color del cacho que vuela al cortar en el overlay 3D (por defecto verde).
  flap?: "green" | "white" | "black" | "navy" | "royal";
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

const dailyPackCount = 7;
const localSpecialPacksKey = "porra26_card_special_packs";
// Tutorial de bienvenida de /cofres: se muestra solo la primera visita (igual
// que los intros de la porra). El botón "?" de la cabecera lo reabre cuando
// quieras.
const cofresIntroStorageKey = "porra26_cofres_intro_seen";

// Sobre especial "Madrid": 1 sola carta de un jugador del Real Madrid. Como el
// dataset no tiene campo de club, la plantilla es una lista CURADA por id de los
// jugadores del Madrid presentes en el Mundial (+ Cucurella, recién fichado). Si
// cambia el roster del Madrid, este es el ÚNICO sitio a tocar.
const MADRID_PLAYER_IDS = [
  "bel-01", // Courtois
  "bra-07", // Vini Jr.
  "bra-19", // Endrick
  "eng-10", // Bellingham
  "fra-08", // Tchouaméni
  "fra-10", // Mbappé
  "ger-02", // Rüdiger
  "mar-10", // Brahim Díaz
  "uru-08", // Valverde
  "aut-08", // Alaba
  "esp-24", // Cucurella
];

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

// Sobre "Selección Francia": 1 carta de un internacional francés. Todos del
// combinado `fra` del dataset (verificado por apellido).
const FRANCE_PLAYER_IDS = [
  "fra-16", // Mike Maignan
  "fra-05", // Jules Koundé
  "fra-04", // Dayot Upamecano
  "fra-17", // William Saliba
  "fra-19", // Théo Hernández
  "fra-08", // Aurélien Tchouaméni
  "fra-14", // Adrien Rabiot
  "fra-11", // Michael Olise
  "fra-20", // Désiré Doué
  "fra-07", // Ousmane Dembélé
  "fra-10", // Kylian Mbappé
  "fra-12", // Bradley Barcola
  "fra-09", // Marcus Thuram
  "fra-24", // Rayan Cherki
  "fra-13", // N'Golo Kanté
  "fra-06", // Manu Koné
  "fra-18", // Warren Zaïre-Emery
  "fra-21", // Lucas Hernández
  "fra-02", // Malo Gusto
];

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
) {
  const random = mulberry32(hashString(seed));
  const allow = allowedIds ? new Set(allowedIds) : null;
  const pool = [...data.players].filter(
    (player) => player.id && (!allow || allow.has(player.id)),
  );

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
function pickDailyPlayers(seed: string): string[] {
  const star = pickDeterministicPlayers(`${seed}:star`, 1, STAR_PLAYER_IDS);
  const top = pickDeterministicPlayers(
    `${seed}:top`,
    1,
    TOP150_PLAYER_IDS.filter((id) => !star.includes(id)),
  );
  const taken = new Set([...star, ...top]);
  const random = pickDeterministicPlayers(
    `${seed}:any`,
    1,
    data.players.map((player) => player.id).filter((id) => !taken.has(id)),
  );
  return [...random, ...top, ...star];
}

function madridTodayKey() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Madrid",
    year: "numeric",
  }).formatToParts(new Date());
  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function shiftDateKey(key: string, offset: number) {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
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
}): Pack {
  return {
    id: row.id,
    kind: row.kind,
    title: row.label,
    subtitle: row.kind === "special" ? "Drop especial" : "Sobre diario",
    playerIds: row.player_ids || [],
    availableAt: row.available_at || row.created_at || new Date().toISOString(),
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
  return {
    id: String(row.card_id || row.id || crypto.randomUUID()),
    playerId: row.player_id,
    packId: row.drop_id,
    packTitle: drop?.label || row.drop_id,
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
  const [pageTab, setPageTab] = useState<"sobres" | "swaps">("sobres");
  const [swapQuery, setSwapQuery] = useState("");
  const [swapsMineOnly, setSwapsMineOnly] = useState(false);
  const [newCardIds, setNewCardIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [positionFilter, setPositionFilter] = useState<Position | "all">("all");
  const [hydrated, setHydrated] = useState(false);
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
  const [message, setMessage] = useState("");
  const heroButtonRef = useRef<HTMLButtonElement>(null);
  const swapPanelRef = useRef<HTMLDivElement>(null);
  const collectionRef = useRef<HTMLElement>(null);
  const wasOpening = useRef(false);
  const justAcceptedRef = useRef(false);
  // Cartas ya pedidas al servidor en openPack (prod), a la espera de que el
  // usuario corte el sobre. Se consumen en acceptPackOpening.
  const pendingCardsRef = useRef<{ packId: string; cards: InventoryCard[] } | null>(
    null,
  );
  const [demoXi, setDemoXi] = useState(seedXi);
  const [pendingSwap, setPendingSwap] = useState<SwapCandidate | null>(null);
  const [lastSwap, setLastSwap] = useState<{
    inPlayerId: string;
    outPlayerId: string;
  } | null>(null);
  const [swapBusy, setSwapBusy] = useState(false);
  // Tutorial de bienvenida (primera visita). `introQueuedRef` evita que el
  // efecto lo vuelva a encolar tras cerrarlo en la misma sesión.
  const [showIntro, setShowIntro] = useState(false);
  const introQueuedRef = useRef(false);

  const userStorageId = user?.id || "guest";
  const inventoryKey = storageKey(userStorageId, "inventory");
  const openedKey = storageKey(userStorageId, "opened");
  const logKey = storageKey(userStorageId, "log");

  const dailyPacks = useMemo<Pack[]>(() => {
    const today = madridTodayKey();
    // En demo solo 1 sobre diario (para probar); en real, los 7 históricos.
    return Array.from(
      { length: CARDS_DEMO ? 1 : dailyPackCount },
      (_, index) => {
        const dateKey = shiftDateKey(today, -index);
        return {
          id: `daily-${dateKey}`,
          kind: "daily" as const,
          title:
            index === 0 ? "Sobre diario" : `Sobre ${formatPackDate(dateKey)}`,
          subtitle: "3 cartas · 1 legendaria asegurada",
          playerIds: pickDailyPlayers(`daily:${dateKey}:${drawSeed}`),
          dateKey,
          availableAt: `${dateKey}T00:00:00.000Z`,
        };
      },
    );
  }, [drawSeed]);

  // Sobre Madrid: especial SIEMPRE disponible, con su propia imagen y 1 sola
  // carta del roster del Madrid (semilla por día, determinista).
  const madridPack = useMemo<Pack>(() => {
    const today = madridTodayKey();
    return {
      id: `madrid-${today}`,
      kind: "special",
      pool: "madrid",
      dateKey: today,
      title: "Sobre Madrid",
      subtitle: "1 carta del Real Madrid",
      playerIds: pickDeterministicPlayers(
        `madrid:${today}:${drawSeed}`,
        1,
        MADRID_PLAYER_IDS,
      ),
      availableAt: `${today}T00:00:00.000Z`,
      image: "/sobre-madrid.webp",
      flap: "white",
    };
  }, [drawSeed]);

  // Sobre Promesas sub-21: especial SIEMPRE disponible, 1 carta de un joven
  // crack de la lista curada (semilla por día, determinista).
  const sub21Pack = useMemo<Pack>(() => {
    const today = madridTodayKey();
    return {
      id: `sub21-${today}`,
      kind: "special",
      pool: "sub21",
      dateKey: today,
      title: "Sobre Promesas",
      subtitle: "1 promesa sub-21",
      playerIds: pickDeterministicPlayers(
        `sub21:${today}:${drawSeed}`,
        1,
        SUB21_PLAYER_IDS,
      ),
      availableAt: `${today}T00:00:00.000Z`,
      image: "/sobre21.webp",
      flap: "black",
    };
  }, [drawSeed]);

  // Sobre Estrellas: especial SIEMPRE disponible, 1 carta de un crack mundial de
  // la lista curada (semilla por día, determinista). Estos jugadores salen como
  // legendaria (ver star-players.ts).
  const starsPack = useMemo<Pack>(() => {
    const today = madridTodayKey();
    return {
      id: `stars-${today}`,
      kind: "special",
      pool: "stars",
      dateKey: today,
      title: "Sobre Estrellas",
      subtitle: "1 estrella mundial",
      playerIds: pickDeterministicPlayers(
        `stars:${today}:${drawSeed}`,
        1,
        STAR_PLAYER_IDS,
      ),
      availableAt: `${today}T00:00:00.000Z`,
      image: "/sobre-estrellas.webp",
      flap: "navy",
    };
  }, [drawSeed]);

  // Sobre Selección Francia: especial SIEMPRE disponible, 1 carta de un
  // internacional francés de la lista curada (semilla por día, determinista).
  const francePack = useMemo<Pack>(() => {
    const today = madridTodayKey();
    return {
      id: `francia-${today}`,
      kind: "special",
      pool: "francia",
      dateKey: today,
      title: "Sobre Francia",
      subtitle: "1 internacional francés",
      playerIds: pickDeterministicPlayers(
        `francia:${today}:${drawSeed}`,
        1,
        FRANCE_PLAYER_IDS,
      ),
      availableAt: `${today}T00:00:00.000Z`,
      image: "/sobre-francia.webp",
      flap: "royal",
    };
  }, [drawSeed]);

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
    (playerId: string) => playerPoints.get(playerId) || 0,
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
  const openedIds = useMemo(
    () => new Set([...openedPackIds, ...inventory.map((card) => card.packId)]),
    [inventory, openedPackIds],
  );
  const packs = useMemo(
    () => [
      madridPack,
      sub21Pack,
      starsPack,
      francePack,
      ...dailyPacks,
      ...specialPacks,
    ],
    [dailyPacks, francePack, madridPack, starsPack, sub21Pack, specialPacks],
  );
  const unopenedPacks = useMemo(
    () => packs.filter((pack) => !openedIds.has(pack.id)),
    [openedIds, packs],
  );
  // El sobre "de la cima": los especiales tienen prioridad (más hype); si no,
  // el primero disponible (hoy primero, por el orden de `packs`).
  const topPack =
    unopenedPacks.find((pack) => pack.kind === "special") ||
    unopenedPacks[0] ||
    null;
  const unopenedCount = unopenedPacks.length;

  // Agrupa los sobres sin abrir por tipo para la estantería del hero. Los
  // especiales van primero (más hype), igual que el orden de `topPack`.
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
    return order.sort((a, b) =>
      // En demo el diario va PRIMERO (para probar rápido); en real, los
      // especiales primero (más hype).
      CARDS_DEMO
        ? Number(b.kind === "daily") - Number(a.kind === "daily")
        : Number(b.kind === "special") - Number(a.kind === "special"),
    );
  }, [unopenedPacks]);

  // Tipo de sobre seleccionado en la estantería (null = el primero, que por el
  // orden de `packGroups` es el especial de más hype). El sobre destacado es el
  // primero sin abrir de ese tipo; ese es el que abre el botón.
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
    if (!supabase) return;

    const [
      { data: drops, error: dropsError },
      { data: cards, error: cardsError },
      { data: swaps },
    ] = await Promise.all([
      supabase
        .from("card_drops")
        .select("id, kind, label, player_ids, available_at, created_at")
        .eq("kind", "special")
        .lte("available_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(16),
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
        .limit(20),
    ]);

    if (dropsError || cardsError) {
      setMessage(
        "La base todavia no tiene las tablas de cartas. Puedes probar la pantalla en modo local.",
      );
      return;
    }

    setSpecialPacks(
      (
        (drops || []) as Array<{
          id: string;
          kind: PackKind;
          label: string;
          player_ids: string[];
          available_at?: string;
          created_at?: string;
        }>
      )
        // Solo los drops de ADMIN (id `special-<uuid>`). Los temáticos por día
        // (`madrid-<fecha>`, etc.) también son kind='special' en la BBDD, pero ya
        // los representan los memos fijos (madridPack…); incluirlos duplicaría.
        .filter((drop) => drop.id.startsWith("special-"))
        .map(packFromDrop),
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
      if (CARDS_DEMO || (usingSupabase && user)) {
        setHydrated(true);
        return;
      }
      setInventory(readJson<InventoryCard[]>(inventoryKey, []));
      setOpenedPackIds(readJson<string[]>(openedKey, []));
      setSwapLog(readJson<SwapLog[]>(logKey, []));
      setSpecialPacks(readJson<Pack[]>(localSpecialPacksKey, []));
      setSelectedCardId("");
      setOpening(false);
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [inventoryKey, logKey, openedKey, usingSupabase, user]);

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
          ? { p_pool: pack.pool, p_day: pack.dateKey || madridTodayKey() }
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
      const alreadyOpenedCards = inventory.filter(
        (card) => card.packId === pack.id,
      );
      if (alreadyOpenedCards.length) {
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
    },
    [inventory, openPackInStorage],
  );

  const openPack = useCallback(
    async (pack: Pack) => {
      if (opening || preparing) return;

      const alreadyOpenedCards = inventory.filter(
        (card) => card.packId === pack.id,
      );
      if (alreadyOpenedCards.length) {
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
      setDrawSeed(String(Math.random()));
      setActivePack(pack);
      setOpening(true);
    },
    [inventory, opening, preparing, openPackInStorage, usingSupabase, user],
  );

  const candidateFor = useCallback(
    (outPlayer: Player): SwapCandidate => {
      const inPoints = selectedPlayer ? pointsFor(selectedPlayer.id) : 0;
      const outPoints = pointsFor(outPlayer.id);
      const samePosition = selectedPlayer?.position === outPlayer.position;
      const alreadyInXi = selectedPlayer
        ? activeXi.includes(selectedPlayer.id)
        : false;
      // La carta debe valer MENOS puntos que el titular al que sustituye (no
      // sirve para subir el marcador a posteriori). El empate solo vale si la
      // carta está a 0. MISMA regla que el SQL apply_card_swap y app-context.
      const cardEligible =
        inPoints < outPoints || (inPoints === 0 && outPoints >= 0);
      const eligible = Boolean(
        selectedPlayer && samePosition && !alreadyInXi && cardEligible,
      );

      let reason = "Disponible";
      if (!selectedPlayer) reason = "Elige una carta";
      else if (!samePosition)
        reason = `Solo ${positionLabel[selectedPlayer.position]}`;
      else if (alreadyInXi) reason = "Ya esta en tu once";
      else if (!cardEligible)
        reason = `Tiene menos puntos que tu carta (${formatSigned(outPoints)})`;

      return {
        outPlayer,
        inPoints,
        outPoints,
        delta: inPoints - outPoints,
        eligible,
        reason,
      };
    },
    [activeXi, pointsFor, selectedPlayer],
  );

  const requestSwap = (candidate: SwapCandidate) => {
    if (!candidate.eligible) return;
    setPendingSwap(candidate);
  };

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
  // ya se haya visto (localStorage es la fuente de verdad). setState síncrono e
  // idempotente: nada que cancelar (robusto bajo StrictMode y el render inicial).
  useEffect(() => {
    if (!hydrated || introQueuedRef.current) return;
    try {
      if (window.localStorage.getItem(cofresIntroStorageKey) === "1") return;
    } catch {
      // Si falla el storage, mostramos el tutorial igualmente esta sesión.
    }
    introQueuedRef.current = true;
    setShowIntro(true);
  }, [hydrated]);

  const dismissIntro = () => {
    try {
      window.localStorage.setItem(cofresIntroStorageKey, "1");
    } catch {
      // Ignoramos fallos de storage.
    }
    setShowIntro(false);
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
            hydrated={hydrated}
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
                              ? ` · ${usedCards.length} en tu once`
                              : ""
                          }`
                        : usedCards.length
                          ? `${usedCards.length} en tu once`
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
                              selected={selectedCardId === card.id}
                            />
                            {newCardIds.includes(card.id) ? (
                              <span className="absolute left-1/2 top-1.5 z-10 -translate-x-1/2 rounded-full bg-[#a7f600] px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.1em] text-black shadow-md shadow-black/40">
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
                          />
                          <span className="absolute left-2 top-2 rounded-md border border-[#a7f600]/30 bg-[#a7f600]/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[#a7f600]">
                            En el once
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
          busy={swapBusy}
          demo={CARDS_DEMO}
          onCancel={() => setPendingSwap(null)}
          onConfirm={() => void confirmSwap()}
        />
      ) : null}

      {/* Modal de admin: elegir qué tipo de sobre soltar como drop. */}
      {showIntro ? <CofresIntroModal onClose={dismissIntro} /> : null}

      {opening && activePack ? (
        <PackOpeningOverlay
          initialPackId={activePack.id}
          onAccept={(pack) =>
            acceptPackOpening(
              packs.find((item) => item.id === pack.id) || activePack,
            )
          }
          onClose={() => setOpening(false)}
          packs={overlayPacks}
          pointsFor={pointsFor}
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
};
function packGlowRgb(pack: Pack | null): string {
  return PACK_GLOW[pack?.flap ?? "green"] ?? PACK_GLOW.green;
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
          <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#a7f600] text-[10px] font-black text-black shadow">
            ✓
          </span>
        ) : eligible ? (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#a7f600] text-[9px] font-black text-black shadow">
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
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  candidate: SwapCandidate;
  demo: boolean;
  inPlayer: Player;
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
            label="Sale"
            tone="out"
            playerId={outPlayer.id}
            points={outPoints}
          />
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-xl text-white shadow-lg">
            ⇄
          </span>
          <SwapModalCard
            label="Entra"
            tone="in"
            playerId={inPlayer.id}
            points={inPoints}
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
  highlighted = false,
  label,
  playerId,
  points,
  tone,
}: {
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
        className={`ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-black motion-safe:animate-[cofres-intro-verdict_3s_ease-in-out_infinite] ${
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
