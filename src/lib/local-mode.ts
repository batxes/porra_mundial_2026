import { data } from "@/lib/data";
import { emptyPrediction } from "@/lib/prediction";
import type {
  AdminEvent,
  AdminResults,
  Position,
  Prediction,
} from "@/lib/types";

export const defaultAdminEmail = "admin@admin.admin";
export const defaultAdminPasswordHash = "3812b8873bd75366c1fc7c4141c6f9ca5778067968883eaf9c4e0265582b7a1f";

export const avatarPresets = [
  { id: "green", label: "26" },
  { id: "gold", label: "TR" },
  { id: "blue", label: "FC" },
  { id: "rose", label: "XI" },
  { id: "dark", label: "GO" },
] as const;

export const localKeys = {
  users: "porra26_users",
  currentEmail: "porra26_current_email",
  predictions: "porra26_predictions",
  adminMatches: "porra26_admin_matches",
  pendingPrediction: "porra26_pending_prediction",
} as const;

export type LocalUser = {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  points: number;
  isAdmin: boolean;
  isPro?: boolean;
  isWolf?: boolean;
  isHidden?: boolean;
  lateEdit?: boolean;
  avatarUrl: string;
};

export function getLocalJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    return JSON.parse(window.localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}

export function setLocalJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

export function getLocalUsers() {
  return getLocalJson<LocalUser[]>(localKeys.users, []);
}

export function setLocalUsers(users: LocalUser[]) {
  setLocalJson(localKeys.users, users);
}

export function getLocalPredictions() {
  return getLocalJson<Record<string, Prediction>>(localKeys.predictions, {});
}

export function setLocalPredictions(predictions: Record<string, Prediction>) {
  setLocalJson(localKeys.predictions, predictions);
}

export function getLocalAdminResults() {
  return getLocalJson<AdminResults>(localKeys.adminMatches, {});
}

export function setLocalAdminResults(results: AdminResults) {
  setLocalJson(localKeys.adminMatches, results);
}

export function getCurrentLocalEmail() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(localKeys.currentEmail) || "";
}

export function setCurrentLocalEmail(email: string) {
  if (typeof window === "undefined") return;
  if (!email) {
    window.localStorage.removeItem(localKeys.currentEmail);
    return;
  }
  window.localStorage.setItem(localKeys.currentEmail, email);
}

export async function digest(value: string) {
  const buffer = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function currentLocalUser() {
  const email = getCurrentLocalEmail();
  return getLocalUsers().find((user) => user.email === email) || null;
}

export function localUserById(userId: string) {
  return getLocalUsers().find((user) => user.id === userId) || null;
}

export function saveLocalPrediction(userId: string, prediction: Prediction) {
  const predictions = getLocalPredictions();
  predictions[userId] = prediction;
  setLocalPredictions(predictions);
}

export function getPendingPrediction() {
  return getLocalJson<Prediction | null>(localKeys.pendingPrediction, null);
}

export function setPendingPrediction(prediction: Prediction) {
  setLocalJson(localKeys.pendingPrediction, prediction);
}

export function clearPendingPrediction() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(localKeys.pendingPrediction);
}

export async function ensureLocalAdminUser() {
  const users = getLocalUsers();
  const admin = users.find((user) => user.email === defaultAdminEmail);

  if (admin) {
    admin.name = "admin";
    admin.passwordHash = defaultAdminPasswordHash;
    admin.isAdmin = true;
    if (!admin.avatarUrl) admin.avatarUrl = "preset:gold";
    setLocalUsers(users);
    return;
  }

  users.unshift({
    id: "local-admin",
    name: "admin",
    email: defaultAdminEmail,
    passwordHash: defaultAdminPasswordHash,
    points: 0,
    isAdmin: true,
    avatarUrl: "preset:gold",
  });
  setLocalUsers(users);
}

