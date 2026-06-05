import type { BacktestMetrics, EquityPoint, Trade } from "../types";

const MS_PER_DAY = 86_400_000;
const ANNUALIZATION = 252;

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
): BacktestMetrics {
  const final = equity.length > 0 ? equity[equity.length - 1].equity : initialEquity;
  const totalReturnPct = initialEquity > 0 ? (final / initialEquity - 1) * 100 : 0;

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
  const sd = stddev(rets);
  const sharpe = rets.length > 0 && sd > 0 ? (mean(rets) / sd) * Math.sqrt(ANNUALIZATION) : 0;

  const downside = rets.filter((r) => r < 0);
  const dsd = stddev(downside);
  const sortino = rets.length > 0 && dsd > 0 ? (mean(rets) / dsd) * Math.sqrt(ANNUALIZATION) : 0;

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
  let profitFactor = 0;
  if (trades.length === 0) profitFactor = 0;
  else if (grossLoss === 0) profitFactor = grossWin > 0 ? Infinity : 0;
  else profitFactor = grossWin / grossLoss;

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
    cagrPct: safe(cagrPct),
    sharpe: safe(sharpe),
    sortino: safe(sortino),
    maxDrawdownPct: safe(maxDrawdownPct),
    winRatePct: safe(winRatePct),
    profitFactor: Number.isFinite(profitFactor) || profitFactor === Infinity ? profitFactor : 0,
    totalTrades: trades.length,
    avgTradePct: safe(avgTradePct),
    avgWinPct: safe(avgWinPct),
    avgLossPct: safe(avgLossPct),
    exposurePct: safe(exposurePct),
    bestTradePct: safe(bestTradePct),
    worstTradePct: safe(worstTradePct),
  };
}
