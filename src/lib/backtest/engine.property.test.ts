import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { Bar } from "../types";
import { StrategySchema, type Strategy } from "../strategy/schema";
import { runBacktest } from "./engine";

const DAY_MS = 86_400_000;
// Bounded so the suite stays fast; override for deeper local runs, e.g.
// FC_NUM_RUNS=2000 npx vitest run src/lib/backtest/engine.property.test.ts
const NUM_RUNS = Number(process.env.FC_NUM_RUNS ?? 120);
const PRICE_SOURCES = ["open", "high", "low", "close", "volume", "hl2", "hlc3", "ohlc4"] as const;

// Valid OHLC series: positive prices, high >= max(open, close),
// low <= min(open, close), strictly ascending times.
function barSeriesArb(minBars: number, maxBars: number): fc.Arbitrary<Bar[]> {
  const moveArb = fc.record({
    ret: fc.double({ min: -0.15, max: 0.15, noNaN: true }),
    gap: fc.double({ min: -0.08, max: 0.08, noNaN: true }),
    hi: fc.double({ min: 0, max: 0.08, noNaN: true }),
    lo: fc.double({ min: 0, max: 0.08, noNaN: true }),
  });
  return fc
    .record({
      start: fc.double({ min: 5, max: 500, noNaN: true }),
      moves: fc.array(moveArb, { minLength: minBars, maxLength: maxBars }),
    })
    .map(({ start, moves }) => {
      const bars: Bar[] = [];
      let prevClose = start;
      for (let i = 0; i < moves.length; i++) {
        const m = moves[i];
        const open = Math.max(0.01, prevClose * (1 + m.gap));
        const close = Math.max(0.01, open * (1 + m.ret));
        const high = Math.max(open, close) * (1 + m.hi);
        const low = Math.min(open, close) * (1 - m.lo);
        bars.push({ time: i * DAY_MS, open, high, low, close, volume: 1_000 + i });
        prevClose = close;
      }
      return bars;
    });
}

const indicatorSpecArb = fc.oneof(
  fc.record({ type: fc.constant("SMA"), source: fc.constantFrom(...PRICE_SOURCES), period: fc.integer({ min: 2, max: 8 }) }),
  fc.record({ type: fc.constant("EMA"), source: fc.constantFrom(...PRICE_SOURCES), period: fc.integer({ min: 2, max: 8 }) }),
  fc.record({ type: fc.constant("RSI"), source: fc.constantFrom(...PRICE_SOURCES), period: fc.integer({ min: 2, max: 6 }) }),
);

// Raw (unparsed) operand trees mirroring OperandSchema, including bare-string
// indicator ids and price sources, which evaluate.ts resolves in that order.
function operandArb(ids: string[]): fc.Arbitrary<unknown> {
  const leaves: fc.Arbitrary<unknown>[] = [
    fc.record({ price: fc.constantFrom(...PRICE_SOURCES) }),
    fc.record({ const: fc.double({ min: 0, max: 300, noNaN: true }) }),
    fc.double({ min: 0, max: 300, noNaN: true }),
    fc.constantFrom<string>(...PRICE_SOURCES),
  ];
  if (ids.length > 0) {
    leaves.push(fc.constantFrom(...ids).map((ref) => ({ ref })));
    leaves.push(fc.constantFrom(...ids));
  }
  const leaf = fc.oneof(...leaves);
  const arith = fc.record({
    op: fc.constantFrom("+", "-", "*", "/"),
    left: leaf,
    right: leaf,
  });
  return fc.oneof({ arbitrary: leaf, weight: 4 }, { arbitrary: arith, weight: 1 });
}

function conditionArb(ids: string[], depth: number): fc.Arbitrary<unknown> {
  const opnd = operandArb(ids);
  const cmp = fc.record({
    op: fc.constantFrom(">", ">=", "<", "<=", "crosses_above", "crosses_below"),
    left: opnd,
    right: opnd,
  });
  // Bias toward a condition that always fires so trades are common.
  const alwaysTrue = fc.constant({ op: ">", left: { price: "close" }, right: { const: 0 } });
  const base = fc.oneof({ arbitrary: cmp, weight: 3 }, { arbitrary: alwaysTrue, weight: 1 });
  if (depth <= 0) return base;
  const sub = conditionArb(ids, depth - 1);
  return fc.oneof(
    { arbitrary: base, weight: 5 },
    { arbitrary: fc.array(sub, { minLength: 1, maxLength: 2 }).map((conditions) => ({ op: "and", conditions })), weight: 1 },
    { arbitrary: fc.array(sub, { minLength: 1, maxLength: 2 }).map((conditions) => ({ op: "or", conditions })), weight: 1 },
    { arbitrary: sub.map((condition) => ({ op: "not", condition })), weight: 1 },
  );
}

