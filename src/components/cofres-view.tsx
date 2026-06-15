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

import { Card, Notice, SectionHeading, TeamFlag } from "@/components/common";
import { PlayerCard } from "@/components/player-card";
import { useAppContext } from "@/lib/app-context";
import { data, playersById, teamsById } from "@/lib/data";
import { initials, playerPhotoUrl } from "@/lib/format";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { calculatePlayerStandings } from "@/lib/scoring";
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
  availableAt: string;
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

function pickDeterministicPlayers(seed: string, count = 3) {
  const random = mulberry32(hashString(seed));
  const pool = [...data.players].filter((player) => player.id);

  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
  }

  return pool.slice(0, count).map((player) => player.id);
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

// Segundos hasta el próximo reparto de carta diaria: las 10:00 (hora de Madrid).
function secondsUntilNextDailyCard() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const value = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value || 0);
  let hour = value("hour");
  if (hour === 24) hour = 0; // algunos locales devuelven "24" a medianoche
  const secondsOfDay = hour * 3600 + value("minute") * 60 + value("second");
  const target = 10 * 3600;
  return secondsOfDay < target
    ? target - secondsOfDay
    : target - secondsOfDay + 86400;
}

function formatCountdownHMS(totalSeconds: number) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
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
const CARDS_DEMO: boolean = true;

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
  const [newCardIds, setNewCardIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [positionFilter, setPositionFilter] = useState<Position | "all">("all");
  const [hydrated, setHydrated] = useState(false);
  const [activePack, setActivePack] = useState<Pack | null>(null);
  const [opening, setOpening] = useState(false);
  const [message, setMessage] = useState("");
  const heroButtonRef = useRef<HTMLButtonElement>(null);
  const swapPanelRef = useRef<HTMLDivElement>(null);
  const collectionRef = useRef<HTMLElement>(null);
  const wasOpening = useRef(false);
  const justAcceptedRef = useRef(false);
  const [demoXi, setDemoXi] = useState(seedXi);
  const [pendingSwap, setPendingSwap] = useState<SwapCandidate | null>(null);
  const [lastSwap, setLastSwap] = useState<{
    inPlayerId: string;
    outPlayerId: string;
  } | null>(null);
  const [swapBusy, setSwapBusy] = useState(false);
  const [dropBusy, setDropBusy] = useState(false);

  const userStorageId = user?.id || "guest";
  const inventoryKey = storageKey(userStorageId, "inventory");
  const openedKey = storageKey(userStorageId, "opened");
  const logKey = storageKey(userStorageId, "log");

  const dailyPacks = useMemo(() => {
    const today = madridTodayKey();
    return Array.from({ length: dailyPackCount }, (_, index) => {
      const dateKey = shiftDateKey(today, -index);
      return {
        id: `daily-${dateKey}`,
        kind: "daily" as const,
        title:
          index === 0 ? "Sobre diario" : `Sobre ${formatPackDate(dateKey)}`,
        subtitle: "3 cartas iguales para todos",
        playerIds: pickDeterministicPlayers(`daily:${dateKey}`),
        dateKey,
        availableAt: `${dateKey}T00:00:00.000Z`,
      };
    });
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
    () => [...dailyPacks, ...specialPacks],
    [dailyPacks, specialPacks],
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
  const overlayPacks = useMemo(() => {
    if (!activePack) return unopenedPacks.length ? unopenedPacks : packs;
    const pool = unopenedPacks.length ? unopenedPacks : packs;
    return pool.some((pack) => pack.id === activePack.id)
      ? pool
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
          "id, in_player_id, out_player_id, points_in, points_out, delta, created_at, profiles(display_name)",
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
    setSwapLog(
      (
        (swaps || []) as Array<{
          id: string;
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
        const rpcName =
          pack.kind === "daily" ? "open_daily_card_pack" : "open_card_drop";
        const params =
          pack.kind === "daily"
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

      const cards = await openPackInStorage(pack);
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
    (pack: Pack) => {
      if (opening) return;

      const alreadyOpenedCards = inventory.filter(
        (card) => card.packId === pack.id,
      );
      if (alreadyOpenedCards.length) {
        setMessage("Sobre ya abierto. Sus cartas ya están en tu colección.");
        return;
      }

      setActivePack(pack);
      setMessage("");
      setOpening(true);
    },
    [inventory, opening],
  );

  const releaseSpecialDrop = useCallback(async () => {
    if (dropBusy) return;
    setDropBusy(true);
    setMessage("");

    try {
      if (usingSupabase && user) {
        const supabase = getSupabaseBrowserClient() as SupabaseLike | null;
        if (!supabase)
          throw new Error("No se ha podido conectar con Supabase.");
        const { data: rows, error } = await supabase.rpc(
          "admin_create_card_drop",
          { p_label: "Drop especial" },
        );
        if (error) throw new Error(error.message);
        const created = (
          rows as Array<{
            id: string;
            kind: PackKind;
            label: string;
            player_ids: string[];
            available_at?: string;
            created_at?: string;
          }> | null
        )?.[0];
        if (created) {
          setSpecialPacks((current) => [packFromDrop(created), ...current]);
        }
        setMessage("Drop especial soltado.");
        return;
      }

      const id = `special-${new Date().toISOString()}`;
      const pack: Pack = {
        id,
        kind: "special",
        title: "Drop especial",
        subtitle: "3 cartas para todos",
        playerIds: pickDeterministicPlayers(id),
        availableAt: new Date().toISOString(),
      };
      setSpecialPacks((current) => [pack, ...current]);
      setMessage("Drop especial creado en esta demo.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "No se ha podido soltar el drop.",
      );
    } finally {
      setDropBusy(false);
    }
  }, [dropBusy, usingSupabase, user]);

  const candidateFor = useCallback(
    (outPlayer: Player): SwapCandidate => {
      const inPoints = selectedPlayer ? pointsFor(selectedPlayer.id) : 0;
      const outPoints = pointsFor(outPlayer.id);
      const samePosition = selectedPlayer?.position === outPlayer.position;
      const alreadyInXi = selectedPlayer
        ? activeXi.includes(selectedPlayer.id)
        : false;
      // Solo puedes meter una carta con los MISMOS puntos o MENOS que el
      // titular al que sustituye (no sirve para subir tu marcador a posteriori;
      // los empates sí valen).
      const cardEqualOrLower = inPoints <= outPoints;
      const eligible = Boolean(
        !CARDS_DEMO &&
          selectedPlayer &&
          samePosition &&
          !alreadyInXi &&
          cardEqualOrLower,
      );

      let reason = "Disponible";
      if (CARDS_DEMO) reason = "Cambios deshabilitados por ahora";
      else if (!selectedPlayer) reason = "Elige una carta";
      else if (!samePosition)
        reason = `Solo ${positionLabel[selectedPlayer.position]}`;
      else if (alreadyInXi) reason = "Ya esta en tu once";
      else if (!cardEqualOrLower)
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

  return (
    <div className="space-y-8">
      <SectionHeading
        eyebrow="Sobres"
        title="Cartas de la Triliporra"
        description="Abre tus sobres y mete a un crack en tu once pagando el coste de puntos al momento."
        actions={
          <div className="flex items-center gap-2">
            <NextCardCountdown />
            {user?.isAdmin ? (
              <button
                type="button"
                onClick={() => void releaseSpecialDrop()}
                disabled={dropBusy}
                className="inline-flex items-center justify-center rounded-lg border border-[#ffd252]/30 bg-[#ffd252] px-4 py-2 text-sm font-bold text-black transition hover:bg-[#ffdd7a] disabled:opacity-60"
              >
                {dropBusy ? "Soltando..." : "Soltar drop"}
              </button>
            ) : null}
          </div>
        }
      />

      {/* Región viva persistente: anuncia a lectores de pantalla los mensajes
          de éxito/error sin afectar al layout (el Notice visible va aparte). */}
      <div className="sr-only" role="status" aria-live="polite">
        {message}
      </div>
      {message ? <Notice tone="neutral">{message}</Notice> : null}

      <PackHero
        topPack={topPack}
        count={unopenedCount}
        opening={opening}
        hydrated={hydrated}
        buttonRef={heroButtonRef}
        onOpen={() => topPack && openPack(topPack)}
      />

      <section ref={collectionRef} className="scroll-mt-4 space-y-4">
        <div className="flex items-center gap-3">
          <span className="h-px flex-1 bg-white/[0.08]" />
          <span className="text-xs font-bold uppercase tracking-[0.24em] text-[#a7f600]">
            Tu colección
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

            {hydrated && (unusedCards.length > 0 || usedCards.length > 0) ? (
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

            {hydrated && (unusedCards.length > 0 || usedCards.length > 0) ? (
              <div className="flex flex-wrap gap-1.5">
                {(["all", "POR", "DEF", "MED", "DEL"] as const).map((pos) => (
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
                ))}
              </div>
            ) : null}

            <div className="xl:-mx-1 xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:px-1 xl:pt-1">
              {!hydrated ? (
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5">
                  {Array.from({ length: 10 }).map((_, index) => (
                    <div
                      key={index}
                      className="aspect-[5/7] animate-pulse rounded-xl bg-white/[0.04]"
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
                        className={`cofre-card-reveal relative rounded-xl text-left outline-none transition focus-visible:ring-2 focus-visible:ring-[#a7f600]/60 ${
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
                      className="relative rounded-xl opacity-60"
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

          <div
            ref={swapPanelRef}
            className={`scroll-mt-4 xl:h-full xl:overflow-y-auto ${
              selectedCard || lastSwap ? "" : "hidden xl:block"
            }`}
          >
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

      <details className="group overflow-hidden rounded-lg border border-white/10 bg-[#151515] shadow-lg shadow-black/20">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 sm:px-5 [&::-webkit-details-marker]:hidden">
          <div>
            <h2 className="text-base font-bold tracking-tight text-white">
              Swaps públicos
            </h2>
            <p className="text-xs text-zinc-500">
              {swapLog.length
                ? `${swapLog.length} fichaje${swapLog.length === 1 ? "" : "s"} en la comunidad`
                : "Todos los fichajes de la comunidad quedan aquí"}
            </p>
          </div>
          <span className="shrink-0 text-xs font-bold text-zinc-500 transition-transform group-open:rotate-180">
            ▾
          </span>
        </summary>
        <div className="border-t border-white/[0.06] px-4 pb-2 sm:px-5">
          {swapLog.length ? (
            <div className="divide-y divide-white/[0.06]">
              {swapLog.slice(0, 12).map((entry) => (
                <SwapLogRow key={entry.id} entry={entry} />
              ))}
            </div>
          ) : (
            <p className="py-5 text-sm text-zinc-500">Todavía no hay swaps.</p>
          )}
        </div>
      </details>

      {pendingSwap && selectedPlayer ? (
        <ConfirmSwapModal
          candidate={pendingSwap}
          inPlayer={selectedPlayer}
          busy={swapBusy}
          onCancel={() => setPendingSwap(null)}
          onConfirm={() => void confirmSwap()}
        />
      ) : null}

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

function PackHero({
  buttonRef,
  count,
  hydrated,
  onOpen,
  opening,
  topPack,
}: {
  buttonRef: RefObject<HTMLButtonElement | null>;
  count: number;
  hydrated: boolean;
  onOpen: () => void;
  opening: boolean;
  topPack: Pack | null;
}) {
  const special = topPack?.kind === "special";
  const empty = count === 0;
  const ghostCount = Math.min(Math.max(count - 1, 0), 3);

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
        className={`pointer-events-none absolute inset-0 ${
          empty
            ? ""
            : special
              ? "bg-[radial-gradient(58%_46%_at_50%_42%,rgba(255,210,82,0.16),transparent_70%)]"
              : "bg-[radial-gradient(58%_46%_at_50%_42%,rgba(167,246,0,0.16),transparent_70%)]"
        }`}
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
        {empty ? "Sin sobres" : special ? "Drop especial" : "Sobre diario"}
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
        {Array.from({ length: ghostCount }).map((_, index) => (
          <span
            key={index}
            aria-hidden
            className="absolute inset-0 rounded-[14px] border border-white/10 bg-[#151515]"
            style={{
              transform: `translate(${(index + 1) * 6}px, ${
                (index + 1) * 8
              }px) scale(${1 - (index + 1) * 0.04})`,
              filter: `brightness(${1 - (index + 1) * 0.14})`,
              zIndex: -(index + 1),
            }}
          />
        ))}
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
            } ${
              special
                ? "drop-shadow-[0_18px_45px_rgba(255,210,82,0.4)]"
                : "drop-shadow-[0_18px_45px_rgba(167,246,0,0.3)]"
            }`}
          >
            <Image
              src="/sobre.png"
              alt="Sobre de cartas de la Triliporra 2026"
              fill
              priority
              sizes="(max-width: 640px) 56vw, 300px"
              className="select-none object-contain"
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
  if (!selectedCard || !selectedPlayer) {
    if (lastSwap) {
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
    return (
      <Card className="flex min-h-[260px] flex-col items-center justify-center gap-5 text-center xl:h-full">
        {/* Slot de carta vacío (borde dashed) para invitar a elegir una carta. */}
        <div className="flex aspect-[5/7] w-28 items-center justify-center rounded-xl border-2 border-dashed border-[#a7f600]/30 bg-[#a7f600]/[0.03]">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-10 w-10 text-[#a7f600]/60"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </div>
        <div>
          <p className="font-bold text-white">Selecciona una carta</p>
          <p className="mx-auto mt-1 max-w-[240px] text-sm text-zinc-500">
            Elige una carta de tu colección para cambiarla por un jugador de tu
            once.
          </p>
        </div>
      </Card>
    );
  }

  const samePosTitulares = activeXi
    .map((playerId) => playersById.get(playerId))
    .filter(
      (player): player is Player =>
        player != null && player.position === selectedPlayer.position,
    );
  const eligibleCount = samePosTitulares.filter(
    (player) => candidateFor(player).eligible,
  ).length;
  const selectedPhoto = playerPhotoUrl(selectedPlayer);
  const selectedPts = pointsFor(selectedPlayer.id);
  const selectedBreakdown = breakdownFor(selectedPlayer.id);

  return (
    <Card className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white">
            Mete tu carta
          </h2>
          <p className="text-sm text-zinc-500">
            Cambia un jugador de tu once por tu carta.
          </p>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="shrink-0 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-white/10"
        >
          Cerrar
        </button>
      </div>

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
              {hasAnyEvent(selectedBreakdown) ? (
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

      {CARDS_DEMO ? (
        <Notice tone="warm">
          Los cambios de jugador estarán disponibles pronto. De momento puedes
          abrir sobres y ver tus cartas.
        </Notice>
      ) : samePosTitulares.length === 0 ? (
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
        selectedPosition={selectedPlayer.position}
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
    <Card className="space-y-4 xl:flex xl:h-full xl:flex-col">
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
  return (
    <div className={`${base} ${dimmed ? "opacity-45" : ""}`}>{inner}</div>
  );
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
      <div className="theme-dark relative aspect-[5/6] w-full overflow-hidden rounded-xl border border-emerald-200/20 bg-emerald-600 shadow-lg shadow-emerald-950/20">
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
          <span>{breakdown[pill.key]}</span>
          <span className="sr-only">{pill.label}</span>
        </span>
      ))}
    </>
  );
}

function MiniPlayerPhoto({ player }: { player: Player }) {
  const photo = playerPhotoUrl(player);
  return (
    <span className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md border border-white/10 bg-zinc-900 text-xs font-bold text-[#a7f600]">
      {photo ? (
        <Image
          src={photo}
          alt=""
          fill
          sizes="44px"
          className="object-cover"
          unoptimized
        />
      ) : (
        initials(player.name)
      )}
    </span>
  );
}

function ConfirmSwapModal({
  busy,
  candidate,
  inPlayer,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  candidate: SwapCandidate;
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
            disabled={busy || !acknowledged}
            className="rounded-lg bg-[#a7f600] px-4 py-3 text-sm font-bold text-black shadow-lg shadow-[#a7f600]/10 transition hover:bg-[#c7ff43] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Guardando…" : "Confirmar cambio"}
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
          className={`pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ${
            out ? "ring-white/15" : "ring-[#a7f600]/50"
          }`}
        />
      </div>
    </div>
  );
}

function SwapLogRow({ entry }: { entry: SwapLog }) {
  const inPlayer = playersById.get(entry.inPlayerId);
  const outPlayer = playersById.get(entry.outPlayerId);

  return (
    <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        {inPlayer ? <MiniPlayerPhoto player={inPlayer} /> : null}
        <span className="min-w-0">
          <span className="block text-sm font-bold text-white">
            {entry.userName} ficho a {inPlayer?.name || "Jugador"}
          </span>
          <span className="block truncate text-xs text-zinc-500">
            Sale {outPlayer?.name || "Jugador"} -{" "}
            {formatSigned(entry.pointsOut)} a {formatSigned(entry.pointsIn)}
          </span>
        </span>
      </div>
      <span
        className={`w-fit rounded-md border px-2 py-1 text-xs font-bold ${
          entry.delta < 0
            ? "border-rose-400/25 bg-rose-400/10 text-rose-200"
            : "border-[#a7f600]/25 bg-[#a7f600]/10 text-[#a7f600]"
        }`}
      >
        {formatSigned(entry.delta)} pts
      </span>
    </div>
  );
}
