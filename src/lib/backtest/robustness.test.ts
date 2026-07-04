import { describe, it, expect } from "vitest";
import type { Bar } from "../types";
import type { Strategy } from "../strategy/schema";
import { assessRobustness, verdictFor, type SegmentSummary } from "./robustness";

const MS_PER_DAY = 86_400_000;

function flatBar(price: number, i: number): Bar {
  return { time: i * MS_PER_DAY, open: price, high: price, low: price, close: price, volume: 1000 };
}

function seg(totalReturnPct: number, buyHoldReturnPct: number, bars: number): SegmentSummary {
  const edgePerBarPct =
    (Math.pow((1 + totalReturnPct / 100) / (1 + buyHoldReturnPct / 100), 1 / bars) - 1) * 100;
  return {
    bars,
    trades: 10,
    totalReturnPct,
    buyHoldReturnPct,
    edgePerBarPct,
    maxDrawdownPct: 10,
    sharpe: 1,
  };
}

describe("verdictFor", () => {
  it("holds when the out-of-sample per-bar edge keeps at least half the in-sample edge", () => {
    expect(verdictFor(seg(100, 0, 100), seg(35, 0, 43))).toBe("holds");
  });

  it("degrades when the edge survives but drops below half", () => {
    expect(verdictFor(seg(100, 0, 100), seg(1, 0, 100))).toBe("degrades");
  });

  it("collapses when the edge over buy-and-hold disappears", () => {
    expect(verdictFor(seg(100, 0, 100), seg(5, 20, 100))).toBe("collapses");
  });

  it("collapses when a profitable in-sample run loses money out of sample", () => {
    expect(verdictFor(seg(50, 10, 100), seg(-10, 5, 43))).toBe("collapses");
  });

  it("with no in-sample edge, holds only when out of sample is no worse", () => {
    expect(verdictFor(seg(10, 30, 100), seg(10, 10, 100))).toBe("holds");
    expect(verdictFor(seg(10, 30, 100), seg(0, 30, 100))).toBe("degrades");
  });
});

// Mean reversion on a square wave: price sits at 100 for two bars, drops to 60
// for two bars, repeats. Buying under 70 and selling over 90 wins every cycle
// in both segments, while buy-and-hold goes nowhere.
const MEAN_REVERSION: Strategy = {
  name: "square wave dip buyer",
  asset: "TEST",
  market: "stock",
  timeframe: "1d",
  initialEquity: 10_000,
  indicators: [],
  entries: [{ side: "long", when: { op: "<", left: { price: "close" }, right: { const: 70 } } }],
  exits: [{ when: { op: ">", left: { price: "close" }, right: { const: 90 } } }],
  risk: { positionSizePct: 100, costs: { commissionBps: 0, slippageBps: 0, borrowRateAnnualPct: 0 } },
  allowShort: false,
};

const ALWAYS_LONG: Strategy = {
  name: "always long",
  asset: "TEST",
  market: "stock",
  timeframe: "1d",
  initialEquity: 10_000,
  indicators: [],
  entries: [{ side: "long", when: { op: ">", left: { price: "close" }, right: { const: 0 } } }],
  exits: [],
  risk: { positionSizePct: 100, costs: { commissionBps: 0, slippageBps: 0, borrowRateAnnualPct: 0 } },
  allowShort: false,
};

const SQUARE_WAVE: Bar[] = Array.from({ length: 100 }, (_, i) =>
  flatBar(i % 4 < 2 ? 100 : 60, i),
);

// Rises 100 -> 169 over the first 70 bars, then falls 167 -> 109.
const UP_THEN_DOWN: Bar[] = Array.from({ length: 100 }, (_, i) =>
  flatBar(i < 70 ? 100 + i : 169 - 2 * (i - 69), i),
);

describe("assessRobustness", () => {
  it("returns null when a segment would be too short to mean anything", () => {
    expect(assessRobustness(MEAN_REVERSION, [])).toBeNull();
    expect(assessRobustness(MEAN_REVERSION, SQUARE_WAVE.slice(0, 20))).toBeNull();
  });

  it("splits 70/30 and reports both segments", () => {
    const r = assessRobustness(MEAN_REVERSION, SQUARE_WAVE);
    expect(r).not.toBeNull();
    expect(r!.splitPct).toBe(70);
    expect(r!.inSample.bars).toBe(70);
    expect(r!.outOfSample.bars).toBe(30);
    expect(r!.inSample.trades).toBeGreaterThanOrEqual(5);
    expect(r!.outOfSample.trades).toBeGreaterThanOrEqual(1);
  });

  it("says holds when the edge persists out of sample", () => {
    const r = assessRobustness(MEAN_REVERSION, SQUARE_WAVE)!;
    expect(r.inSample.edgePerBarPct).toBeGreaterThan(0);
    expect(r.outOfSample.edgePerBarPct).toBeGreaterThan(0);
    expect(r.verdict).toBe("holds");
  });

  it("says collapses when the out-of-sample segment loses money", () => {
    const r = assessRobustness(ALWAYS_LONG, UP_THEN_DOWN)!;
    expect(r.inSample.totalReturnPct).toBeGreaterThan(0);
    expect(r.outOfSample.totalReturnPct).toBeLessThan(0);
    expect(r.verdict).toBe("collapses");
  });

  it("is deterministic", () => {
    const a = assessRobustness(MEAN_REVERSION, SQUARE_WAVE);
    const b = assessRobustness(MEAN_REVERSION, SQUARE_WAVE);
    expect(a).toEqual(b);
  });
});
