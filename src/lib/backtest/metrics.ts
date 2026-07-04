import type { BacktestMetrics, EquityPoint, Timeframe, Trade } from "../types";

const MS_PER_DAY = 86_400_000;

// Bars per year by timeframe, used to annualize Sharpe/Sortino from per-bar
// returns. Intraday counts assume the 6.5-hour US equity session over 252
// trading days. CAGR is intentionally calendar-day based instead (standard).
export const BARS_PER_YEAR: Record<Timeframe, number> = {
  "1m": 252 * 390,
  "5m": 252 * 78,
  "15m": 252 * 26,
  "1h": 252 * 6.5,
  "1d": 252,
  "1wk": 52,
  "1mo": 12,
};

function safe(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  let s = 0;
  for (const v of arr) s += v;
  return s / arr.length;
}

function stddev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  let sumSq = 0;
  for (const v of arr) {
    const d = v - m;
    sumSq += d * d;
  }
  return Math.sqrt(sumSq / arr.length);
}

export function computeMetrics(
  equity: EquityPoint[],
  trades: Trade[],
  initialEquity: number,
  barsInMarket: number,
  totalBars: number,
  timeframe: Timeframe,
  totalCosts = 0,
): BacktestMetrics {
  const final = equity.length > 0 ? equity[equity.length - 1].equity : initialEquity;
  const totalReturnPct = initialEquity > 0 ? (final / initialEquity - 1) * 100 : 0;
  // Gross = net plus costs added back (additive decomposition, not a
  // frictionless re-run, which would compound into different position sizes).
  const grossTotalReturnPct = initialEquity > 0 ? ((final + totalCosts) / initialEquity - 1) * 100 : 0;

  // CAGR uses elapsed calendar days (365/yr) regardless of timeframe.
  let cagrPct = 0;
  if (equity.length >= 2 && initialEquity > 0 && final > 0) {
    const days = (equity[equity.length - 1].time - equity[0].time) / MS_PER_DAY;
    if (days > 0) {
      cagrPct = (Math.pow(final / initialEquity, 365 / days) - 1) * 100;
    }
  }

  const rets: number[] = [];
  for (let i = 1; i < equity.length; i++) {
    const prev = equity[i - 1].equity;
    const cur = equity[i].equity;
    if (prev > 0) rets.push(cur / prev - 1);
  }
  const annualization = BARS_PER_YEAR[timeframe];
  const sd = stddev(rets);
  const sharpe = rets.length > 0 && sd > 0 ? (mean(rets) / sd) * Math.sqrt(annualization) : 0;

  // Sortino convention: true downside deviation, i.e. sqrt of the mean of
  // squared min(0, r) over ALL periods (target return 0), not the stddev of
  // only the negative returns. Annualized with the same factor as Sharpe.
  let downSumSq = 0;
  for (const r of rets) {
    const d = Math.min(0, r);
    downSumSq += d * d;
  }
  const downsideDev = rets.length > 0 ? Math.sqrt(downSumSq / rets.length) : 0;
  const sortino =
    rets.length > 0 && downsideDev > 0 ? (mean(rets) / downsideDev) * Math.sqrt(annualization) : 0;

  let peak = -Infinity;
  let maxDD = 0;
  for (const pt of equity) {
    if (pt.equity > peak) peak = pt.equity;
    if (peak > 0) {
      const dd = (peak - pt.equity) / peak;
      if (dd > maxDD) maxDD = dd;
    }
  }
  const maxDrawdownPct = maxDD * 100;

  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl < 0);
  const winRatePct = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  // null (never Infinity) when there is no gross loss: JSON.stringify turns
  // Infinity into null silently, so null is the explicit wire-safe sentinel.
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : null;

  const tradePcts = trades.map((t) => t.pnlPct);
  const avgTradePct = tradePcts.length > 0 ? mean(tradePcts) : 0;
  const avgWinPct = wins.length > 0 ? mean(wins.map((t) => t.pnlPct)) : 0;
  const avgLossPct = losses.length > 0 ? mean(losses.map((t) => t.pnlPct)) : 0;
  const bestTradePct = tradePcts.length > 0 ? Math.max(...tradePcts) : 0;
  const worstTradePct = tradePcts.length > 0 ? Math.min(...tradePcts) : 0;

  const exposurePct = totalBars > 0 ? (barsInMarket / totalBars) * 100 : 0;

  return {
    initialEquity: safe(initialEquity),
    finalEquity: safe(final),
    totalReturnPct: safe(totalReturnPct),
    grossTotalReturnPct: safe(grossTotalReturnPct),
    totalCosts: safe(totalCosts),
    cagrPct: safe(cagrPct),
    sharpe: safe(sharpe),
    sortino: safe(sortino),
    maxDrawdownPct: safe(maxDrawdownPct),
    winRatePct: safe(winRatePct),
    profitFactor: profitFactor === null ? null : safe(profitFactor),
    totalTrades: trades.length,
    avgTradePct: safe(avgTradePct),
    avgWinPct: safe(avgWinPct),
    avgLossPct: safe(avgLossPct),
    exposurePct: safe(exposurePct),
    bestTradePct: safe(bestTradePct),
    worstTradePct: safe(worstTradePct),
  };
}
