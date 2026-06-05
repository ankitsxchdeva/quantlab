import type { Bar, DataRequest, Timeframe } from "@/lib/types";
import type { FetchResult } from "./yahoo";

interface PolymarketMarket {
  id: string;
  question: string;
  slug: string;
  conditionId: string;
  clobTokenIds?: string;
  outcomes?: string;
  active?: boolean;
  closed?: boolean;
  startDate?: string;
  endDate?: string;
  volume?: string;
}

interface PolymarketPricePoint {
  t: number;
  p: number;
}

interface PolymarketPricesResponse {
  history?: PolymarketPricePoint[];
}

const FIDELITY: Record<Timeframe, number> = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "1h": 60,
  "1d": 1440,
  "1wk": 1440 * 7,
  "1mo": 1440 * 30,
};

const BAR_MS: Record<Timeframe, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "1d": 24 * 60 * 60_000,
  "1wk": 7 * 24 * 60 * 60_000,
  "1mo": 30 * 24 * 60 * 60_000,
};

function parseDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseClobTokenIds(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // not JSON, ignore
  }
  return [];
}

async function findMarket(slugOrQuestion: string): Promise<PolymarketMarket> {
  const cleaned = slugOrQuestion.replace(/^polymarket:/i, "").trim();

  const bySlug = new URL("https://gamma-api.polymarket.com/markets");
  bySlug.searchParams.set("slug", cleaned);
  const slugRes = await fetch(bySlug.toString(), { cache: "no-store" });
  if (slugRes.ok) {
    const data = (await slugRes.json()) as PolymarketMarket[] | PolymarketMarket;
    const list = Array.isArray(data) ? data : [data];
    const hit = list.find((m) => m?.slug === cleaned) ?? list[0];
    if (hit && hit.id) return hit;
  }

  const search = new URL("https://gamma-api.polymarket.com/markets");
  search.searchParams.set("limit", "20");
  search.searchParams.set("active", "true");
  search.searchParams.set("closed", "false");
  search.searchParams.set("order", "volume");
  search.searchParams.set("ascending", "false");
  const searchRes = await fetch(search.toString(), { cache: "no-store" });
  if (searchRes.ok) {
    const list = (await searchRes.json()) as PolymarketMarket[];
    const lower = cleaned.toLowerCase();
    const hit = list.find((m) => m?.question?.toLowerCase().includes(lower));
    if (hit) return hit;
  }

  throw new Error(`Could not find Polymarket market for "${cleaned}"`);
}

function bucketByTimeframe(points: PolymarketPricePoint[], timeframe: Timeframe): Bar[] {
  if (points.length === 0) return [];
  const step = BAR_MS[timeframe];
  const buckets = new Map<number, { open: number; high: number; low: number; close: number; openTime: number; closeTime: number }>();
  for (const pt of points) {
    if (!Number.isFinite(pt.t) || !Number.isFinite(pt.p)) continue;
    const ms = pt.t * 1000;
    const bucketKey = Math.floor(ms / step) * step;
    const existing = buckets.get(bucketKey);
    if (!existing) {
      buckets.set(bucketKey, {
        open: pt.p,
        high: pt.p,
        low: pt.p,
        close: pt.p,
        openTime: ms,
        closeTime: ms,
      });
    } else {
      if (ms < existing.openTime) {
        existing.openTime = ms;
        existing.open = pt.p;
      }
      if (ms > existing.closeTime) {
        existing.closeTime = ms;
        existing.close = pt.p;
      }
      if (pt.p > existing.high) existing.high = pt.p;
      if (pt.p < existing.low) existing.low = pt.p;
    }
  }
  const keys = Array.from(buckets.keys()).sort((a, b) => a - b);
  return keys.map((k) => {
    const b = buckets.get(k)!;
    return { time: k, open: b.open, high: b.high, low: b.low, close: b.close, volume: 0 };
  });
}

export async function fetchBars(req: DataRequest): Promise<FetchResult> {
  const market = await findMarket(req.symbol);
  const tokenIds = parseClobTokenIds(market.clobTokenIds);
  if (tokenIds.length === 0) {
    throw new Error(`Polymarket market "${market.question}" has no CLOB token IDs (may be unresolved or pre-trading)`);
  }
  const yesTokenId = tokenIds[0];

  const start = parseDate(req.start);
  const end = parseDate(req.end) ?? new Date();

  const url = new URL("https://clob.polymarket.com/prices-history");
  url.searchParams.set("market", yesTokenId);
  url.searchParams.set("fidelity", String(FIDELITY[req.timeframe]));
  if (start) {
    url.searchParams.set("startTs", String(Math.floor(start.getTime() / 1000)));
    url.searchParams.set("endTs", String(Math.floor(end.getTime() / 1000)));
  } else {
    url.searchParams.set("interval", "max");
  }

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Polymarket prices-history failed (${res.status}) for "${market.question}"`);
  }

  const body = (await res.json()) as PolymarketPricesResponse;
  const points = body.history ?? [];
  if (points.length === 0) {
    throw new Error(`No price history for Polymarket market "${market.question}"`);
  }

  return {
    bars: bucketByTimeframe(points, req.timeframe),
    market: {
      source: "polymarket",
      symbol: market.slug,
      label: market.question,
      url: `https://polymarket.com/event/${market.slug}`,
    },
  };
}
