import { describe, it, expect } from "vitest";
import type { Bar } from "../types";
import type { Risk, Strategy } from "../strategy/schema";
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

const ZERO_COSTS = { commissionBps: 0, slippageBps: 0, borrowRateAnnualPct: 0 };

type StrategyOverrides = Omit<Partial<Strategy>, "risk"> & { risk?: Partial<Risk> };

// Tests default to frictionless fills; costs are opted into per test.
function baseStrategy(over: StrategyOverrides = {}): Strategy {
  return {
    name: "test",
    asset: "TEST",
    timeframe: "1d",
    initialEquity: 10_000,
    indicators: [],
    entries: [],
    exits: [],
    allowShort: false,
    ...over,
    risk: { positionSizePct: 100, costs: ZERO_COSTS, ...over.risk },
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
    // Open above the stop so the bar trades through the level intrabar
    // (an open below the stop would be a gap-through fill at the open).
    bars[6].open = 98;
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
    // Open below the take so the bar trades through the level intrabar.
    bars[6].open = 103;
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

describe("runBacktest - warmup suppression", () => {
  it("does not let a not-condition fire while indicators are still null", () => {
    // Trap: sma[i] is null for i < 4, so "sma > 0" is false, so "not (sma > 0)"
    // is true and the strategy would enter at bar 0 with no indicator data.
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
    const bars = makeBars(closes);
    const strategy = baseStrategy({
      indicators: [{ id: "sma", type: "SMA", source: "close", period: 5 }],
      entries: [
        { side: "long", when: { op: "not", condition: { op: ">", left: "sma", right: { const: 0 } } } },
      ],
    });
    const res = runBacktest(strategy, bars);
    // Once warm, sma > 0 is always true on this series, so no entry may ever fire.
    expect(res.trades.length).toBe(0);
  });

  it("allows signals from the first bar where every indicator has a value", () => {
    const closes = Array.from({ length: 10 }, (_, i) => 100 + i);
    const bars = makeBars(closes);
    const strategy = baseStrategy({
      indicators: [{ id: "sma", type: "SMA", source: "close", period: 5 }],
      entries: [{ side: "long", when: { op: ">", left: "sma", right: { const: 0 } } }],
    });
    const res = runBacktest(strategy, bars);
    expect(res.trades.length).toBe(1);
    // warmupBars = 5, first non-null sma index = 4, fill at next bar open.
    expect(res.trades[0].entryTime).toBe(bars[5].time);
  });
});

describe("runBacktest - maxBarsInTrade time stop", () => {
  it("closes the position after maxBarsInTrade bars at next bar open", () => {
    const bars = makeBars(Array.from({ length: 10 }, () => 100));
    const strategy = baseStrategy({
      entries: [{ side: "long", when: { op: ">", left: { price: "close" }, right: { const: 0 } } }],
      risk: { positionSizePct: 100, maxBarsInTrade: 3 },
    });
    const res = runBacktest(strategy, bars);
    // Entry signals at bar 0, fills at bar 1; i - entryBarIdx reaches 3 at
    // bar 4, so the exit fills at bar 5's open.
    expect(res.trades.length).toBeGreaterThan(0);
    expect(res.trades[0].entryTime).toBe(bars[1].time);
    expect(res.trades[0].exitTime).toBe(bars[5].time);
    expect(res.trades[0].reason).toBe("signal");
  });
});

describe("runBacktest - exit signal fill price", () => {
  it("fills exit signals at the NEXT bar's open, not the signal bar's close", () => {
    const closes = [100, 101, 102, 103, 104, 105];
    const bars: Bar[] = closes.map((c, i) => ({
      time: i * 86_400_000,
      open: c + 0.5,
      high: c + 2,
      low: c - 2,
      close: c,
      volume: 1000,
    }));
    const strategy = baseStrategy({
      entries: [{ side: "long", when: { op: "==", left: { price: "close" }, right: { const: 100 } } }],
      exits: [{ when: { op: ">=", left: { price: "close" }, right: { const: 103 } } }],
    });
    const res = runBacktest(strategy, bars);
    expect(res.trades.length).toBe(1);
    const t = res.trades[0];
    // Entry signals at bar 0 (close 100), fills at bar 1 open.
    expect(t.entryTime).toBe(bars[1].time);
    expect(t.entryPrice).toBe(bars[1].open);
    // Exit signals at bar 3 (close 103), fills at bar 4 open.
    expect(t.exitTime).toBe(bars[4].time);
    expect(t.exitPrice).toBe(bars[4].open);
    expect(t.reason).toBe("signal");
  });
});

function collectSerializationOffenders(value: unknown, path: string, out: string[]): void {
  if (value === undefined) {
    out.push(`${path} is undefined`);
    return;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    out.push(`${path} is ${value}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => collectSerializationOffenders(v, `${path}[${i}]`, out));
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      collectSerializationOffenders(v, `${path}.${k}`, out);
    }
  }
}

describe("runBacktest - serialization boundary", () => {
  it("a full BacktestResult survives JSON round-trip with no undefined/Infinity/NaN", () => {
    // One winning trade and zero losers: grossLoss is 0, which used to
    // produce profitFactor = Infinity (silently null on the wire).
    const closes = [100, 101, 102, 110, 111, 112];
    const bars = makeBars(closes);
    const strategy = baseStrategy({
      entries: [{ side: "long", when: { op: "==", left: { price: "close" }, right: { const: 100 } } }],
      risk: { positionSizePct: 100, takeProfitPct: 5 },
    });
    const res = runBacktest(strategy, bars);
    expect(res.trades.length).toBe(1);
    expect(res.trades[0].pnl).toBeGreaterThan(0);
    expect(res.metrics.profitFactor).toBeNull();

    const offenders: string[] = [];
    collectSerializationOffenders(res, "result", offenders);
    expect(offenders).toEqual([]);

    expect(JSON.parse(JSON.stringify(res))).toEqual(res);
  });
});

describe("runBacktest - gap-through fills", () => {
  it("fills at the open when a bar gaps down through a long stop", () => {
    // Entry fills at bar 1 open (100), stop at 95; bar 3 opens at 80, far
    // below the stop, so the fill must be the open, not the level.
    const closes = [100, 100, 100, 80, 80];
    const bars = makeBars(closes);
    const strategy = baseStrategy({
      entries: [{ side: "long", when: { op: "==", left: { price: "close" }, right: { const: 100 } } }],
      risk: { stopLossPct: 5 },
    });
    const res = runBacktest(strategy, bars);
    expect(res.trades.length).toBe(1);
    expect(res.trades[0].reason).toBe("stop_loss");
    expect(res.trades[0].exitPrice).toBe(80);
    expect(res.trades[0].exitTime).toBe(bars[3].time);
  });

  it("fills at the open when a bar gaps up through a long take profit", () => {
    const closes = [100, 100, 100, 120, 120];
    const bars = makeBars(closes);
    const strategy = baseStrategy({
      entries: [{ side: "long", when: { op: "==", left: { price: "close" }, right: { const: 100 } } }],
      risk: { takeProfitPct: 5 },
    });
    const res = runBacktest(strategy, bars);
    expect(res.trades.length).toBe(1);
    expect(res.trades[0].reason).toBe("take_profit");
    expect(res.trades[0].exitPrice).toBe(120);
  });
});

describe("runBacktest - short-side stop and take fills", () => {
  // One-shot trigger: only bars closing at exactly 100 signal an entry, so
  // the strategy cannot re-enter after the stop/take fires.
  const shortEntry = { side: "short" as const, when: { op: "==" as const, left: { price: "close" as const }, right: { const: 100 } } };

  it("fills a short stop at the level when the bar trades through it", () => {
    // Short entry at 100, stop at 105; bar 3 opens at 104 and its high
    // (105.04) crosses the level intrabar.
    const closes = [100, 100, 100, 104, 104];
    const bars = makeBars(closes);
    const strategy = baseStrategy({
      entries: [shortEntry],
      risk: { stopLossPct: 5 },
      allowShort: true,
    });
    const res = runBacktest(strategy, bars);
    expect(res.trades.length).toBe(1);
    expect(res.trades[0].reason).toBe("stop_loss");
    expect(res.trades[0].exitPrice).toBeCloseTo(105, 10);
    expect(res.trades[0].pnl).toBeLessThan(0);
  });

  it("fills a short stop at the open when the bar gaps up through it", () => {
    const closes = [100, 100, 100, 112, 112];
    const bars = makeBars(closes);
    const strategy = baseStrategy({
      entries: [shortEntry],
      risk: { stopLossPct: 5 },
      allowShort: true,
    });
    const res = runBacktest(strategy, bars);
    expect(res.trades.length).toBe(1);
    expect(res.trades[0].reason).toBe("stop_loss");
    expect(res.trades[0].exitPrice).toBe(112);
  });

  it("fills a short take profit at the level when the bar trades through it", () => {
    // Take at 95; bar 3 opens at 95.5 and its low (94.545) crosses the level.
    const closes = [100, 100, 100, 95.5, 95.5];
    const bars = makeBars(closes);
    const strategy = baseStrategy({
      entries: [shortEntry],
      risk: { takeProfitPct: 5 },
      allowShort: true,
    });
    const res = runBacktest(strategy, bars);
    expect(res.trades.length).toBe(1);
    expect(res.trades[0].reason).toBe("take_profit");
    expect(res.trades[0].exitPrice).toBeCloseTo(95, 10);
    expect(res.trades[0].pnl).toBeGreaterThan(0);
  });

  it("fills a short take profit at the open when the bar gaps down through it", () => {
    const closes = [100, 100, 100, 88, 88];
    const bars = makeBars(closes);
    const strategy = baseStrategy({
      entries: [shortEntry],
      risk: { takeProfitPct: 5 },
      allowShort: true,
    });
    const res = runBacktest(strategy, bars);
    expect(res.trades.length).toBe(1);
    expect(res.trades[0].reason).toBe("take_profit");
    expect(res.trades[0].exitPrice).toBe(88);
  });
});

describe("runBacktest - same-bar stop and take conflict", () => {
  it("resolves to the stop (conservative convention)", () => {
    // Entry triggers only on bar 0 (close 101), fills at bar 1 open (100).
    const closes = [101, 100, 100, 100, 100];
    const bars = makeBars(closes);
    bars[1].open = 100;
    bars[3].low = 94;
    bars[3].high = 106;
    const strategy = baseStrategy({
      entries: [{ side: "long", when: { op: "==", left: { price: "close" }, right: { const: 101 } } }],
      risk: { stopLossPct: 5, takeProfitPct: 5 },
    });
    const res = runBacktest(strategy, bars);
    expect(res.trades.length).toBe(1);
    expect(res.trades[0].reason).toBe("stop_loss");
    expect(res.trades[0].exitPrice).toBeCloseTo(95, 10);
  });
});

describe("runBacktest - cost drag on a hand-computed trade", () => {
  // Entry signals at bar 0 (close == 100), fills at bar 1 open (100); exit
  // signals at bar 2 (close >= 110), fills at bar 3 open (110).
  const closes = [100, 100, 110, 110, 110];
  const strategyWith = (costs: Risk["costs"]): Strategy =>
    baseStrategy({
      entries: [{ side: "long", when: { op: "==", left: { price: "close" }, right: { const: 100 } } }],
      exits: [{ when: { op: ">=", left: { price: "close" }, right: { const: 110 } } }],
      risk: { costs },
    });

  it("matches hand-computed slippage and commission on every fill", () => {
    const bars = makeBars(closes);
    // 100 bps slippage (1%), 10 bps commission (0.1%) for round numbers.
    const res = runBacktest(strategyWith({ commissionBps: 10, slippageBps: 100, borrowRateAnnualPct: 0 }), bars);

    const slip = 0.01;
    const cr = 0.001;
    const entryFill = 100 * (1 + slip); // 101, long entry fills higher
    const qty = 10_000 / (entryFill * (1 + cr)); // sized so notional + commission = budget
    const entryCommission = qty * entryFill * cr;
    const exitFill = 110 * (1 - slip); // 108.9, long exit fills lower
    const exitCommission = qty * exitFill * cr;
    const expectedPnl = qty * (exitFill - entryFill) - entryCommission - exitCommission;
    const expectedCosts = qty * 100 * slip + qty * 110 * slip + entryCommission + exitCommission;

    expect(res.trades.length).toBe(1);
    const t = res.trades[0];
    expect(t.entryPrice).toBeCloseTo(entryFill, 10);
    expect(t.exitPrice).toBeCloseTo(exitFill, 10);
    expect(t.pnl).toBeCloseTo(expectedPnl, 8);
    expect(t.pnlPct).toBeCloseTo((expectedPnl / (qty * entryFill)) * 100, 8);
    expect(res.metrics.finalEquity).toBeCloseTo(10_000 + expectedPnl, 8);
    expect(res.metrics.totalCosts).toBeCloseTo(expectedCosts, 8);
    expect(res.metrics.grossTotalReturnPct).toBeCloseTo(
      ((10_000 + expectedPnl + expectedCosts) / 10_000 - 1) * 100,
      8,
    );
  });

  it("nets less than the frictionless run of the same strategy", () => {
    const withCosts = runBacktest(
      strategyWith({ commissionBps: 10, slippageBps: 100, borrowRateAnnualPct: 0 }),
      makeBars(closes),
    );
    const frictionless = runBacktest(strategyWith(ZERO_COSTS), makeBars(closes));
    expect(frictionless.metrics.finalEquity).toBeCloseTo(11_000, 10);
    expect(frictionless.metrics.totalCosts).toBe(0);
    expect(withCosts.metrics.finalEquity).toBeLessThan(frictionless.metrics.finalEquity);
  });
});

describe("runBacktest - borrow cost on a multi-bar short", () => {
  it("accrues borrow on entry notional per bar held short", () => {
    // Flat series: entry fills at bar 1 open (100), forced close at bar 5
    // close (100). 252% annual on a 1d timeframe is exactly 1% of entry
    // notional per bar; the short is open for bars 1 through 5 = 5 bars.
    const bars = makeBars([100, 100, 100, 100, 100, 100]);
    const strategy = baseStrategy({
      entries: [{ side: "short", when: { op: "==", left: { price: "close" }, right: { const: 100 } } }],
      risk: { costs: { commissionBps: 0, slippageBps: 0, borrowRateAnnualPct: 252 } },
      allowShort: true,
    });
    const res = runBacktest(strategy, bars);
    expect(res.trades.length).toBe(1);
    expect(res.trades[0].pnl).toBeCloseTo(-500, 8);
    expect(res.metrics.finalEquity).toBeCloseTo(9_500, 8);
    expect(res.metrics.totalCosts).toBeCloseTo(500, 8);
  });

  it("charges no borrow on the equivalent long", () => {
    const bars = makeBars([100, 100, 100, 100, 100, 100]);
    const strategy = baseStrategy({
      entries: [{ side: "long", when: { op: "==", left: { price: "close" }, right: { const: 100 } } }],
      risk: { costs: { commissionBps: 0, slippageBps: 0, borrowRateAnnualPct: 252 } },
    });
    const res = runBacktest(strategy, bars);
    expect(res.metrics.finalEquity).toBeCloseTo(10_000, 8);
    expect(res.metrics.totalCosts).toBe(0);
  });
});

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

function syntheticBars(days: number): Bar[] {
  const rand = mulberry32(0xbeefcafe);
  const gaussian = (): number => {
    const u = Math.max(rand(), 1e-9);
    const v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const bars: Bar[] = [];
  let price = 100;
  const mu = 0.12 / 252;
  const sigma = 0.28 / Math.sqrt(252);
  for (let i = 0; i < days; i++) {
    const open = price;
    const close = Math.max(0.5, open * Math.exp(mu + sigma * gaussian()));
    const range = open * Math.abs(sigma * 1.5 * (0.6 + rand() * 0.8));
    bars.push({
      time: i * 86_400_000,
      open,
      high: Math.max(open, close) + range * 0.5,
      low: Math.min(open, close) - range * 0.5,
      close,
      volume: 1_000_000,
    });
    price = close;
  }
  return bars;
}

describe("runBacktest - default costs drag on a seeded synthetic series", () => {
  it("default 5 bps slippage measurably lowers net return vs frictionless", () => {
    const bars = syntheticBars(6 * 252);
    const strategyWith = (costs: Risk["costs"]): Strategy =>
      baseStrategy({
        indicators: [
          { id: "fast", type: "SMA", source: "close", period: 20 },
          { id: "slow", type: "SMA", source: "close", period: 50 },
        ],
        entries: [{ side: "long", when: { op: "crosses_above", left: "fast", right: "slow" } }],
        exits: [{ when: { op: "crosses_below", left: "fast", right: "slow" } }],
        risk: { costs },
      });
    const off = runBacktest(strategyWith(ZERO_COSTS), bars);
    // Schema defaults: 0 commission, 5 bps slippage, 0 borrow.
    const on = runBacktest(strategyWith({ commissionBps: 0, slippageBps: 5, borrowRateAnnualPct: 0 }), bars);

    expect(off.trades.length).toBeGreaterThan(3);
    expect(on.trades.length).toBe(off.trades.length);
    expect(on.metrics.totalCosts).toBeGreaterThan(0);
    expect(on.metrics.totalReturnPct).toBeLessThan(off.metrics.totalReturnPct);
    // Gross adds costs back, so it must sit at or above net.
    expect(on.metrics.grossTotalReturnPct).toBeGreaterThan(on.metrics.totalReturnPct);
    expect(off.metrics.grossTotalReturnPct).toBeCloseTo(off.metrics.totalReturnPct, 10);
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

// A fill scheduled for bar i+1's open must not be marked into bar i's equity.
// Marking it there fabricated drawdowns the account never took and hid losses
// it did take, and every equity-derived metric (max drawdown, Sharpe, Sortino)
// inherited the error.
describe("runBacktest - equity marks only what was actually held", () => {
  function gapBars(rows: [number, number, number, number][]): Bar[] {
    return rows.map(([o, h, l, c], i) => ({
      time: i * 86_400_000,
      open: o,
      high: h,
      low: l,
      close: c,
      volume: 1000,
    }));
  }

  const alwaysIn = baseStrategy({
    entries: [{ side: "long", when: { op: ">", left: { price: "close" }, right: 0 } }],
    exits: [],
  });

  it("reports no drawdown for a bar the account was flat through", () => {
    // Entry signal fires on bar 0; the fill is bar 1's open, which gaps up 50%.
    // Bar 0 must still mark at a flat 10,000 -- nothing was owned during it.
    const bars = gapBars([
      [100, 100, 100, 100],
      [150, 150, 150, 150],
      [150, 150, 150, 150],
    ]);
    const r = runBacktest(alwaysIn, bars);

    expect(r.equity[0].equity).toBeCloseTo(10_000, 6);
    expect(r.equity[0].drawdown).toBeCloseTo(0, 9);
    expect(r.metrics.maxDrawdownPct).toBeCloseTo(0, 6);
  });

  it("does not credit a gap that happened before the position was opened", () => {
    // Symmetric case: a gap DOWN before entry must not show as a profit.
    const bars = gapBars([
      [100, 100, 100, 100],
      [50, 50, 50, 50],
      [50, 50, 50, 50],
    ]);
    const r = runBacktest(alwaysIn, bars);
    expect(r.equity[0].equity).toBeCloseTo(10_000, 6);
    for (const pt of r.equity) expect(pt.equity).toBeCloseTo(10_000, 6);
  });

  it("shows a gapped exit loss on the bar it is realized, not a bar early", () => {
    // Long from bar 1's open at 100. Exit signal on bar 1 -> fills at bar 2's
    // open of 50. Bar 1 still held the position at its close of 100, so it
    // marks 10,000; the loss lands on bar 2.
    const strat = baseStrategy({
      entries: [{ side: "long", when: { op: "==", left: { price: "close" }, right: 100 } }],
      exits: [{ when: { op: "==", left: { price: "open" }, right: 100 } }],
    });
    const bars = gapBars([
      [100, 100, 100, 100],
      [100, 100, 100, 100],
      [50, 50, 50, 50],
      [50, 50, 50, 50],
    ]);
    const r = runBacktest(strat, bars);

    expect(r.equity[0].equity).toBeCloseTo(10_000, 6);
    expect(r.equity[1].equity).toBeCloseTo(10_000, 6);
    expect(r.equity[2].equity).toBeCloseTo(5_000, 6);
  });

  it("keeps equity consistent with cash once every position is closed", () => {
    const bars = gapBars([
      [100, 100, 100, 100],
      [150, 150, 150, 150],
      [90, 90, 90, 90],
    ]);
    const r = runBacktest(alwaysIn, bars);
    const last = r.equity[r.equity.length - 1];
    expect(last.equity).toBeCloseTo(r.metrics.finalEquity, 6);
  });
});
