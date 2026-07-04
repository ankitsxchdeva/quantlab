import { describe, it, expect } from "vitest";
import type { Bar } from "../types";
import { buyAndHold } from "./benchmark";

const MS_PER_YEAR = 365.25 * 86_400_000;

// Hand-computed fixture spanning exactly one year:
//   entry at bars[0].open = 100 with 10000 -> qty = 100
//   closes 110, 99, 121 -> equity 11000, 9900, 12100
//   drawdown: peak 11000, trough 9900 -> 1100/11000 = 10%
//   totalReturnPct = 12100/10000 - 1 = 21%
//   years = 1 -> cagrPct = 21%
const BARS: Bar[] = [
  { time: 0, open: 100, high: 112, low: 95, close: 110, volume: 1 },
  { time: MS_PER_YEAR / 2, open: 110, high: 111, low: 98, close: 99, volume: 1 },
  { time: MS_PER_YEAR, open: 99, high: 122, low: 99, close: 121, volume: 1 },
];

describe("buyAndHold", () => {
  const r = buyAndHold(BARS, 10_000, "Buy & hold TEST");

  it("enters at bars[0].open, not close", () => {
    // qty = 10000/100 = 100, so the first mark at close 110 is 11000.
    // Entering at close would give qty 10000/110 and a first mark of 10000.
    expect(r.equity[0].equity).toBeCloseTo(11_000, 10);
  });

  it("marks the equity curve at each close", () => {
    expect(r.equity.map((p) => p.equity)).toEqual([11_000, 9_900, 12_100]);
    expect(r.equity.map((p) => p.time)).toEqual(BARS.map((b) => b.time));
  });

  it("computes drawdown from the running peak", () => {
    expect(r.equity[0].drawdown).toBe(0);
    expect(r.equity[1].drawdown).toBeCloseTo(0.1, 10);
    expect(r.equity[2].drawdown).toBe(0);
    expect(r.maxDrawdownPct).toBeCloseTo(10, 10);
  });

  it("computes totalReturnPct and cagrPct", () => {
    expect(r.finalEquity).toBeCloseTo(12_100, 10);
    expect(r.totalReturnPct).toBeCloseTo(21, 10);
    expect(r.cagrPct).toBeCloseTo(21, 10);
  });

  it("carries the label through", () => {
    expect(r.label).toBe("Buy & hold TEST");
  });

  it("compounds CAGR over sub-year spans", () => {
    // Half a year at +10% total -> (1.1)^2 - 1 = 21% annualized.
    const bars: Bar[] = [
      { time: 0, open: 100, high: 101, low: 99, close: 100, volume: 1 },
      { time: MS_PER_YEAR / 2, open: 100, high: 111, low: 99, close: 110, volume: 1 },
    ];
    const half = buyAndHold(bars, 10_000);
    expect(half.totalReturnPct).toBeCloseTo(10, 10);
    expect(half.cagrPct).toBeCloseTo(21, 8);
  });

  it("returns a flat result for empty bars", () => {
    const empty = buyAndHold([], 10_000);
    expect(empty.finalEquity).toBe(10_000);
    expect(empty.totalReturnPct).toBe(0);
    expect(empty.cagrPct).toBe(0);
    expect(empty.maxDrawdownPct).toBe(0);
    expect(empty.equity).toEqual([]);
  });
});
