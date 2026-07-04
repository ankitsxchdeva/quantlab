import { describe, it, expect } from "vitest";
import type { Trade } from "../types";
import { runMonteCarlo } from "./montecarlo";

const MS_PER_DAY = 86_400_000;

function trade(pnlPct: number, i: number): Trade {
  return {
    side: "long",
    entryTime: i * 10 * MS_PER_DAY,
    entryPrice: 100,
    exitTime: (i * 10 + 5) * MS_PER_DAY,
    exitPrice: 100 * (1 + pnlPct / 100),
    qty: 1,
    pnl: pnlPct,
    pnlPct,
    reason: "signal",
  };
}

function trades(pnlPcts: number[]): Trade[] {
  return pnlPcts.map((p, i) => trade(p, i));
}

describe("runMonteCarlo", () => {
  it("returns null for an empty trade list", () => {
    expect(runMonteCarlo([], 10_000)).toBeNull();
  });

  it("is deterministic for a fixed seed", () => {
    const ts = trades([5, -3, 8, -2, 4, -6, 10]);
    const a = runMonteCarlo(ts, 10_000, { seed: 42 });
    const b = runMonteCarlo(ts, 10_000, { seed: 42 });
    expect(a).toEqual(b);
  });

  it("changes with the seed", () => {
    const ts = trades([5, -3, 8, -2, 4, -6, 10]);
    const a = runMonteCarlo(ts, 10_000, { seed: 1 });
    const b = runMonteCarlo(ts, 10_000, { seed: 2 });
    expect(a!.terminalEquity.p50).not.toBe(b!.terminalEquity.p50);
  });

  it("collapses to the exact compounded value when every trade is identical", () => {
    // Resampling a constant sequence is order-free: every path is
    // 10000 * 1.1^4, drawdown never occurs, and no path loses money.
    const ts = trades([10, 10, 10, 10]);
    const mc = runMonteCarlo(ts, 10_000, { runs: 200 })!;
    const exact = 10_000 * Math.pow(1.1, 4);
    for (const p of [mc.terminalEquity.p5, mc.terminalEquity.p50, mc.terminalEquity.p95]) {
      expect(p).toBeCloseTo(exact, 8);
    }
    expect(mc.maxDrawdownPct.p95).toBe(0);
    expect(mc.probLossPct).toBe(0);
  });

  it("reports certain loss when every trade loses", () => {
    const mc = runMonteCarlo(trades([-5, -2, -8, -1, -3]), 10_000, { runs: 200 })!;
    expect(mc.probLossPct).toBe(100);
    expect(mc.terminalEquity.p95).toBeLessThan(10_000);
    expect(mc.maxDrawdownPct.p5).toBeGreaterThan(0);
  });

  it("keeps percentiles ordered everywhere", () => {
    const mc = runMonteCarlo(trades([12, -7, 3, -1, 25, -14, 6, 2]), 10_000, { runs: 500 })!;
    const ordered = (b: { p5: number; p25: number; p50: number; p75: number; p95: number }) => {
      expect(b.p5).toBeLessThanOrEqual(b.p25);
      expect(b.p25).toBeLessThanOrEqual(b.p50);
      expect(b.p50).toBeLessThanOrEqual(b.p75);
      expect(b.p75).toBeLessThanOrEqual(b.p95);
    };
    ordered(mc.terminalEquity);
    ordered(mc.maxDrawdownPct);
    for (const point of mc.equityBands) ordered(point);
  });

  it("timestamps the fan to the original trade sequence", () => {
    const ts = trades([5, -3, 8]);
    const mc = runMonteCarlo(ts, 10_000)!;
    expect(mc.equityBands).toHaveLength(4);
    expect(mc.equityBands[0].time).toBe(ts[0].entryTime);
    expect(mc.equityBands[1].time).toBe(ts[0].exitTime);
    expect(mc.equityBands[3].time).toBe(ts[2].exitTime);
    // Step 0 is the starting stake in every run.
    expect(mc.equityBands[0].p5).toBe(10_000);
    expect(mc.equityBands[0].p95).toBe(10_000);
  });

  it("defaults to 1000 runs and records the trade count", () => {
    const mc = runMonteCarlo(trades([1, 2, 3, -1, -2]), 10_000)!;
    expect(mc.runs).toBe(1000);
    expect(mc.tradeCount).toBe(5);
  });
});
