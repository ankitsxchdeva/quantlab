import { fetchWithTimeout } from "@/lib/data/common";

// Kalshi market data is public. Signed requests are only needed for balances,
// positions, and order entry -- none of which the scanner touches. So this
// adapter needs no key and no environment variable, same as the Yahoo adapter.
const BASE = "https://api.elections.kalshi.com/trade-api/v2";

export interface KalshiLeg {
  market_ticker: string;
  event_ticker?: string;
  side: "yes" | "no";
}

/**
 * An event groups the markets for one question. `mutually_exclusive` is the
 * load-bearing field: when true, Kalshi is asserting at most one of the nested
 * markets can resolve YES, which is a logical constraint we can price without
 * modelling anything about the underlying subject.
 *
 * Note what it does NOT assert: that one of them MUST resolve YES. See
 * dutchbook.ts for why that asymmetry decides which direction is safe.
 */
export interface KalshiEvent {
  event_ticker: string;
  series_ticker?: string;
  title?: string;
  sub_title?: string;
  category?: string;
  mutually_exclusive?: boolean;
  markets?: KalshiMarket[];
}

export interface KalshiSeries {
  ticker: string;
  fee_type?: string;
  fee_multiplier?: number;
}

export interface KalshiMarket {
  ticker: string;
  event_ticker?: string;
  status: string;
  result?: string;
  title?: string;
  yes_sub_title?: string;
  rules_primary?: string;
  mve_collection_ticker?: string;
  mve_selected_legs?: KalshiLeg[];
  yes_bid_dollars?: string;
  yes_ask_dollars?: string;
  no_bid_dollars?: string;
  no_ask_dollars?: string;
  yes_bid_size_fp?: string;
  yes_ask_size_fp?: string;
  last_price_dollars?: string;
  volume_24h_fp?: string;
  open_interest_fp?: string;
}

async function get<T>(path: string, params?: Record<string, string | number>): Promise<T> {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, String(v));
  const res = await fetchWithTimeout(
    url.toString(),
    { headers: { accept: "application/json" } },
    "Kalshi timed out. The exchange API may be slow right now.",
  );
  if (!res.ok) {
    throw new Error(`Kalshi returned ${res.status} for ${path}`);
  }
  return (await res.json()) as T;
}

export async function fetchMarket(ticker: string): Promise<KalshiMarket> {
  // Kalshi tickers are upper-case and the API is case-sensitive: a pasted
  // `kxprogsweep-26nov03` 404s where `KXPROGSWEEP-26NOV03` resolves. Normalize
  // here rather than at the callers, since this is the one place a ticker
  // becomes a request path.
  const normalized = ticker.trim().toUpperCase();
  const { market } = await get<{ market: KalshiMarket }>(`/markets/${encodeURIComponent(normalized)}`);
  if (!market) throw new Error(`No Kalshi market named ${normalized}`);
  return market;
}

/**
 * Fetch markets page by page. The list response already carries top-of-book on
 * both sides plus `mve_selected_legs`, so a page is enough to price every
 * parlay it contains without any follow-up request.
 *
 * `maxPages` is a hard budget: the full open set is ~1M markets across ~1000
 * pages (~220s), far too slow for a request. Callers must surface how much of
 * the exchange a bounded scan actually covered -- see ScanCoverage.
 */
export async function fetchMarketPages(
  maxPages: number,
  status = "open",
): Promise<{ markets: KalshiMarket[]; pages: number; exhausted: boolean }> {
  const markets: KalshiMarket[] = [];
  let cursor: string | undefined;
  let pages = 0;
  for (; pages < maxPages; ) {
    const params: Record<string, string | number> = { status, limit: 1000 };
    if (cursor) params.cursor = cursor;
    const page = await get<{ markets?: KalshiMarket[]; cursor?: string }>("/markets", params);
    const batch = page.markets ?? [];
    markets.push(...batch);
    pages += 1;
    cursor = page.cursor;
    if (!cursor || batch.length === 0) {
      return { markets, pages, exhausted: true };
    }
  }
  return { markets, pages, exhausted: false };
}

/**
 * Fetch events with their markets nested, page by page.
 *
 * Far cheaper than walking /markets for constraint work: ~200 events per page
 * carry every nested market's top-of-book, so a handful of pages covers
 * thousands of markets already grouped by the relationship we care about.
 * Same hard page budget and same obligation to report coverage.
 */
export async function fetchEventPages(
  maxPages: number,
  status = "open",
): Promise<{ events: KalshiEvent[]; pages: number; exhausted: boolean }> {
  const events: KalshiEvent[] = [];
  let cursor: string | undefined;
  let pages = 0;
  for (; pages < maxPages; ) {
    const params: Record<string, string | number> = { status, limit: 200, with_nested_markets: "true" };
    if (cursor) params.cursor = cursor;
    const page = await get<{ events?: KalshiEvent[]; cursor?: string }>("/events", params);
    const batch = page.events ?? [];
    events.push(...batch);
    pages += 1;
    cursor = page.cursor;
    if (!cursor || batch.length === 0) {
      return { events, pages, exhausted: true };
    }
  }
  return { events, pages, exhausted: false };
}

/** Fee schedule for a series. Needed to tell maker-free series from the rest. */
export async function fetchSeries(ticker: string): Promise<KalshiSeries> {
  const { series } = await get<{ series: KalshiSeries }>(
    `/series/${encodeURIComponent(ticker.trim().toUpperCase())}`,
  );
  if (!series) throw new Error(`No Kalshi series named ${ticker}`);
  return series;
}
