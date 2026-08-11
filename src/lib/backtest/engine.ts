import type { Bar, BacktestResult, EquityPoint, MarketResolution, Trade } from "../types";
import type { EntryRule, Strategy } from "../strategy/schema";
import { computeAll, warmupBars } from "../strategy/indicators";
import { evalCondition, type EvalContext } from "../strategy/evaluate";
import { BARS_PER_YEAR, computeMetrics } from "./metrics";
import { buyAndHold } from "./benchmark";

interface OpenPosition {
  side: "long" | "short";
  entryTime: number;
  entryPrice: number;
  qty: number;
  entryBarIdx: number;
  stopPrice: number | null;
  takePrice: number | null;
  // Commissions and borrow accrued so far; subtracted from the trade's net
  // pnl at close. Slippage is not included here since it is baked into fills.
  friction: number;
}

// Slippage always moves the fill against the trader: long entries and short
// exits fill higher, long exits and short entries fill lower.
function applySlippage(price: number, side: "long" | "short", fill: "entry" | "exit", slip: number): number {
  const up = (side === "long") === (fill === "entry");
  return up ? price * (1 + slip) : price * (1 - slip);
}

function markToMarket(cash: number, pos: OpenPosition | null, price: number): number {
  if (!pos) return cash;
  if (pos.side === "long") return cash + pos.qty * price;
  return cash + pos.qty * (pos.entryPrice - price);
}

