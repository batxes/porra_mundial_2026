import type { AdminResults, Prediction } from "@/lib/types";

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
