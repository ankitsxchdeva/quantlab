import { describe, it, expect } from "vitest";
import type { Bar } from "../types";
import { sma, ema, rsi, macd, bbands, atr, computeIndicator } from "./indicators";
import { evalCondition } from "./evaluate";

function makeBars(closes: number[]): Bar[] {
  return closes.map((c, i) => ({
    time: i * 86_400_000,
    open: c,
    high: c + 1,
    low: c - 1,
    close: c,
    volume: 1000,
  }));
}

describe("SMA", () => {
  it("computes correct SMA values", () => {
    const out = sma([1, 2, 3, 4, 5], 3);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]).toBe(2);
    expect(out[3]).toBe(3);
    expect(out[4]).toBe(4);
  });

  it("returns nulls when not enough data", () => {
    const out = sma([1, 2], 5);
    expect(out.every((v) => v === null)).toBe(true);
  });
});

describe("EMA", () => {
  it("seeds with SMA then smooths", () => {
    const out = ema([1, 2, 3, 4, 5], 3);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]).toBe(2);
    const k = 2 / (3 + 1);
    expect(out[3]).toBeCloseTo(4 * k + 2 * (1 - k), 10);
  });
});

describe("RSI", () => {
  it("produces 100 on uniformly rising series", () => {
    const vals = Array.from({ length: 20 }, (_, i) => i + 1);
    const out = rsi(vals, 14);
    expect(out[14]).toBe(100);
  });

  it("is in [0, 100]", () => {
    const vals = [44, 47, 45, 50, 55, 53, 60, 58, 62, 65, 63, 70, 68, 72, 75, 73];
    const out = rsi(vals, 14);
    for (const v of out) {
      if (v !== null) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe("MACD", () => {
  it("produces macd/signal/hist with correct null warmup", () => {
    const vals = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 5) * 5);
    const r = macd(vals, 12, 26, 9);
    expect(r.macd[24]).toBeNull();
    expect(r.macd[25]).not.toBeNull();
    const firstSignal = r.signal.findIndex((v) => v !== null);
    expect(firstSignal).toBeGreaterThanOrEqual(25 + 8);
  });
});

describe("BBANDS", () => {
  it("upper >= middle >= lower", () => {
    const vals = [10, 11, 12, 11, 10, 9, 10, 11, 12, 13, 14, 15, 14, 13, 12, 11, 10, 9, 8, 9, 10];
    const r = bbands(vals, 20, 2);
    const i = 19;
    expect(r.middle[i]).not.toBeNull();
    expect((r.upper[i] as number) >= (r.middle[i] as number)).toBe(true);
    expect((r.middle[i] as number) >= (r.lower[i] as number)).toBe(true);
  });
});

describe("ATR", () => {
  it("is non-negative and warms up at period-1", () => {
    const bars: Bar[] = Array.from({ length: 20 }, (_, i) => ({
      time: i * 1000,
      open: 100 + i,
      high: 102 + i,
      low: 99 + i,
      close: 101 + i,
      volume: 1,
    }));
    const out = atr(bars, 14);
    expect(out[12]).toBeNull();
    expect(out[13]).not.toBeNull();
    expect((out[13] as number) > 0).toBe(true);
  });
});

describe("computeIndicator dispatcher", () => {
  it("computes SMA via Indicator", () => {
    const bars = makeBars([1, 2, 3, 4, 5]);
    const out = computeIndicator({ id: "sma3", type: "SMA", source: "close", period: 3 }, bars);
    expect(out[2]).toBe(2);
    expect(out[4]).toBe(4);
  });
});

describe("crosses_above / crosses_below", () => {
  it("detects crossover on the bar where it happens", () => {
    const bars = makeBars([1, 2, 3, 4, 5]);
    const ctx = {
      bars,
      indicators: {
        a: [1, 2, 3, 4, 5] as (number | null)[],
        b: [3, 3, 3, 3, 3] as (number | null)[],
      },
      warnings: new Set<string>(),
    };
    // a crosses above b between bar 2 (val 3) and bar 3 (val 4)
    expect(evalCondition({ op: "crosses_above", left: "a", right: "b" }, 3, ctx)).toBe(true);
    expect(evalCondition({ op: "crosses_above", left: "a", right: "b" }, 2, ctx)).toBe(false);
    expect(evalCondition({ op: "crosses_above", left: "a", right: "b" }, 4, ctx)).toBe(false);
  });

  it("detects crosses_below", () => {
    const bars = makeBars([5, 4, 3, 2, 1]);
    const ctx = {
      bars,
      indicators: {
        a: [5, 4, 3, 2, 1] as (number | null)[],
        b: [3, 3, 3, 3, 3] as (number | null)[],
      },
      warnings: new Set<string>(),
    };
    expect(evalCondition({ op: "crosses_below", left: "a", right: "b" }, 3, ctx)).toBe(true);
    expect(evalCondition({ op: "crosses_below", left: "a", right: "b" }, 1, ctx)).toBe(false);
  });

  it("returns false at index 0", () => {
    const bars = makeBars([1, 2]);
    const ctx = {
      bars,
      indicators: { a: [1, 2] as (number | null)[], b: [0, 0] as (number | null)[] },
      warnings: new Set<string>(),
    };
    expect(evalCondition({ op: "crosses_above", left: "a", right: "b" }, 0, ctx)).toBe(false);
  });
});