const ZERO_COSTS = { commissionBps: 0, slippageBps: 0, borrowRateAnnualPct: 0 };

interface StrategyArbOpts {
  longOnly?: boolean;
  zeroCosts?: boolean;
}

// Random strategies parsed through the real StrategySchema so defaults and
// validation stay the source of truth.
function strategyArb(opts: StrategyArbOpts = {}): fc.Arbitrary<Strategy> {
  return fc.array(indicatorSpecArb, { maxLength: 2 }).chain((specs) => {
    const indicators = specs.map((s, i) => ({ ...s, id: `ind${i}` }));
    const ids = indicators.map((ind) => ind.id);
    const costsArb = opts.zeroCosts
      ? fc.constant(ZERO_COSTS)
      : fc.record({
          commissionBps: fc.constantFrom(0, 5, 25),
          slippageBps: fc.constantFrom(0, 5, 50),
          borrowRateAnnualPct: fc.constantFrom(0, 10, 100),
        });
    return fc
      .record({
        side: opts.longOnly ? fc.constant("long") : fc.constantFrom("long", "short"),
        entryWhen: conditionArb(ids, 1),
        exitWhen: fc.option(conditionArb(ids, 1), { nil: undefined }),
        positionSizePct: fc.constantFrom(10, 25, 50, 100),
        stopLossPct: fc.option(fc.double({ min: 1, max: 20, noNaN: true }), { nil: undefined }),
        takeProfitPct: fc.option(fc.double({ min: 1, max: 30, noNaN: true }), { nil: undefined }),
        maxBarsInTrade: fc.option(fc.integer({ min: 1, max: 8 }), { nil: undefined }),
        costs: costsArb,
      })
      .map((cfg) =>
        StrategySchema.parse({
          name: "property",
          asset: "PROP",
          timeframe: "1d",
          initialEquity: 10_000,
          indicators,
          entries: [{ side: cfg.side, when: cfg.entryWhen }],
          exits: cfg.exitWhen === undefined ? [] : [{ when: cfg.exitWhen }],
          risk: {
            positionSizePct: cfg.positionSizePct,
            stopLossPct: cfg.stopLossPct,
            takeProfitPct: cfg.takeProfitPct,
            maxBarsInTrade: cfg.maxBarsInTrade,
            costs: cfg.costs,
          },
          allowShort: cfg.side === "short",
        }),
      );
  });
}

// Slippage moves fills against the trader: long entry / short exit fill
// higher, long exit / short entry fill lower. Gap fills land at the open
// (plus slippage), which still sits inside the bar's range.
function assertFillInRange(
  bar: Bar | undefined,
  side: "long" | "short",
  kind: "entry" | "exit",
  fill: number,
  slip: number,
): void {
  expect(bar, `no bar found for ${kind} fill at ${fill}`).toBeDefined();
  const b = bar as Bar;
  const up = (side === "long") === (kind === "entry");
  const f = up ? 1 + slip : 1 - slip;
  const eps = 1e-9 * Math.max(1, b.high * f);
  expect(fill).toBeGreaterThanOrEqual(b.low * f - eps);
  expect(fill).toBeLessThanOrEqual(b.high * f + eps);
}

