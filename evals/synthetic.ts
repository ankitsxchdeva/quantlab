import type { Bar } from "@/lib/types";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY = 86_400;
const START = Date.UTC(2020, 0, 1) / 1000;

// Trending random walk with cycles, occasional crash/rip days, and volume
// spikes, so crossover, RSI-extreme, breakout, and volume strategies all get
// a chance to trigger.
export function syntheticStockBars(count = 500, seed = 42): Bar[] {
  const rng = mulberry32(seed);
  const bars: Bar[] = [];
  let close = 100;
  for (let t = 0; t < count; t++) {
    let ret =
      0.0006 +
      0.012 * Math.sin((2 * Math.PI * t) / 60) +
      0.006 * Math.sin((2 * Math.PI * t) / 17) +
      (rng() - 0.5) * 0.02;
    if (t > 0 && t % 41 === 0) ret -= 0.085;
    if (t > 0 && t % 53 === 0) ret += 0.07;
    const open = close;
    close = Math.max(1, close * (1 + ret));
    const wick = Math.abs(rng()) * 0.01;
    const high = Math.max(open, close) * (1 + wick);
    const low = Math.min(open, close) * (1 - wick);
    const volume = Math.round(1_000_000 * (0.5 + rng()) * (t % 29 === 0 ? 3 : 1));
    bars.push({ time: START + t * DAY, open, high, low, close, volume });
  }
  return bars;
}

// Probability series in (0, 1) oscillating across the 0.2 / 0.3 / 0.6 / 0.7
// thresholds the prediction-market prompts use.
export function syntheticPolymarketBars(count = 500, seed = 7): Bar[] {
  const rng = mulberry32(seed);
  const bars: Bar[] = [];
  const clamp = (v: number) => Math.min(0.98, Math.max(0.02, v));
  let close = 0.5;
  for (let t = 0; t < count; t++) {
    const target = 0.5 + 0.34 * Math.sin((2 * Math.PI * t) / 120) + 0.08 * Math.sin((2 * Math.PI * t) / 31);
    const open = close;
    close = clamp(target + (rng() - 0.5) * 0.04);
    const wick = rng() * 0.01;
    const high = clamp(Math.max(open, close) + wick);
    const low = clamp(Math.min(open, close) - wick);
    const volume = Math.round(10_000 * (0.5 + rng()));
    bars.push({ time: START + t * 3600, open, high, low, close, volume });
  }
  return bars;
}
