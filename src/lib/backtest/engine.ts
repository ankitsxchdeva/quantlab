import type { Bar, BacktestResult, EquityPoint, MarketResolution, Trade } from "../types";
import type { EntryRule, Strategy } from "../strategy/schema";
import { computeAll, warmupBars } from "../strategy/indicators";
import { evalCondition, type EvalContext } from "../strategy/evaluate";
import { computeMetrics } from "./metrics";
import { buyAndHold } from "./benchmark";

interface OpenPosition {
  side: "long" | "short";
  entryTime: number;
  entryPrice: number;
  qty: number;
  entryBarIdx: number;
  stopPrice: number | null;
  takePrice: number | null;
}

function markToMarket(cash: number, pos: OpenPosition | null, price: number): number {
  if (!pos) return cash;
  if (pos.side === "long") return cash + pos.qty * price;
  return cash + pos.qty * (pos.entryPrice - price);
}

function closeTrade(pos: OpenPosition, exitTime: number, exitPrice: number, reason: Trade["reason"]): Trade {
  const pnl = pos.side === "long" ? (exitPrice - pos.entryPrice) * pos.qty : (pos.entryPrice - exitPrice) * pos.qty;
  const pnlPct = pos.entryPrice > 0 ? (pos.side === "long" ? (exitPrice / pos.entryPrice - 1) * 100 : (pos.entryPrice / exitPrice - 1) * 100) : 0;
  return {
    side: pos.side,
    entryTime: pos.entryTime,
    entryPrice: pos.entryPrice,
    exitTime,
    exitPrice,
    qty: pos.qty,
    pnl,
    pnlPct: Number.isFinite(pnlPct) ? pnlPct : 0,
    reason,
  };
}

function cashAfterClose(cash: number, pos: OpenPosition, exitPrice: number): number {
  if (pos.side === "long") return cash + pos.qty * exitPrice;
  return cash + pos.qty * (pos.entryPrice - exitPrice);
}

function applyEntry(
  rule: EntryRule,
  bar: Bar,
  fillPrice: number,
  equity: number,
  positionSizePct: number,
  stopLossPct: number | undefined,
  takeProfitPct: number | undefined,
  barIdx: number,
): { pos: OpenPosition; cashDelta: number } {
  const notional = (equity * positionSizePct) / 100;
  const qty = fillPrice > 0 ? notional / fillPrice : 0;
  const stop =
    stopLossPct === undefined
      ? null
      : rule.side === "long"
      ? fillPrice * (1 - stopLossPct / 100)
      : fillPrice * (1 + stopLossPct / 100);
  const take =
    takeProfitPct === undefined
      ? null
      : rule.side === "long"
      ? fillPrice * (1 + takeProfitPct / 100)
      : fillPrice * (1 - takeProfitPct / 100);
  const pos: OpenPosition = {
    side: rule.side,
    entryTime: bar.time,
    entryPrice: fillPrice,
    qty,
    entryBarIdx: barIdx,
    stopPrice: stop,
    takePrice: take,
  };
  const cashDelta = rule.side === "long" ? -qty * fillPrice : 0;
  return { pos, cashDelta };
}

const DEFAULT_MARKET: MarketResolution = { source: "stock", symbol: "", label: "" };

