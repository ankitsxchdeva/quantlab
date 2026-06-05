import { describe, it, expect } from "vitest";
import type { Bar } from "../types";
import type { Strategy } from "../strategy/schema";
import { runBacktest } from "./engine";

function makeBars(closes: number[], startTime = 0, stepMs = 86_400_000): Bar[] {
  return closes.map((c, i) => ({
    time: startTime + i * stepMs,
    open: c,
    high: c * 1.01,
    low: c * 0.99,
    close: c,
    volume: 1000,
  }));
}

function baseStrategy(over: Partial<Strategy> = {}): Strategy {
  return {
    name: "test",
    asset: "TEST",
    timeframe: "1d",
    initialEquity: 10_000,
    indicators: [],
    entries: [],
    exits: [],
    risk: { positionSizePct: 100 },
    allowShort: false,
    ...over,
  } as Strategy;
}

describe("runBacktest - SMA crossover smoke test", () => {
  it("produces trades on a clear crossover signal", () => {
    const closes: number[] = [];
    for (let i = 0; i < 30; i++) closes.push(100 - i);
    for (let i = 0; i < 30; i++) closes.push(70 + i);
    const bars = makeBars(closes);

    const strategy = baseStrategy({
      indicators: [
        { id: "fast", type: "SMA", source: "close", period: 5 },
        { id: "slow", type: "SMA", source: "close", period: 20 },
      ],
      entries: [{ side: "long", when: { op: "crosses_above", left: "fast", right: "slow" } }],
      exits: [{ when: { op: "crosses_below", left: "fast", right: "slow" } }],
    });

    const res = runBacktest(strategy, bars);
    expect(res.trades.length).toBeGreaterThan(0);
    expect(res.equity.length).toBe(bars.length);
  });
});

describe("runBacktest - stop loss exits", () => {
  it("exits at stop loss level intrabar", () => {
    const closes = [100, 100, 100, 100, 100, 100, 90, 100];
    const bars = makeBars(closes);
    bars[6].low = 89;

    const strategy = baseStrategy({
      entries: [{ side: "long", when: { op: ">", left: { price: "close" }, right: { const: 0 } } }],
      risk: { positionSizePct: 100, stopLossPct: 5 },
    });

    const res = runBacktest(strategy, bars);
    const stopTrade = res.trades.find((t) => t.reason === "stop_loss");
    expect(stopTrade).toBeDefined();
    expect(stopTrade!.exitPrice).toBeCloseTo(95, 5);
  });
});

describe("runBacktest - take profit exits", () => {
  it("exits at take profit level intrabar", () => {
    const closes = [100, 100, 100, 100, 100, 100, 110, 110];
    const bars = makeBars(closes);
    bars[6].high = 115;

    const strategy = baseStrategy({
      entries: [{ side: "long", when: { op: ">", left: { price: "close" }, right: { const: 0 } } }],
      risk: { positionSizePct: 100, takeProfitPct: 5 },
    });

    const res = runBacktest(strategy, bars);
    const tpTrade = res.trades.find((t) => t.reason === "take_profit");
    expect(tpTrade).toBeDefined();
    expect(tpTrade!.exitPrice).toBeCloseTo(105, 5);
    expect(tpTrade!.pnl).toBeGreaterThan(0);
  });
});

describe("runBacktest - no trade when conditions never true", () => {
  it("produces zero trades and equity stays flat", () => {
    const bars = makeBars([100, 101, 102, 103, 104]);
    const strategy = baseStrategy({
      entries: [{ side: "long", when: { op: ">", left: { const: 0 }, right: { const: 1 } } }],
    });
    const res = runBacktest(strategy, bars);
    expect(res.trades.length).toBe(0);
    expect(res.equity[res.equity.length - 1].equity).toBe(10_000);
    expect(res.metrics.totalTrades).toBe(0);
    expect(res.metrics.totalReturnPct).toBe(0);
  });
});

describe("runBacktest - equity never goes negative", () => {
  it("survives extreme adverse move with stop loss", () => {
    const closes = [100, 100, 100, 50, 25, 10, 5, 1];
    const bars = makeBars(closes);
    const strategy = baseStrategy({
      entries: [{ side: "long", when: { op: ">", left: { price: "close" }, right: { const: 0 } } }],
      risk: { positionSizePct: 100, stopLossPct: 10 },
    });
    const res = runBacktest(strategy, bars);
    for (const pt of res.equity) {
      expect(pt.equity).toBeGreaterThanOrEqual(0);
    }
  });

  it("survives extreme adverse move without stop loss (long only)", () => {
    const closes = [100, 100, 50, 25, 10, 5, 2, 1];
    const bars = makeBars(closes);
    const strategy = baseStrategy({
      entries: [{ side: "long", when: { op: ">", left: { price: "close" }, right: { const: 0 } } }],
      risk: { positionSizePct: 100 },
    });
    const res = runBacktest(strategy, bars);
    for (const pt of res.equity) {
      expect(pt.equity).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("runBacktest - warnings", () => {
  it("warns on unknown indicator reference", () => {
    const bars = makeBars([1, 2, 3, 4, 5]);
    const strategy = baseStrategy({
      entries: [{ side: "long", when: { op: ">", left: { ref: "nonexistent" }, right: { const: 0 } } }],
    });
    const res = runBacktest(strategy, bars);
    expect(res.warnings.length).toBeGreaterThan(0);
    expect(res.trades.length).toBe(0);
  });
});

describe("runBacktest - short side", () => {
  it("ignores short entries when allowShort is false", () => {
    const bars = makeBars([100, 99, 98, 97, 96]);
    const strategy = baseStrategy({
      entries: [{ side: "short", when: { op: ">", left: { price: "close" }, right: { const: 0 } } }],
      allowShort: false,
    });
    const res = runBacktest(strategy, bars);
    expect(res.trades.length).toBe(0);
  });

  it("takes short trades when allowShort is true and profits on downside", () => {
    const bars = makeBars([100, 99, 98, 97, 96, 95]);
    const strategy = baseStrategy({
      entries: [{ side: "short", when: { op: ">", left: { price: "close" }, right: { const: 0 } } }],
      allowShort: true,
    });
    const res = runBacktest(strategy, bars);
    expect(res.trades.length).toBeGreaterThan(0);
    const finalEq = res.equity[res.equity.length - 1].equity;
    expect(finalEq).toBeGreaterThan(10_000);
  });
});
