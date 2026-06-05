import type { Bar, DataRequest, MarketResolution, Timeframe } from "@/lib/types";

export interface FetchResult {
  bars: Bar[];
  market: MarketResolution;
}

const TIMEFRAME_TO_INTERVAL: Record<Timeframe, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "1h": "60m",
  "1d": "1d",
  "1wk": "1wk",
  "1mo": "1mo",
};

const DAY_MS = 24 * 60 * 60 * 1000;

function defaultStart(timeframe: Timeframe, end: Date): Date {
  const endMs = end.getTime();
  switch (timeframe) {
    case "1m":
    case "5m":
    case "15m":
      return new Date(endMs - 7 * DAY_MS);
    case "1h":
      return new Date(endMs - 60 * DAY_MS);
    case "1d":
    case "1wk":
    case "1mo":
      return new Date(endMs - 5 * 365 * DAY_MS);
  }
}

function parseDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

interface YahooChartQuote {
  open: (number | null)[];
  high: (number | null)[];
  low: (number | null)[];
  close: (number | null)[];
  volume: (number | null)[];
}

interface YahooChartResult {
  timestamp?: number[];
  indicators?: { quote?: YahooChartQuote[] };
}

interface YahooChartResponse {
  chart?: {
    result?: YahooChartResult[];
    error?: { code?: string; description?: string } | null;
  };
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export async function fetchBars(req: DataRequest): Promise<FetchResult> {
  const interval = TIMEFRAME_TO_INTERVAL[req.timeframe];

  const end = parseDate(req.end) ?? new Date();
  const start = parseDate(req.start) ?? defaultStart(req.timeframe, end);

  const period1 = Math.floor(start.getTime() / 1000);
  const period2 = Math.floor(end.getTime() / 1000);

  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(req.symbol)}`);
  url.searchParams.set("period1", String(period1));
  url.searchParams.set("period2", String(period2));
  url.searchParams.set("interval", interval);
  url.searchParams.set("includePrePost", "false");
  url.searchParams.set("events", "div,splits");

  const res = await fetch(url.toString(), {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      accept: "application/json",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Yahoo Finance request failed (${res.status}) for ${req.symbol}`);
  }

  const body = (await res.json()) as YahooChartResponse;

  if (body.chart?.error) {
    throw new Error(`Yahoo Finance error for ${req.symbol}: ${body.chart.error.description ?? body.chart.error.code}`);
  }

  const result = body.chart?.result?.[0];
  const timestamps = result?.timestamp;
  const quote = result?.indicators?.quote?.[0];

  if (!result || !timestamps || !quote || timestamps.length === 0) {
    throw new Error(
      `No data for ${req.symbol} in range ${start.toISOString().slice(0, 10)}..${end.toISOString().slice(0, 10)} at ${req.timeframe}`,
    );
  }

  const bars: Bar[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const o = quote.open?.[i];
    const h = quote.high?.[i];
    const l = quote.low?.[i];
    const c = quote.close?.[i];
    const v = quote.volume?.[i];
    if (!isFiniteNumber(o) || !isFiniteNumber(h) || !isFiniteNumber(l) || !isFiniteNumber(c)) continue;
    bars.push({
      time: timestamps[i] * 1000,
      open: o,
      high: h,
      low: l,
      close: c,
      volume: isFiniteNumber(v) ? v : 0,
    });
  }

  if (bars.length === 0) {
    throw new Error(
      `No usable data for ${req.symbol} in range ${start.toISOString().slice(0, 10)}..${end.toISOString().slice(0, 10)} at ${req.timeframe}`,
    );
  }

  bars.sort((a, b) => a.time - b.time);
  const upper = req.symbol.toUpperCase();
  return {
    bars,
    market: {
      source: "stock",
      symbol: upper,
      label: upper,
      url: `https://finance.yahoo.com/quote/${encodeURIComponent(upper)}`,
    },
  };
}
