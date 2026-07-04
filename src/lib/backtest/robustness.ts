import type { Bar, BacktestResult } from "../types";
import type { Strategy } from "../strategy/schema";
import { runBacktest } from "./engine";
import type { MonteCarloResult } from "./montecarlo";

export type RobustnessVerdict = "holds" | "degrades" | "collapses";

export interface SegmentSummary {
  bars: number;
  trades: number;
  totalReturnPct: number;
  buyHoldReturnPct: number;
  /** Per-bar geometric edge over the segment's own buy-and-hold, in percent. */
  edgePerBarPct: number;
  maxDrawdownPct: number;
  sharpe: number;
}

export interface SplitRobustness {
  verdict: RobustnessVerdict;
  splitPct: number;
  inSample: SegmentSummary;
  outOfSample: SegmentSummary;
}

/** Shape of the `robustness` field on the /api/run response. */
export interface RobustnessReport {
  split: SplitRobustness | null;
  monteCarlo: MonteCarloResult | null;
}

const SPLIT_FRACTION = 0.7;
const MIN_SEGMENT_BARS = 10;

// Per-bar geometric edge vs the segment's own buy-and-hold. Total returns of
// a 70% slice and a 30% slice are not comparable (more bars, more
// compounding), but per-bar growth rates are.
function edgePerBar(totalReturnPct: number, buyHoldReturnPct: number, bars: number): number {
  if (bars <= 0) return 0;
  const strat = Math.max(1e-9, 1 + totalReturnPct / 100);
  const hold = Math.max(1e-9, 1 + buyHoldReturnPct / 100);
  return Math.pow(strat / hold, 1 / bars) - 1;
}

function summarize(result: BacktestResult): SegmentSummary {
  const bars = result.bars.length;
  const totalReturnPct = result.metrics.totalReturnPct;
  const buyHoldReturnPct = result.benchmark.totalReturnPct;
  return {
    bars,
    trades: result.trades.length,
    totalReturnPct,
    buyHoldReturnPct,
    edgePerBarPct: edgePerBar(totalReturnPct, buyHoldReturnPct, bars) * 100,
    maxDrawdownPct: result.metrics.maxDrawdownPct,
    sharpe: result.metrics.sharpe,
  };
}

// Deliberately blunt thresholds:
//   collapses - a profitable in-sample run turns into an out-of-sample loss,
//               or the in-sample edge over buy-and-hold drops to zero or below.
//   holds     - out of sample retains at least half the in-sample per-bar edge.
//   degrades  - anything in between (edge still positive, but under half).
// When there was no in-sample edge to preserve, "holds" just means out of
// sample did not get any worse.
export function verdictFor(inSample: SegmentSummary, outOfSample: SegmentSummary): RobustnessVerdict {
  if (inSample.totalReturnPct >= 0 && outOfSample.totalReturnPct < 0) return "collapses";
  const isEdge = inSample.edgePerBarPct;
  const oosEdge = outOfSample.edgePerBarPct;
  if (isEdge > 0) {
    if (oosEdge <= 0) return "collapses";
    return oosEdge >= 0.5 * isEdge ? "holds" : "degrades";
  }
  return oosEdge >= isEdge ? "holds" : "degrades";
}

/**
 * Splits the bars 70/30, reruns the same strategy on each segment (the engine
 * is pure, so this is just two more runBacktest calls), and compares each
 * segment's edge over its own buy-and-hold. Returns null when either segment
 * is too short to say anything.
 */
export function assessRobustness(strategy: Strategy, bars: Bar[]): SplitRobustness | null {
  const splitIdx = Math.floor(bars.length * SPLIT_FRACTION);
  const inBars = bars.slice(0, splitIdx);
  const outBars = bars.slice(splitIdx);
  if (inBars.length < MIN_SEGMENT_BARS || outBars.length < MIN_SEGMENT_BARS) return null;

  const inSample = summarize(runBacktest(strategy, inBars));
  const outOfSample = summarize(runBacktest(strategy, outBars));

  return {
    verdict: verdictFor(inSample, outOfSample),
    splitPct: Math.round(SPLIT_FRACTION * 100),
    inSample,
    outOfSample,
  };
}
