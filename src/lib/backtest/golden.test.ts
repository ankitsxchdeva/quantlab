import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Bar, BacktestResult } from "../types";
import { StrategySchema, type Strategy } from "../strategy/schema";
import { runBacktest } from "./engine";

// Golden regression fixtures: full BacktestResults pinned as JSON. Any diff
// against a fixture means engine/metrics behavior changed. If the change is
// intentional, regenerate deliberately and review the fixture diff:
//   GOLDEN_UPDATE=1 npx vitest run src/lib/backtest/golden.test.ts
const GOLDEN_DIR = path.join(__dirname, "golden");
const UPDATE = process.env.GOLDEN_UPDATE === "1";
const REGEN_CMD = "GOLDEN_UPDATE=1 npx vitest run src/lib/backtest/golden.test.ts";

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

// Seeded daily GBM series, same shape as the demo/engine-test generators.
function syntheticBars(seed: number, days: number, driftAnnual = 0.12): Bar[] {
  const rand = mulberry32(seed);
  const gaussian = (): number => {
    const u = Math.max(rand(), 1e-9);
    const v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const mu = driftAnnual / 252;
  const sigma = 0.28 / Math.sqrt(252);
  const bars: Bar[] = [];
  let price = 100;
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

interface GoldenCase {
  name: string;
  file: string;
  bars: Bar[];
  strategy: Strategy;
}

const CASES: GoldenCase[] = [
  {
    name: "demo golden cross (SMA 50/200, default costs)",
    file: "golden-cross.json",
    bars: syntheticBars(0xbeefcafe, 1_512),
    strategy: StrategySchema.parse({
      name: "Golden cross",
      asset: "GOLDEN",
      indicators: [
        { id: "sma_fast", type: "SMA", source: "close", period: 50 },
        { id: "sma_slow", type: "SMA", source: "close", period: 200 },
      ],
      entries: [{ side: "long", when: { op: "crosses_above", left: { ref: "sma_fast" }, right: { ref: "sma_slow" } } }],
      exits: [{ when: { op: "crosses_below", left: { ref: "sma_fast" }, right: { ref: "sma_slow" } } }],
      risk: { positionSizePct: 100 },
    }),
  },
  {
    name: "RSI mean reversion with stop loss",
    file: "rsi-mean-reversion.json",
    bars: syntheticBars(0x12345678, 756),
    strategy: StrategySchema.parse({
      name: "RSI mean reversion",
      asset: "GOLDEN",
      indicators: [{ id: "rsi", type: "RSI", source: "close", period: 14 }],
      entries: [{ side: "long", when: { op: "crosses_below", left: { ref: "rsi" }, right: { const: 35 } } }],
      exits: [{ when: { op: ">", left: { ref: "rsi" }, right: { const: 55 } } }],
      risk: { positionSizePct: 100, stopLossPct: 8 },
    }),
  },
  {
    name: "short SMA cross with borrow and commission",
    file: "short-sma-cross.json",
    bars: syntheticBars(0xdeadbeef, 756, -0.05),
    strategy: StrategySchema.parse({
      name: "Short the death cross",
      asset: "GOLDEN",
      indicators: [
        { id: "fast", type: "SMA", source: "close", period: 10 },
        { id: "slow", type: "SMA", source: "close", period: 30 },
      ],
      entries: [{ side: "short", when: { op: "crosses_below", left: { ref: "fast" }, right: { ref: "slow" } } }],
      exits: [{ when: { op: "crosses_above", left: { ref: "fast" }, right: { ref: "slow" } } }],
      risk: { positionSizePct: 100, costs: { commissionBps: 2, slippageBps: 5, borrowRateAnnualPct: 5 } },
      allowShort: true,
    }),
  },
  {
    name: "EMA breakout with stop, take profit, and time stop",
    file: "stop-take-time.json",
    bars: syntheticBars(0xcafef00d, 504),
    strategy: StrategySchema.parse({
      name: "EMA breakout bracketed",
      asset: "GOLDEN",
      indicators: [{ id: "ema", type: "EMA", source: "close", period: 20 }],
      entries: [{ side: "long", when: { op: "crosses_above", left: { price: "close" }, right: { ref: "ema" } } }],
      exits: [],
      risk: { positionSizePct: 50, stopLossPct: 5, takeProfitPct: 10, maxBarsInTrade: 30 },
    }),
  },
  {
    name: "SMA cross with all costs disabled",
    file: "zero-costs-sma-cross.json",
    bars: syntheticBars(0xbeefcafe, 756),
    strategy: StrategySchema.parse({
      name: "Frictionless SMA cross",
      asset: "GOLDEN",
      indicators: [
        { id: "fast", type: "SMA", source: "close", period: 20 },
        { id: "slow", type: "SMA", source: "close", period: 50 },
      ],
      entries: [{ side: "long", when: { op: "crosses_above", left: { ref: "fast" }, right: { ref: "slow" } } }],
      exits: [{ when: { op: "crosses_below", left: { ref: "fast" }, right: { ref: "slow" } } }],
      risk: { positionSizePct: 100, costs: { commissionBps: 0, slippageBps: 0, borrowRateAnnualPct: 0 } },
    }),
  },
];

describe("golden regression fixtures", () => {
  for (const c of CASES) {
    it(`matches ${c.file} (${c.name})`, () => {
      // Round-trip through JSON so the in-memory result is compared with the
      // exact wire shape stored in the fixture.
      const result = JSON.parse(JSON.stringify(runBacktest(c.strategy, c.bars))) as BacktestResult;
      expect(result.trades.length, `fixture strategy "${c.name}" must close at least one trade`).toBeGreaterThan(0);

      const file = path.join(GOLDEN_DIR, c.file);
      if (UPDATE) {
        mkdirSync(GOLDEN_DIR, { recursive: true });
        writeFileSync(file, JSON.stringify(result) + "\n");
        return;
      }

      expect(existsSync(file), `Missing golden fixture ${c.file}. Generate it with: ${REGEN_CMD}`).toBe(true);
      const expected = JSON.parse(readFileSync(file, "utf8")) as BacktestResult;
      expect(
        result,
        `BacktestResult drifted from committed fixture ${c.file} ("${c.name}"). ` +
          `If you changed engine/metrics behavior on purpose, regenerate deliberately with: ${REGEN_CMD} ` +
          `and review the fixture diff. Otherwise this is a regression.`,
      ).toEqual(expected);
    });
  }
});
