"use client";

import type { Strategy, Indicator, Condition, Operand, PriceSource } from "@/lib/strategy/schema";

interface PlainEnglishStrategyProps {
  strategy: Strategy;
}

const PRICE_NAME: Record<PriceSource, string> = {
  open: "open price",
  high: "high",
  low: "low",
  close: "close",
  volume: "volume",
  hl2: "(high + low) / 2",
  hlc3: "(high + low + close) / 3",
  ohlc4: "(open + high + low + close) / 4",
};

function describeIndicator(ind: Indicator): string {
  switch (ind.type) {
    case "SMA":
      return `${ind.period}-period simple moving average of ${PRICE_NAME[ind.source]}`;
    case "EMA":
      return `${ind.period}-period exponential moving average of ${PRICE_NAME[ind.source]}`;
    case "RSI":
      return `${ind.period}-period RSI of ${PRICE_NAME[ind.source]}`;
    case "MACD":
      return `MACD ${ind.output} line (fast ${ind.fast}, slow ${ind.slow}, signal ${ind.signal})`;
    case "BBANDS":
      return `Bollinger ${ind.output} band of ${PRICE_NAME[ind.source]} (period ${ind.period}, ${ind.stddev}σ)`;
    case "ATR":
      return `${ind.period}-period ATR`;
    case "STDDEV":
      return `${ind.period}-period standard deviation of ${PRICE_NAME[ind.source]}`;
    case "HIGHEST":
      return `highest ${PRICE_NAME[ind.source]} over the last ${ind.period} bars`;
    case "LOWEST":
      return `lowest ${PRICE_NAME[ind.source]} over the last ${ind.period} bars`;
  }
}

function indicatorLabel(ind: Indicator): string {
  switch (ind.type) {
    case "SMA":
      return `SMA(${ind.period})`;
    case "EMA":
      return `EMA(${ind.period})`;
    case "RSI":
      return `RSI(${ind.period})`;
    case "MACD":
      return `MACD ${ind.output}`;
    case "BBANDS":
      return `BB ${ind.output}`;
    case "ATR":
      return `ATR(${ind.period})`;
    case "STDDEV":
      return `STDDEV(${ind.period})`;
    case "HIGHEST":
      return `${ind.period}-bar high`;
    case "LOWEST":
      return `${ind.period}-bar low`;
  }
}

function describeOperand(op: Operand, indicators: Indicator[]): string {
  if (typeof op === "number") return op.toString();
  if (typeof op === "string") {
    const match = indicators.find((i) => i.id === op);
    if (match) return indicatorLabel(match);
    if (op in PRICE_NAME) return PRICE_NAME[op as PriceSource];
    return op;
  }
  if ("ref" in op) {
    const match = indicators.find((i) => i.id === op.ref);
    return match ? indicatorLabel(match) : op.ref;
  }
  if ("price" in op) return PRICE_NAME[op.price];
  if ("const" in op) return op.const.toString();
  return `(${describeOperand(op.left, indicators)} ${op.op} ${describeOperand(op.right, indicators)})`;
}

const COMPARATOR_WORD: Record<string, string> = {
  ">": "is above",
  ">=": "is at or above",
  "<": "is below",
  "<=": "is at or below",
  "==": "equals",
};

function describeCondition(c: Condition, indicators: Indicator[]): string {
  switch (c.op) {
    case ">":
    case ">=":
    case "<":
    case "<=":
    case "==":
      return `${describeOperand(c.left, indicators)} ${COMPARATOR_WORD[c.op]} ${describeOperand(c.right, indicators)}`;
    case "crosses_above":
      return `${describeOperand(c.left, indicators)} crosses above ${describeOperand(c.right, indicators)}`;
    case "crosses_below":
      return `${describeOperand(c.left, indicators)} crosses below ${describeOperand(c.right, indicators)}`;
    case "and":
      return c.conditions.map((sub) => describeCondition(sub, indicators)).join(" AND ");
    case "or":
      return c.conditions.map((sub) => describeCondition(sub, indicators)).join(" OR ");
    case "not":
      return `NOT (${describeCondition(c.condition, indicators)})`;
  }
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-4 first:pt-0 last:pb-0 border-b border-border last:border-b-0">
      <div className="micro-label mb-2">{label}</div>
      {children}
    </div>
  );
}

export default function PlainEnglishStrategy({ strategy }: PlainEnglishStrategyProps) {
  const isPolymarket = strategy.market === "polymarket";
  const assetSentence = isPolymarket
    ? `Trading the Polymarket market "${strategy.asset}" on ${strategy.timeframe} bars.`
    : `Trading ${strategy.asset} on ${strategy.timeframe} bars.`;

  const stop = strategy.risk.stopLossPct;
  const take = strategy.risk.takeProfitPct;
  const maxBars = strategy.risk.maxBarsInTrade;

  return (
    <div className="px-5 py-4">
      {strategy.description && (
        <p className="text-sm text-text-2 max-w-prose mb-5 leading-relaxed">{strategy.description}</p>
      )}

      <Section label="Market">
        <p className="text-sm text-text-1">{assetSentence}</p>
      </Section>

      {strategy.indicators.length > 0 && (
        <Section label="What we're tracking">
          <ul className="text-sm text-text-1 space-y-1.5">
            {strategy.indicators.map((ind) => (
              <li key={ind.id} className="flex items-baseline gap-3">
                <span className="font-mono text-text-3 text-xs shrink-0 w-24 truncate">{ind.id}</span>
                <span>{describeIndicator(ind)}.</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section label="When to buy">
        <ul className="text-sm text-text-1 space-y-1.5">
          {strategy.entries.map((rule, i) => (
            <li key={i} className="leading-relaxed">
              Go <span className="text-text-1 font-medium">{rule.side === "long" ? "long" : "short"}</span> when {describeCondition(rule.when, strategy.indicators)}.
            </li>
          ))}
        </ul>
      </Section>

      {(strategy.exits.length > 0 || stop !== undefined || take !== undefined || maxBars !== undefined) && (
        <Section label="When to sell">
          <ul className="text-sm text-text-1 space-y-1.5">
            {strategy.exits.map((rule, i) => (
              <li key={i} className="leading-relaxed">
                Exit when {describeCondition(rule.when, strategy.indicators)}{rule.reason ? ` (${rule.reason})` : ""}.
              </li>
            ))}
            {stop !== undefined && (
              <li className="leading-relaxed text-text-2">
                Or cut the position with a <span className="text-warning">{stop}% stop loss</span>.
              </li>
            )}
            {take !== undefined && (
              <li className="leading-relaxed text-text-2">
                Or take profits at <span className="text-accent">+{take}%</span>.
              </li>
            )}
            {maxBars !== undefined && (
              <li className="leading-relaxed text-text-2">
                Or force-close after {maxBars} bars in trade.
              </li>
            )}
          </ul>
        </Section>
      )}

      <Section label="Position sizing">
        <p className="text-sm text-text-1 leading-relaxed">
          Risk <span className="tabular">{strategy.risk.positionSizePct}%</span> of equity per trade.
          {" "}Shorting is <span className={strategy.allowShort ? "text-accent" : "text-text-3"}>{strategy.allowShort ? "enabled" : "disabled"}</span>.
          {" "}Starting equity: <span className="tabular">${strategy.initialEquity.toLocaleString()}</span>.
        </p>
      </Section>
    </div>
  );
}
