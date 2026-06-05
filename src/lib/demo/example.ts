import { runBacktest } from "@/lib/backtest/engine";
import type { Bar, BacktestResult, MarketResolution } from "@/lib/types";
import type { Strategy } from "@/lib/strategy/schema";

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-9);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function synthesizeBars(symbol: string, days: number): Bar[] {
  const rand = mulberry32(0xbeefcafe);
  const startMs = Date.UTC(2020, 0, 2);
  const dayMs = 86_400_000;
  const driftAnnual = 0.12;
  const volAnnual = 0.28;
  const dt = 1 / 252;
  const mu = driftAnnual * dt;
  const sigma = volAnnual * Math.sqrt(dt);

  const bars: Bar[] = [];
  let price = 100;
  let t = startMs;

  for (let i = 0; i < days; i++) {
    const open = price;
    const ret = mu + sigma * gaussian(rand);
    const close = Math.max(0.5, open * Math.exp(ret));
    const intraRange = open * Math.abs(sigma * 1.5 * (0.6 + rand() * 0.8));
    const high = Math.max(open, close) + intraRange * 0.5;
    const low = Math.min(open, close) - intraRange * 0.5;
    const volume = Math.round(1_500_000 + rand() * 1_500_000);
    bars.push({ time: t, open, high, low, close, volume });
    price = close;
    t += dayMs;
    if (i % 5 === 4) t += dayMs * 2;
  }
  void symbol;
  return bars;
}

const DEMO_STRATEGY: Strategy = {
  name: "Golden cross on a synthetic blue chip",
  description: "Buy when the 50-day SMA crosses above the 200-day SMA, sell when it crosses back below. Classic Wall-Street trend filter applied to a synthetic dataset (real Yahoo data flows the same way once you add a key).",
  asset: "DEMO",
  market: "stock",
  timeframe: "1d",
  initialEquity: 10_000,
  indicators: [
    { id: "sma_fast", type: "SMA", source: "close", period: 50 },
    { id: "sma_slow", type: "SMA", source: "close", period: 200 },
  ],
  entries: [
    { side: "long", when: { op: "crosses_above", left: { ref: "sma_fast" }, right: { ref: "sma_slow" } } },
  ],
  exits: [
    { when: { op: "crosses_below", left: { ref: "sma_fast" }, right: { ref: "sma_slow" } }, reason: "death_cross" },
  ],
  risk: { positionSizePct: 100 },
  allowShort: false,
};

const DEMO_MARKET: MarketResolution = {
  source: "stock",
  symbol: "DEMO",
  label: "Synthetic blue chip (demo)",
};

let cached: { result: BacktestResult; strategy: Strategy } | null = null;

export function getExampleResult(): { result: BacktestResult; strategy: Strategy } {
  if (cached) return cached;
  const bars = synthesizeBars("DEMO", 6 * 252);
  const result = runBacktest(DEMO_STRATEGY, bars, DEMO_MARKET);
  cached = { result, strategy: DEMO_STRATEGY };
  return cached;
}