function closeTrade(pos: OpenPosition, exitTime: number, exitPrice: number, reason: Trade["reason"], exitCommission: number): Trade {
  const gross = pos.side === "long" ? (exitPrice - pos.entryPrice) * pos.qty : (pos.entryPrice - exitPrice) * pos.qty;
  const pnl = gross - pos.friction - exitCommission;
  const basis = pos.qty * pos.entryPrice;
  const pnlPct = basis > 0 ? (pnl / basis) * 100 : 0;
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

function cashAfterClose(cash: number, pos: OpenPosition, exitPrice: number, exitCommission: number): number {
  if (pos.side === "long") return cash + pos.qty * exitPrice - exitCommission;
  return cash + pos.qty * (pos.entryPrice - exitPrice) - exitCommission;
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
  commissionRate: number,
): { pos: OpenPosition; cashDelta: number; commission: number } {
  const budget = (equity * positionSizePct) / 100;
  // Size so notional + entry commission fits the budget, keeping cash >= 0.
  const qty = fillPrice > 0 ? budget / (fillPrice * (1 + commissionRate)) : 0;
  const commission = qty * fillPrice * commissionRate;
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
    friction: commission,
  };
  const cashDelta = rule.side === "long" ? -(qty * fillPrice + commission) : -commission;
  return { pos, cashDelta, commission };
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
    ...(market.url !== undefined ? { url: market.url } : {}),
  };

  if (bars.length === 0) {
    return {
      metrics: computeMetrics([], [], initialEquity, 0, 0, strategy.timeframe),
      trades,
      equity,
      bars,
      benchmark: buyAndHold(bars, initialEquity, `Buy & hold ${resolvedMarket.label}`),
      market: resolvedMarket,
      warnings: [],
    };
  }

  const indicators = computeAll(strategy.indicators, bars);
  let warmup = 0;
  for (const ind of strategy.indicators) {
    const need = warmupBars(ind);
    if (need > warmup) warmup = need;
    if (bars.length < need) {
      warnings.add(`Insufficient bars for indicator ${ind.id} (need ${need}, have ${bars.length})`);
    }
  }

  const ctx: EvalContext = { bars, indicators, warnings };

  const { costs } = strategy.risk;
  const slip = costs.slippageBps / 10_000;
  const commissionRate = costs.commissionBps / 10_000;
  const borrowPerBar = costs.borrowRateAnnualPct / 100 / BARS_PER_YEAR[strategy.timeframe];

  let cash = initialEquity;
  let pos: OpenPosition | null = null;
  let peak = initialEquity;
  let barsInMarket = 0;
  let totalCosts = 0;

  const closePosition = (rawExit: number, time: number, reason: Trade["reason"]): void => {
    if (!pos) return;
    const fill = applySlippage(rawExit, pos.side, "exit", slip);
    const exitCommission = pos.qty * fill * commissionRate;
    totalCosts += pos.qty * rawExit * slip + exitCommission;
    cash = cashAfterClose(cash, pos, fill, exitCommission);
    trades.push(closeTrade(pos, time, fill, reason, exitCommission));
    pos = null;
  };

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const isLast = i === bars.length - 1;
    // Suppress entry/exit signal evaluation until every indicator has warmed
    // up, so conditions like "not (indicator > x)" cannot fire on null values.
    const signalsReady = i + 1 >= warmup;

    // Set when this bar's close signals an exit. The fill is the NEXT bar's
    // open, so it is deliberately not acted on until after this bar is marked.
    let exitSignalled = false;

    if (pos) {
      barsInMarket++;
      if (pos.side === "short" && borrowPerBar > 0) {
        // Borrow accrues on entry notional for every bar the short is open,
        // including the exit bar.
        const borrow = pos.qty * pos.entryPrice * borrowPerBar;
        cash -= borrow;
        pos.friction += borrow;
        totalCosts += borrow;
      }
      const hitStop =
        pos.stopPrice !== null &&
        (pos.side === "long" ? bar.low <= pos.stopPrice : bar.high >= pos.stopPrice);
      const hitTake =
        pos.takePrice !== null &&
        (pos.side === "long" ? bar.high >= pos.takePrice : bar.low <= pos.takePrice);

      // Same-bar stop+take conflict convention: the stop fills first
      // (conservative; intrabar ordering is unknowable from OHLC).
      if (hitStop) {
        // Gap-through: when the bar opens beyond the level the market never
        // traded at the stop, so the fill is the open, not the level.
        const level = pos.stopPrice as number;
        const raw = pos.side === "long" ? Math.min(bar.open, level) : Math.max(bar.open, level);
        closePosition(raw, bar.time, "stop_loss");
      } else if (hitTake) {
        const level = pos.takePrice as number;
        const raw = pos.side === "long" ? Math.max(bar.open, level) : Math.min(bar.open, level);
        closePosition(raw, bar.time, "take_profit");
      } else {
        let exitSignal = false;
        if (signalsReady) {
          for (const exit of strategy.exits) {
            if (evalCondition(exit.when, i, ctx)) {
              exitSignal = true;
              break;
            }
          }
        }
        const maxBars = strategy.risk.maxBarsInTrade;
        const hitMaxBars = maxBars !== undefined && i - pos.entryBarIdx >= maxBars;
        exitSignalled = exitSignal || hitMaxBars;
      }
    }

    // Mark the bar against the position actually held THROUGH it. Stops and
    // targets above fill inside this bar, so they belong here; signalled
    // entries and exits fill at the next bar's open and must not be. Marking
    // those here let a gap between this close and the next open leak in as
    // phantom profit or a drawdown the account never took, and every
    // equity-derived metric picked the error up.
    const marked = markToMarket(cash, pos, bar.close);
    if (marked > peak) peak = marked;
    const dd = peak > 0 ? (peak - marked) / peak : 0;
    equity.push({ time: bar.time, equity: marked, drawdown: dd });

    // Nothing fills after the final bar; any still-open position is closed
    // below at that bar's close.
    if (isLast) continue;
    const next = bars[i + 1];

    if (pos && exitSignalled) {
      closePosition(next.open, next.time, "signal");
    }

    if (!pos && signalsReady) {
      for (const rule of strategy.entries) {
        if (rule.side === "short" && !strategy.allowShort) continue;
        if (evalCondition(rule.when, i, ctx)) {
          const rawEntry = next.open;
          const { pos: newPos, cashDelta, commission } = applyEntry(
            rule,
            next,
            applySlippage(rawEntry, rule.side, "entry", slip),
            cash,
            strategy.risk.positionSizePct,
            strategy.risk.stopLossPct,
            strategy.risk.takeProfitPct,
            i + 1,
            commissionRate,
          );
          totalCosts += newPos.qty * rawEntry * slip + commission;
          pos = newPos;
          cash += cashDelta;
          break;
        }
      }
    }
  }

  if (pos) {
    const last = bars[bars.length - 1];
    closePosition(last.close, last.time, "end_of_data");
    const lastPoint = equity[equity.length - 1];
    if (lastPoint) {
      lastPoint.equity = cash;
      if (cash > peak) peak = cash;
      lastPoint.drawdown = peak > 0 ? (peak - cash) / peak : 0;
    }
  }

  const metrics = computeMetrics(equity, trades, initialEquity, barsInMarket, bars.length, strategy.timeframe, totalCosts);
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
