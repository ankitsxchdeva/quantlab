import type { Condition, Operand, PriceSource, Strategy } from "@/lib/strategy/schema";

const PRICE_SOURCES = new Set<PriceSource>(["open", "high", "low", "close", "volume", "hl2", "hlc3", "ohlc4"]);

function describeIds(ids: Set<string>): string {
  return ids.size === 0 ? "no indicators are declared" : `declared ids: ${Array.from(ids).join(", ")}`;
}

function walkOperand(op: Operand, loc: string, ids: Set<string>, errors: string[]): void {
  if (typeof op === "number") return;
  if (typeof op === "string") {
    if (ids.has(op)) return;
    if (PRICE_SOURCES.has(op as PriceSource)) return;
    errors.push(`${loc}: unknown reference "${op}" is neither a declared indicator id nor a price source (${describeIds(ids)})`);
    return;
  }
  if ("ref" in op) {
    if (!ids.has(op.ref)) {
      errors.push(`${loc}: { ref: "${op.ref}" } does not resolve to a declared indicator id (${describeIds(ids)})`);
    }
    return;
  }
  if ("price" in op || "const" in op) return;
  walkOperand(op.left, loc, ids, errors);
  walkOperand(op.right, loc, ids, errors);
}

function walkCondition(cond: Condition, loc: string, ids: Set<string>, errors: string[]): void {
  switch (cond.op) {
    case ">":
    case ">=":
    case "<":
    case "<=":
    case "==":
    case "crosses_above":
    case "crosses_below":
      walkOperand(cond.left, loc, ids, errors);
      walkOperand(cond.right, loc, ids, errors);
      return;
    case "and":
    case "or":
      cond.conditions.forEach((c) => walkCondition(c, loc, ids, errors));
      return;
    case "not":
      walkCondition(cond.condition, loc, ids, errors);
      return;
    default: {
      const _e: never = cond;
      throw new Error(`Unknown condition: ${String(_e)}`);
    }
  }
}

export function validateStrategy(strategy: Strategy): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();

  for (const ind of strategy.indicators) {
    if (ids.has(ind.id)) {
      errors.push(`indicators: duplicate indicator id "${ind.id}"`);
    }
    if (PRICE_SOURCES.has(ind.id as PriceSource)) {
      errors.push(`indicators: indicator id "${ind.id}" shadows the "${ind.id}" price source; rename it (e.g. "${ind.id}_${ind.type.toLowerCase()}")`);
    }
    ids.add(ind.id);
  }

  strategy.entries.forEach((rule, i) => walkCondition(rule.when, `entries[${i}]`, ids, errors));
  strategy.exits.forEach((rule, i) => walkCondition(rule.when, `exits[${i}]`, ids, errors));

  return errors;
}
