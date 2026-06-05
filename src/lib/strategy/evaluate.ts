import type { Bar } from "../types";
import type { Condition, Operand, PriceSource } from "./schema";
import type { Series } from "./indicators";
import { priceSeries } from "./indicators";

export interface EvalContext {
  bars: Bar[];
  indicators: Record<string, Series>;
  warnings: Set<string>;
}

const PRICE_SOURCES = new Set<PriceSource>(["open", "high", "low", "close", "volume", "hl2", "hlc3", "ohlc4"]);

function priceAt(bar: Bar, src: PriceSource): number {
  switch (src) {
    case "open":
      return bar.open;
    case "high":
      return bar.high;
    case "low":
      return bar.low;
    case "close":
      return bar.close;
    case "volume":
      return bar.volume;
    case "hl2":
      return (bar.high + bar.low) / 2;
    case "hlc3":
      return (bar.high + bar.low + bar.close) / 3;
    case "ohlc4":
      return (bar.open + bar.high + bar.low + bar.close) / 4;
    default: {
      const _e: never = src;
      throw new Error(`Unknown price source: ${String(_e)}`);
    }
  }
}

export function evalOperand(op: Operand, i: number, ctx: EvalContext): number | null {
  if (typeof op === "number") return op;
  if (typeof op === "string") {
    if (op in ctx.indicators) {
      const v = ctx.indicators[op][i];
      return v === undefined ? null : v;
    }
    if (PRICE_SOURCES.has(op as PriceSource)) {
      return priceAt(ctx.bars[i], op as PriceSource);
    }
    ctx.warnings.add(`Unknown reference: ${op}`);
    return null;
  }
  if ("ref" in op) {
    if (!(op.ref in ctx.indicators)) {
      ctx.warnings.add(`Unknown indicator ref: ${op.ref}`);
      return null;
    }
    const v = ctx.indicators[op.ref][i];
    return v === undefined ? null : v;
  }
  if ("price" in op) return priceAt(ctx.bars[i], op.price);
  if ("const" in op) return op.const;
  if ("op" in op) {
    const l = evalOperand(op.left, i, ctx);
    const r = evalOperand(op.right, i, ctx);
    if (l === null || r === null) return null;
    switch (op.op) {
      case "+":
        return l + r;
      case "-":
        return l - r;
      case "*":
        return l * r;
      case "/":
        return r === 0 ? null : l / r;
      default: {
        const _e: never = op.op;
        throw new Error(`Unknown op: ${String(_e)}`);
      }
    }
  }
  return null;
}

export function evalCondition(cond: Condition, i: number, ctx: EvalContext): boolean {
  switch (cond.op) {
    case ">":
    case ">=":
    case "<":
    case "<=":
    case "==": {
      const l = evalOperand(cond.left, i, ctx);
      const r = evalOperand(cond.right, i, ctx);
      if (l === null || r === null) return false;
      switch (cond.op) {
        case ">":
          return l > r;
        case ">=":
          return l >= r;
        case "<":
          return l < r;
        case "<=":
          return l <= r;
        case "==":
          return l === r;
      }
      return false;
    }
    case "crosses_above":
    case "crosses_below": {
      if (i < 1) return false;
      const lNow = evalOperand(cond.left, i, ctx);
      const rNow = evalOperand(cond.right, i, ctx);
      const lPrev = evalOperand(cond.left, i - 1, ctx);
      const rPrev = evalOperand(cond.right, i - 1, ctx);
      if (lNow === null || rNow === null || lPrev === null || rPrev === null) return false;
      if (cond.op === "crosses_above") return lNow > rNow && lPrev <= rPrev;
      return lNow < rNow && lPrev >= rPrev;
    }
    case "and":
      return cond.conditions.every((c) => evalCondition(c, i, ctx));
    case "or":
      return cond.conditions.some((c) => evalCondition(c, i, ctx));
    case "not":
      return !evalCondition(cond.condition, i, ctx);
    default: {
      const _e: never = cond;
      throw new Error(`Unknown condition: ${String(_e)}`);
    }
  }
}