// Hash determinista (FNV-1a) para repartir acciones sin Math.random, así el
// demo es estable entre recargas.
function demoHash(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

// Resultados de muestra: reparten acciones (goles según puesto, MVP, paradas,
// penaltis y alguna roja) a ~40% de los jugadores, para que el demo
// (clasificación, "Tu once" del perfil y /cofres) tenga puntos que mostrar.
function buildDemoAdminResults(): AdminResults {
  const events: AdminEvent[] = [];
  let counter = 0;
  const add = (playerId: string, type: AdminEvent["type"]) => {
    counter += 1;
    events.push({ id: `demo-${counter}`, playerId, type, minute: 1 });
  };
  data.players.forEach((player) => {
    const hash = demoHash(player.id);
    if (player.position === "POR") {
      if (hash % 3 === 0) add(player.id, "penalty_save");
      return;
    }
    if (hash % 5 < 2) {
      const goals = hash % 7 === 0 ? 2 : 1;
      for (let goal = 0; goal < goals; goal += 1) add(player.id, "goal");
    }
    if (hash % 11 === 0) add(player.id, "mvp");
    if (hash % 17 === 0) add(player.id, "penalty_goal");
    if (hash % 23 === 0) add(player.id, "penalty_miss");
    if (hash % 13 === 0) add(player.id, "red_card");
  });
  return { "demo-jornada": { homeScore: 0, awayScore: 0, events } };
}

// Todos los usuarios demo comparten esta contraseña para poder iniciar sesión
// y ver su propio once sin máscara.
export const demoUserPassword = "demo";

const demoUserSeeds = [
  { id: "demo-leo", name: "Leo (demo)", email: "leo@demo.local", avatarUrl: "preset:blue", skip: 0 },
  { id: "demo-ana", name: "Ana (demo)", email: "ana@demo.local", avatarUrl: "preset:rose", skip: 4 },
  { id: "demo-marc", name: "Marc (demo)", email: "marc@demo.local", avatarUrl: "preset:dark", skip: 8 },
] as const;

// Siembra usuarios por defecto con un once guardado lleno de jugadores que han
// puntuado (goles, MVP, rojas…), para poder ver la clasificación y el desglose
// del once. Idempotente: si ya existen, no hace nada y no pisa datos reales.
export async function ensureDemoUsers() {
  const users = getLocalUsers();
  if (users.some((user) => user.email === demoUserSeeds[0].email)) return;

  // Solo sembramos resultados si no hay ya (para no machacar los reales).
  let results = getLocalAdminResults();
  if (!results || Object.keys(results).length === 0) {
    results = buildDemoAdminResults();
    setLocalAdminResults(results);
  }

  const eventPlayerIds = new Set(
    Object.values(results).flatMap((result) => (result.events || []).map((event) => event.playerId)),
  );
  // Para cada puesto: primero los que tienen acciones (para que el once luzca
  // puntos y badges), luego el resto. `skip` desplaza la selección por usuario.
  const pickPosition = (position: Position, count: number, skip: number) => {
    const all = data.players.filter((player) => player.position === position);
    const withEvents = all.filter((player) => eventPlayerIds.has(player.id));
    const without = all.filter((player) => !eventPlayerIds.has(player.id));
    return [...withEvents, ...without].slice(skip, skip + count).map((player) => player.id);
  };
  // Orden de slots de 4-4-2: 2 DEL, 4 MED, 4 DEF, 1 POR.
  const buildXi = (skip: number) => [
    ...pickPosition("DEL", 2, skip),
    ...pickPosition("MED", 4, skip),
    ...pickPosition("DEF", 4, skip),
    ...pickPosition("POR", 1, skip),
  ];

  const passwordHash = await digest(demoUserPassword);
  const predictions = getLocalPredictions();
  const now = new Date().toISOString();

  demoUserSeeds.forEach((seed) => {
    users.push({
      id: seed.id,
      name: seed.name,
      email: seed.email,
      passwordHash,
      points: 0,
      isAdmin: false,
      avatarUrl: seed.avatarUrl,
    });
    predictions[seed.id] = {
      ...emptyPrediction(),
      xi: buildXi(seed.skip),
      xiFormation: "4-4-2",
      isDefinitive: true,
      updatedAt: now,
    };
  });

  setLocalUsers(users);
  setLocalPredictions(predictions);
}
