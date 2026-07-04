import { describe, it, expect } from "vitest";
import type { EquityPoint, Trade } from "../types";
import { computeMetrics } from "./metrics";

const MS_PER_DAY = 86_400_000;

function trade(pnl: number, pnlPct: number): Trade {
  return {
    side: "long",
    entryTime: 0,
    entryPrice: 100,
    exitTime: MS_PER_DAY,
    exitPrice: 100,
    qty: 1,
    pnl,
    pnlPct,
    reason: "signal",
  };
}

// Reference fixture, all expectations hand-computed:
//
// Equity: 1000 -> 1100 -> 990 -> 1089 at days 0, 100, 200, 365.
//   Per-bar returns: +0.1, -0.1, +0.1
//   mean r          = 0.1/3            = 0.0333333...
//   population sd   : deviations 1/15, -2/15, 1/15
//                     sum sq = 6/225, /3 = 2/225, sqrt = sqrt(2)/15 = 0.0942809...
//   Sharpe (1d)     = (1/30) / (sqrt(2)/15) * sqrt(252)
//                   = sqrt(252) / (2*sqrt(2)) = sqrt(126)/2 = 5.6124861...
//   Downside dev    = sqrt((0 + 0.01 + 0) / 3) = sqrt(1/300) = 0.0577350...
//   Sortino (1d)    = (1/30) / sqrt(1/300) * sqrt(252)
//                   = sqrt(75600)/30 = 9.1651514...
//   totalReturnPct  = 1089/1000 - 1 = 8.9%
//   cagrPct         = (1.089)^(365/365) - 1 = 8.9% (span is exactly 365 days)
//   maxDrawdownPct  : peak 1100, trough 990 -> 110/1100 = 10%
//
// Trades: +100 (+10%), -50 (-5%), +25 (+2.5%)
//   winRatePct    = 2/3 = 66.666...%
//   profitFactor  = 125 / 50 = 2.5
//   avgTradePct   = (10 - 5 + 2.5)/3 = 2.5
//   avgWinPct     = (10 + 2.5)/2 = 6.25
//   avgLossPct    = -5
//   best/worst    = 10 / -5
//
// barsInMarket 2 of totalBars 4 -> exposurePct 50.
const EQUITY: EquityPoint[] = [
  { time: 0, equity: 1000, drawdown: 0 },
  { time: 100 * MS_PER_DAY, equity: 1100, drawdown: 0 },
  { time: 200 * MS_PER_DAY, equity: 990, drawdown: 0.1 },
  { time: 365 * MS_PER_DAY, equity: 1089, drawdown: 0.01 },
];
const TRADES: Trade[] = [trade(100, 10), trade(-50, -5), trade(25, 2.5)];

describe("computeMetrics - reference values", () => {
  const m = computeMetrics(EQUITY, TRADES, 1000, 2, 4, "1d");

  it("equity metrics", () => {
    expect(m.initialEquity).toBe(1000);
    expect(m.finalEquity).toBe(1089);
    expect(m.totalReturnPct).toBeCloseTo(8.9, 10);
    expect(m.cagrPct).toBeCloseTo(8.9, 10);
    expect(m.maxDrawdownPct).toBeCloseTo(10, 10);
  });

  it("sharpe", () => {
    expect(m.sharpe).toBeCloseTo(Math.sqrt(126) / 2, 10);
    expect(m.sharpe).toBeCloseTo(5.6124861, 6);
  });

  it("sortino uses full-count downside deviation", () => {
    expect(m.sortino).toBeCloseTo(Math.sqrt(75600) / 30, 10);
    expect(m.sortino).toBeCloseTo(9.1651514, 6);
    // The old (wrong) variant divided by the stddev of only the negative
    // returns; with a single negative return that stddev is 0 -> sortino 0.
    expect(m.sortino).not.toBe(0);
  });

  it("trade metrics", () => {
    expect(m.totalTrades).toBe(3);
    expect(m.winRatePct).toBeCloseTo(200 / 3, 10);
    expect(m.profitFactor).toBeCloseTo(2.5, 10);
    expect(m.avgTradePct).toBeCloseTo(2.5, 10);
    expect(m.avgWinPct).toBeCloseTo(6.25, 10);
    expect(m.avgLossPct).toBeCloseTo(-5, 10);
    expect(m.bestTradePct).toBe(10);
    expect(m.worstTradePct).toBe(-5);
    expect(m.exposurePct).toBe(50);
  });
});

describe("computeMetrics - timeframe annualization", () => {
  it("scales Sharpe/Sortino by sqrt(bars per year) for the timeframe", () => {
    // 1h uses 252 * 6.5 = 1638 bars/year vs 252 for 1d, so both ratios
    // must equal sqrt(1638/252) = sqrt(6.5).
    const daily = computeMetrics(EQUITY, TRADES, 1000, 2, 4, "1d");
    const hourly = computeMetrics(EQUITY, TRADES, 1000, 2, 4, "1h");
    expect(hourly.sharpe / daily.sharpe).toBeCloseTo(Math.sqrt(6.5), 10);
    expect(hourly.sortino / daily.sortino).toBeCloseTo(Math.sqrt(6.5), 10);
  });

  it("keeps CAGR calendar-day based regardless of timeframe", () => {
    const daily = computeMetrics(EQUITY, TRADES, 1000, 2, 4, "1d");
    const minute = computeMetrics(EQUITY, TRADES, 1000, 2, 4, "1m");
    expect(minute.cagrPct).toBe(daily.cagrPct);
  });
});

describe("computeMetrics - profitFactor null sentinel", () => {
  it("returns null when there are no losing trades", () => {
    const m = computeMetrics(EQUITY, [trade(100, 10), trade(25, 2.5)], 1000, 2, 4, "1d");
    expect(m.profitFactor).toBeNull();
  });

  it("returns null when there are no trades", () => {
    const m = computeMetrics(EQUITY, [], 1000, 0, 4, "1d");
    expect(m.profitFactor).toBeNull();
    expect(m.winRatePct).toBe(0);
    expect(m.totalTrades).toBe(0);
  });
});

describe("computeMetrics - degenerate inputs", () => {
  it("flat equity gives zero sharpe and sortino", () => {
    const eq: EquityPoint[] = [0, 1, 2, 3].map((d) => ({
      time: d * MS_PER_DAY,
      equity: 1000,
      drawdown: 0,
    }));
    const m = computeMetrics(eq, [], 1000, 0, 4, "1d");
    expect(m.sharpe).toBe(0);
    expect(m.sortino).toBe(0);
    expect(m.totalReturnPct).toBe(0);
    expect(m.maxDrawdownPct).toBe(0);
  });

  it("all-positive returns give zero sortino (downside deviation is 0)", () => {
    const eq: EquityPoint[] = [
      { time: 0, equity: 1000, drawdown: 0 },
      { time: MS_PER_DAY, equity: 1100, drawdown: 0 },
      { time: 2 * MS_PER_DAY, equity: 1210, drawdown: 0 },
    ];
    const m = computeMetrics(eq, [], 1000, 0, 3, "1d");
    expect(m.sortino).toBe(0);
  });

  it("empty equity returns finite zeros", () => {
    const m = computeMetrics([], [], 1000, 0, 0, "1d");
    expect(m.finalEquity).toBe(1000);
    expect(m.totalReturnPct).toBe(0);
    expect(m.cagrPct).toBe(0);
    expect(m.exposurePct).toBe(0);
  });
});
