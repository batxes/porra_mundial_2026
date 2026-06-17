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

// Pools de los sobres temáticos disponibles por defecto en la estantería. El
// drop_id real es `${pool}-${YYYY-MM-DD}` (igual que en cofres-view y
// open_themed_card_pack). Madrid/Francia quedan solo como drops de admin.
const THEMED_POOLS = ["sub21", "stars"];

// drop_ids disponibles HOY: 1 diario + los 4 temáticos del día. `dailyId` es
// `daily-${madridTodayKey()}`, de donde sacamos la fecha para los temáticos.
function availablePackIds(dailyId: string): string[] {
  const today = dailyId.replace(/^daily-/, "");
  return [dailyId, ...THEMED_POOLS.map((pool) => `${pool}-${today}`)];
}

// Versión SUPABASE (prod): cuenta los sobres del día que el usuario aún no ha
// abierto leyendo user_cards (lectura propia por RLS). Async; si algo falla,
// devuelve el total disponible (mejor sobre-contar que ocultar el banner).
export async function countUnopenedPacksRemote(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: { from: (t: string) => any },
  dailyId: string,
): Promise<number> {
  const available = availablePackIds(dailyId);
  try {
    const { data, error } = await supabase
      .from("user_cards")
      .select("drop_id");
    if (error || !data) return available.length;
    const opened = new Set(
      (data as Array<{ drop_id?: unknown }>)
        .map((row) => row.drop_id)
        .filter((id): id is string => typeof id === "string"),
    );
    return available.filter((id) => !opened.has(id)).length;
  } catch {
    return available.length;
  }
}

// Versión LOCAL (sin Supabase): cuántos sobres sin abrir, leyendo el estado que
// /cofres guarda en localStorage (porra26_cards_<uid>_opened / _inventory).
// dailyId debe ser `daily-${madridTodayKey()}`.
export function countUnopenedPacks(userId: string, dailyId: string): number {
  const available = availablePackIds(dailyId);
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
  return available.filter((id) => !opened.has(id)).length;
}
