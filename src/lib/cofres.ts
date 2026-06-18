// Helpers de tiempo de los sobres, compartidos entre /cofres y la home (banner
// promo). El reparto del sobre diario es a las 10:00 (hora de Madrid).

// Segundos hasta el próximo reparto de carta diaria: las 10:00 (hora de Madrid).
export function secondsUntilNextDailyCard() {
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

export function formatCountdownHMS(totalSeconds: number) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

// Fecha (Madrid) y hora actuales en una sola lectura.
function madridNow(): { dateKey: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value || "";
  let hour = Number(value("hour"));
  if (hour === 24) hour = 0; // algunos locales devuelven "24" a medianoche
  return {
    dateKey: `${value("year")}-${value("month")}-${value("day")}`,
    hour,
  };
}

// Suma `offset` días a una clave YYYY-MM-DD (usa mediodía UTC para no cruzar día
// por DST). Comparar claves YYYY-MM-DD con < / >= es comparar cronológicamente.
export function shiftDateKey(key: string, offset: number): string {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

// Primer ciclo de sobres (activación de las cartas en prod). Los sobres se
// generan desde aquí hasta el ciclo actual, así los no abiertos SE ACUMULAN.
export const DAILY_FIRST_CYCLE = "2026-06-17";

// Clave del ciclo actual, ANCLADA A LAS 10:00 (Madrid): cada periodo 10:00→10:00
// es un ciclo, identificado por la fecha en la que empezó. Antes de las 10:00 el
// ciclo sigue siendo el del día anterior. Así el sobre nuevo entra a las 10:00,
// no a medianoche (coincide con secondsUntilNextDailyCard).
export function dailyCycleKey(): string {
  const { dateKey, hour } = madridNow();
  return hour < 10 ? shiftDateKey(dateKey, -1) : dateKey;
}

// Todas las claves de ciclo desde `first` hasta el actual, de más nuevo a más
// viejo (con tope de seguridad para no crecer sin límite).
export function cycleKeysSince(
  first: string = DAILY_FIRST_CYCLE,
  cap = 90,
): string[] {
  const keys: string[] = [];
  let key = dailyCycleKey();
  for (let i = 0; i < cap && key >= first; i += 1) {
    keys.push(key);
    key = shiftDateKey(key, -1);
  }
  return keys;
}

// Pools de los sobres temáticos de BIENVENIDA (uno de cada, no se renuevan
// solos). Madrid/Francia quedan solo como drops de admin. Mantener en sync con
// THEMED_CONFIGS de cofres-view.
export const SHELF_THEMED_POOLS = [
  "sub21",
  "stars",
  "premier",
  "defensas",
  "medios",
  "delanteros",
] as const;

// drop_ids disponibles automáticamente PARA ESE USUARIO. Los sobres son por
// usuario, así que el id lleva el uid: `daily-<ciclo>-<uid>` (uno por ciclo,
// acumulan) + los temáticos de bienvenida `<pool>-<activación>-<uid>`. Los drops
// de admin NO se cuentan aquí (se ven en /cofres).
export function availablePackIds(userId: string): string[] {
  const uid = userId || "guest";
  const ids: string[] = cycleKeysSince().map(
    (cycle) => `daily-${cycle}-${uid}`,
  );
  for (const pool of SHELF_THEMED_POOLS) {
    ids.push(`${pool}-${DAILY_FIRST_CYCLE}-${uid}`);
  }
  return ids;
}

// Un id por-usuario termina en `-<uuid>`. Los compartidos de la era "igual para
// todos" (p.ej. `daily-2026-06-17`) no.
const UUID_TAIL =
  /-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Reconciliación transición: un sobre abierto con id COMPARTIDO (sin uid) cuenta
// como abierto también en su id por-usuario `<id>-<uid>`. Sin esto, a quien abrió
// en la era "igual para todos" el contador se lo seguía contando como sin abrir.
// Igual que el gate de la estantería en cofres-view.
function withLegacyOpened(opened: Set<string>, uid: string): Set<string> {
  for (const id of [...opened]) {
    if (!UUID_TAIL.test(id)) opened.add(`${id}-${uid}`);
  }
  return opened;
}

// Versión SUPABASE (prod): cuenta los sobres que el usuario aún no ha abierto
// leyendo user_cards (lectura propia por RLS). Async; si algo falla, devuelve el
// total disponible (mejor sobre-contar que ocultar el banner).
export async function countUnopenedPacksRemote(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: { from: (t: string) => any },
  userId: string,
): Promise<number> {
  const uid = userId || "guest";
  const available = availablePackIds(userId);
  try {
    const { data, error } = await supabase
      .from("user_cards")
      .select("drop_id");
    if (error || !data) return available.length;
    const opened = withLegacyOpened(
      new Set(
        (data as Array<{ drop_id?: unknown }>)
          .map((row) => row.drop_id)
          .filter((id): id is string => typeof id === "string"),
      ),
      uid,
    );
    return available.filter((id) => !opened.has(id)).length;
  } catch {
    return available.length;
  }
}

// Versión LOCAL (sin Supabase): cuántos sobres sin abrir, leyendo el estado que
// /cofres guarda en localStorage (porra26_cards_<uid>_opened / _inventory).
export function countUnopenedPacks(userId: string): number {
  const available = availablePackIds(userId);
  if (typeof window === "undefined") return available.length;
  const uid = userId || "guest";
  const readArray = (suffix: string): unknown[] => {
    try {
      const raw = window.localStorage.getItem(`porra26_cards_${uid}_${suffix}`);
      const parsed = raw ? JSON.parse(raw) : null;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  const opened = new Set<string>();
  for (const id of readArray("opened")) {
    if (typeof id === "string") opened.add(id);
  }
  for (const card of readArray("inventory")) {
    const packId = (card as { packId?: unknown })?.packId;
    if (typeof packId === "string") opened.add(packId);
  }
  withLegacyOpened(opened, uid);
  return available.filter((id) => !opened.has(id)).length;
}
