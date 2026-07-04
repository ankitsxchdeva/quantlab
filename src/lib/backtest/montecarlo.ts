import type { Trade } from "../types";

export interface PercentileBand {
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
}

export interface MonteCarloBandPoint extends PercentileBand {
  time: number;
}

export interface MonteCarloResult {
  runs: number;
  tradeCount: number;
  terminalEquity: PercentileBand;
  maxDrawdownPct: PercentileBand;
  /** Share of resampled runs (0-100) that ended below the initial equity. */
  probLossPct: number;
  /** Per-trade-step equity percentiles, timestamped to the original trade sequence. */
  equityBands: MonteCarloBandPoint[];
}

export const DEFAULT_MC_RUNS = 1000;
const DEFAULT_SEED = 0x5eed1e;

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

// Linear interpolation between closest ranks; input must be sorted ascending.
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function band(values: number[]): PercentileBand {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p5: percentile(sorted, 5),
    p25: percentile(sorted, 25),
    p50: percentile(sorted, 50),
    p75: percentile(sorted, 75),
    p95: percentile(sorted, 95),
  };
}

/**
 * Bootstrap-resamples the closed-trade percentage-return sequence: each run
 * draws trades.length returns with replacement and compounds them from
 * initialEquity. Seeded, so identical inputs always produce identical output.
 *
 * Drawdowns are marked to market at trade exits only, so intra-trade
 * excursions are not counted; the distribution answers "was this equity curve
 * luck of the ordering?", not "what is the worst tick-level drawdown?".
 */
export function runMonteCarlo(
  trades: Trade[],
  initialEquity: number,
  opts: { runs?: number; seed?: number } = {},
): MonteCarloResult | null {
  if (trades.length === 0) return null;
  const runs = opts.runs ?? DEFAULT_MC_RUNS;
  const rand = mulberry32(opts.seed ?? DEFAULT_SEED);
  const returns = trades.map((t) => t.pnlPct / 100);
  const n = returns.length;

  const terminals: number[] = [];
  const maxDDs: number[] = [];
  // stepEquities[k] holds equity after k resampled trades, across all runs.
  const stepEquities: number[][] = Array.from({ length: n + 1 }, () => []);

  for (let run = 0; run < runs; run++) {
    let eq = initialEquity;
    let peak = eq;
    let maxDD = 0;
    stepEquities[0].push(eq);
    for (let k = 0; k < n; k++) {
      eq *= 1 + returns[Math.floor(rand() * n)];
      if (eq > peak) peak = eq;
      const dd = peak > 0 ? (peak - eq) / peak : 0;
      if (dd > maxDD) maxDD = dd;
      stepEquities[k + 1].push(eq);
    }
    terminals.push(eq);
    maxDDs.push(maxDD * 100);
  }

  // Step 0 sits at the first entry; step k at the k-th trade's exit, so the
  // fan overlays the realized equity curve on the same time axis.
  const times = [trades[0].entryTime, ...trades.map((t) => t.exitTime)];
  const equityBands = stepEquities.map((values, k) => ({ time: times[k], ...band(values) }));

  return {
    runs,
    tradeCount: n,
    terminalEquity: band(terminals),
    maxDrawdownPct: band(maxDDs),
    probLossPct: (terminals.filter((v) => v < initialEquity).length / runs) * 100,
    equityBands,
  };
}