function collectOffenders(value: unknown, path: string, out: string[]): void {
  if (value === undefined) {
    out.push(`${path} is undefined`);
    return;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    out.push(`${path} is ${value}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => collectOffenders(v, `${path}[${i}]`, out));
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      collectOffenders(v, `${path}.${k}`, out);
    }
  }
}

// Structural deep-compare using === on primitives (so +0 / -0 do not produce
// spurious diffs the way Object.is-based toEqual would).
function collectRoundTripDiffs(a: unknown, b: unknown, path: string, out: string[]): void {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      out.push(`${path}: array shape changed`);
      return;
    }
    for (let i = 0; i < a.length; i++) collectRoundTripDiffs(a[i], b[i], `${path}[${i}]`, out);
    return;
  }
  if (a !== null && typeof a === "object") {
    if (b === null || typeof b !== "object") {
      out.push(`${path}: object became ${String(b)}`);
      return;
    }
    const recA = a as Record<string, unknown>;
    const recB = b as Record<string, unknown>;
    const keysA = Object.keys(recA);
    if (keysA.length !== Object.keys(recB).length) out.push(`${path}: key set changed`);
    for (const k of keysA) collectRoundTripDiffs(recA[k], recB[k], `${path}.${k}`, out);
    return;
  }
  if (a !== b) out.push(`${path}: ${String(a)} became ${String(b)}`);
}

describe("engine properties", () => {
  it("no lookahead: truncating future bars never changes already-closed trades", () => {
    fc.assert(
      fc.property(barSeriesArb(10, 50), strategyArb(), fc.nat(1_000_000), (bars, strategy, cutSeed) => {
        // Truncated length in [5, bars.length - 1].
        const cut = 5 + (cutSeed % (bars.length - 5));
        const full = runBacktest(strategy, bars);
        const trunc = runBacktest(strategy, bars.slice(0, cut));
        // end_of_data trades are the truncated run's forced closes; every
        // other truncated trade must appear identically in the full run.
        const closed = trunc.trades.filter((t) => t.reason !== "end_of_data");
        expect(full.trades.slice(0, closed.length)).toEqual(closed);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("long-only equity with zero costs never goes negative", () => {
    fc.assert(
      fc.property(barSeriesArb(8, 60), strategyArb({ longOnly: true, zeroCosts: true }), (bars, strategy) => {
        const res = runBacktest(strategy, bars);
        for (const pt of res.equity) {
          expect(pt.equity).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("every fill price lies within its bar's [low, high] adjusted for slippage", () => {
    fc.assert(
      fc.property(barSeriesArb(8, 60), strategyArb(), (bars, strategy) => {
        const res = runBacktest(strategy, bars);
        const slip = strategy.risk.costs.slippageBps / 10_000;
        const byTime = new Map(bars.map((b) => [b.time, b]));
        for (const t of res.trades) {
          assertFillInRange(byTime.get(t.entryTime), t.side, "entry", t.entryPrice, slip);
          assertFillInRange(byTime.get(t.exitTime), t.side, "exit", t.exitPrice, slip);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("exposurePct stays within [0, 100]", () => {
    fc.assert(
      fc.property(barSeriesArb(8, 60), strategyArb(), (bars, strategy) => {
        const res = runBacktest(strategy, bars);
        expect(res.metrics.exposurePct).toBeGreaterThanOrEqual(0);
        expect(res.metrics.exposurePct).toBeLessThanOrEqual(100);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("trades never overlap and exits never precede entries", () => {
    fc.assert(
      fc.property(barSeriesArb(8, 60), strategyArb(), (bars, strategy) => {
        const res = runBacktest(strategy, bars);
        for (let i = 0; i < res.trades.length; i++) {
          const t = res.trades[i];
          expect(t.qty).toBeGreaterThanOrEqual(0);
          expect(t.exitTime).toBeGreaterThanOrEqual(t.entryTime);
          // A new entry may fill on the same bar the previous exit fills
          // (exit at next open, entry signal on the same signal bar), so
          // equality is allowed but true overlap is not.
          if (i > 0) expect(t.entryTime).toBeGreaterThanOrEqual(res.trades[i - 1].exitTime);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("JSON round-trip is lossless: no undefined, NaN, or Infinity anywhere", () => {
    fc.assert(
      fc.property(barSeriesArb(8, 60), strategyArb(), (bars, strategy) => {
        const res = runBacktest(strategy, bars);
        const offenders: string[] = [];
        collectOffenders(res, "result", offenders);
        expect(offenders).toEqual([]);
        const diffs: string[] = [];
        collectRoundTripDiffs(res, JSON.parse(JSON.stringify(res)), "result", diffs);
        expect(diffs).toEqual([]);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
