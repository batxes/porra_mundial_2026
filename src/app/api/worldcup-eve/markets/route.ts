import { NextResponse } from "next/server";

const MARKETS_URL =
  "https://raw.githubusercontent.com/roprgm/worldcup-eve/main/lib/predictions/markets.json";
const CLOB = "https://clob.polymarket.com";
const GAMMA = "https://gamma-api.polymarket.com";
const MARKET_KINDS = new Set([
  "reach_r16",
  "reach_qf",
  "reach_sf",
  "reach_final",
  "champion",
]);

type CatalogMarket = {
  code: string;
  conditionId: string;
  eventId: string;
  kind: string;
  settled?: number;
  yesToken: string;
};

type Catalog = {
  generatedAt: string;
  markets: CatalogMarket[];
};

type MidpointValue =
  | string
  | number
  | {
      mid?: string | number;
      midpoint?: string | number;
      price?: string | number;
      token_id?: string;
    };

function toPrice(value: unknown) {
  const price = Number(value);
  return Number.isFinite(price) ? price : null;
}

function toMidpoint(value: MidpointValue) {
  if (value && typeof value === "object") {
    return toPrice(value.mid ?? value.midpoint ?? value.price);
  }
  return toPrice(value);
}

function settle(price: number) {
  if (price > 0.99) return 1;
  if (price < 0.01) return 0;
  return Math.round(price * 10000) / 10000;
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function fetchMidpoints(markets: CatalogMarket[]) {
  const prices = new Map<string, number>();
  for (const batch of chunk(markets, 500)) {
    const response = await fetch(`${CLOB}/midpoints`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        batch.map((market) => ({ token_id: market.yesToken })),
      ),
      cache: "no-store",
    });
    if (!response.ok) continue;

    const data = (await response.json()) as
      | MidpointValue[]
      | Record<string, MidpointValue>;
    const entries = Array.isArray(data)
      ? data.map((row) => [
          typeof row === "object" ? row.token_id : undefined,
          row,
        ] as const)
      : Object.entries(data);

    for (const [token, value] of entries) {
      const market = batch.find((candidate) => candidate.yesToken === token);
      const price = toMidpoint(value);
      if (market && price != null) prices.set(market.conditionId, settle(price));
    }
  }
  return prices;
}

function gammaYesPrice(market: { outcomes: string; outcomePrices: string }) {
  try {
    const outcomes = JSON.parse(market.outcomes) as string[];
    const prices = JSON.parse(market.outcomePrices) as string[];
    const yesIndex = outcomes.indexOf("Yes");
    return yesIndex >= 0 ? toPrice(prices[yesIndex]) : null;
  } catch {
    return null;
  }
}

async function fetchGammaFallback(markets: CatalogMarket[]) {
  const wanted = new Set(markets.map((market) => market.conditionId));
  const prices = new Map<string, number>();

  await Promise.all(
    Array.from(new Set(markets.map((market) => market.eventId))).map(
      async (eventId) => {
        const response = await fetch(`${GAMMA}/events?id=${eventId}`, {
          cache: "no-store",
        });
        if (!response.ok) return;

        const events = (await response.json()) as Array<{
          markets?: Array<{
            conditionId: string;
            outcomes: string;
            outcomePrices: string;
          }>;
        }>;

        for (const event of events) {
          for (const market of event.markets ?? []) {
            if (!wanted.has(market.conditionId)) continue;
            const price = gammaYesPrice(market);
            if (price != null) prices.set(market.conditionId, settle(price));
          }
        }
      },
    ),
  );

  return prices;
}

export async function GET() {
  const catalogResponse = await fetch(MARKETS_URL, {
    next: { revalidate: 300 },
  });
  if (!catalogResponse.ok) {
    return NextResponse.json(
      { error: "No se pudo leer markets.json de worldcup-eve" },
      { status: 502 },
    );
  }

  const catalog = (await catalogResponse.json()) as Catalog;
  const markets = catalog.markets.filter((market) =>
    MARKET_KINDS.has(market.kind),
  );
  const prices = new Map<string, number>();
  const open: CatalogMarket[] = [];

  for (const market of markets) {
    if (market.settled != null) prices.set(market.conditionId, market.settled);
    else open.push(market);
  }

  for (const [conditionId, price] of await fetchMidpoints(open)) {
    prices.set(conditionId, price);
  }

  const missing = open.filter((market) => !prices.has(market.conditionId));
  if (missing.length) {
    for (const [conditionId, price] of await fetchGammaFallback(missing)) {
      prices.set(conditionId, price);
    }
  }

  const byKind: Record<string, Record<string, number>> = {};
  for (const market of markets) {
    const price = prices.get(market.conditionId);
    if (price == null) continue;
    byKind[market.kind] ||= {};
    byKind[market.kind][market.code] = settle(price);
  }

  return NextResponse.json({
    prices: byKind,
  });
}
