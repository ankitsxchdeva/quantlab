import { bench, describe } from "vitest";
import type { Bar } from "../types";
import { StrategySchema, type Strategy } from "../strategy/schema";
import { runBacktest } from "./engine";

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeBars(count: number, seed = 42): Bar[] {
  const rand = mulberry32(seed);
  const bars: Bar[] = [];
  let close = 100;
  for (let i = 0; i < count; i++) {
    const open = close;
    close = Math.max(1, close * (1 + (rand() - 0.495) * 0.02));
    const high = Math.max(open, close) * (1 + rand() * 0.005);
    const low = Math.min(open, close) * (1 - rand() * 0.005);
    bars.push({ time: i * 86_400_000, open, high, low, close, volume: 1000 + rand() * 9000 });
  }
  return bars;
}

const strategy: Strategy = StrategySchema.parse({
  name: "SMA crossover bench",
  asset: "BENCH",
  indicators: [
    { id: "fast", type: "SMA", source: "close", period: 50 },
    { id: "slow", type: "SMA", source: "close", period: 200 },
  ],
  entries: [{ side: "long", when: { op: "crosses_above", left: "fast", right: "slow" } }],
  exits: [{ when: { op: "crosses_below", left: "fast", right: "slow" } }],
});

const bars10k = makeBars(10_000);
const bars100k = makeBars(100_000);
const bars1m = makeBars(1_000_000);

describe("runBacktest - SMA(50/200) crossover", () => {
  bench("10k bars", () => {
    runBacktest(strategy, bars10k);
  });

  bench("100k bars", () => {
    runBacktest(strategy, bars100k);
  });

  bench("1M bars", () => {
    runBacktest(strategy, bars1m);
  });
});