export function runBacktest(strategy: Strategy, bars: Bar[], market: MarketResolution = DEFAULT_MARKET): BacktestResult {
  const warnings = new Set<string>();
  const trades: Trade[] = [];
  const equity: EquityPoint[] = [];
  const initialEquity = strategy.initialEquity;
  const resolvedMarket: MarketResolution = {
    source: market.source ?? strategy.market,
    symbol: market.symbol || strategy.asset,
    label: market.label || strategy.asset,
    url: market.url,
  };

  if (bars.length === 0) {
    return {
      metrics: computeMetrics([], [], initialEquity, 0, 0),
      trades,
      equity,
      bars,
      benchmark: buyAndHold(bars, initialEquity, `Buy & hold ${resolvedMarket.label}`),
      market: resolvedMarket,
      warnings: [],
    };
  }

  const indicators = computeAll(strategy.indicators, bars);
  for (const ind of strategy.indicators) {
    const need = warmupBars(ind);
    if (bars.length < need) {
      warnings.add(`Insufficient bars for indicator ${ind.id} (need ${need}, have ${bars.length})`);
    }
  }

  const ctx: EvalContext = { bars, indicators, warnings };

  let cash = initialEquity;
  let pos: OpenPosition | null = null;
  let peak = initialEquity;
  let barsInMarket = 0;

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const isLast = i === bars.length - 1;

    if (pos) {
      barsInMarket++;
      const hitStop =
        pos.stopPrice !== null &&
        (pos.side === "long" ? bar.low <= pos.stopPrice : bar.high >= pos.stopPrice);
      const hitTake =
        pos.takePrice !== null &&
        (pos.side === "long" ? bar.high >= pos.takePrice : bar.low <= pos.takePrice);

      if (hitStop) {
        const fill = pos.stopPrice as number;
        cash = cashAfterClose(cash, pos, fill);
        trades.push(closeTrade(pos, bar.time, fill, "stop_loss"));
        pos = null;
      } else if (hitTake) {
        const fill = pos.takePrice as number;
        cash = cashAfterClose(cash, pos, fill);
        trades.push(closeTrade(pos, bar.time, fill, "take_profit"));
        pos = null;
      } else {
        let exitSignal = false;
        for (const exit of strategy.exits) {
          if (evalCondition(exit.when, i, ctx)) {
            exitSignal = true;
            break;
          }
        }
        const maxBars = strategy.risk.maxBarsInTrade;
        const hitMaxBars = maxBars !== undefined && i - pos.entryBarIdx >= maxBars;

        if (exitSignal || hitMaxBars) {
          if (isLast) {
            cash = cashAfterClose(cash, pos, bar.close);
            trades.push(closeTrade(pos, bar.time, bar.close, "end_of_data"));
            pos = null;
          } else {
            const next = bars[i + 1];
            cash = cashAfterClose(cash, pos, next.open);
            trades.push(closeTrade(pos, next.time, next.open, "signal"));
            pos = null;
          }
        }
      }
    }

    if (!pos && !isLast) {
      for (const rule of strategy.entries) {
        if (rule.side === "short" && !strategy.allowShort) continue;
        if (evalCondition(rule.when, i, ctx)) {
          const next = bars[i + 1];
          const eq = markToMarket(cash, null, bar.close);
          const { pos: newPos, cashDelta } = applyEntry(
            rule,
            next,
            next.open,
            eq,
            strategy.risk.positionSizePct,
            strategy.risk.stopLossPct,
            strategy.risk.takeProfitPct,
            i + 1,
          );
          pos = newPos;
          cash += cashDelta;
          break;
        }
      }
    }

    const eq = markToMarket(cash, pos, bar.close);
    if (eq > peak) peak = eq;
    const dd = peak > 0 ? (peak - eq) / peak : 0;
    equity.push({ time: bar.time, equity: eq, drawdown: dd });
  }

  if (pos) {
    const last = bars[bars.length - 1];
    cash = cashAfterClose(cash, pos, last.close);
    trades.push(closeTrade(pos, last.time, last.close, "end_of_data"));
    pos = null;
    const lastPoint = equity[equity.length - 1];
    if (lastPoint) {
      lastPoint.equity = cash;
      if (cash > peak) peak = cash;
      lastPoint.drawdown = peak > 0 ? (peak - cash) / peak : 0;
    }
  }

  const metrics = computeMetrics(equity, trades, initialEquity, barsInMarket, bars.length);
  const benchmark = buyAndHold(bars, initialEquity, `Buy & hold ${resolvedMarket.label}`);

  return {
    metrics,
    trades,
    equity,
    bars,
    benchmark,
    market: resolvedMarket,
    warnings: Array.from(warnings),
  };
}
