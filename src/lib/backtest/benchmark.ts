import type { Bar, BenchmarkResult, EquityPoint } from "@/lib/types";

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

export function buyAndHold(bars: Bar[], initialEquity: number, label = "Buy & Hold"): BenchmarkResult {
  if (bars.length === 0) {
    return {
      label,
      initialEquity,
      finalEquity: initialEquity,
      totalReturnPct: 0,
      cagrPct: 0,
      maxDrawdownPct: 0,
      equity: [],
    };
  }

  const entryPrice = bars[0].open;
  const qty = entryPrice > 0 ? initialEquity / entryPrice : 0;

  const equity: EquityPoint[] = [];
  let peak = initialEquity;
  let maxDD = 0;

  for (const bar of bars) {
    const value = qty * bar.close;
    if (value > peak) peak = value;
    const dd = peak > 0 ? (peak - value) / peak : 0;
    if (dd > maxDD) maxDD = dd;
    equity.push({ time: bar.time, equity: value, drawdown: dd });
  }

  const finalEquity = equity[equity.length - 1].equity;
  const totalReturnPct = initialEquity > 0 ? (finalEquity / initialEquity - 1) * 100 : 0;
  const years = (bars[bars.length - 1].time - bars[0].time) / MS_PER_YEAR;
  const cagrPct =
    years > 0 && finalEquity > 0 && initialEquity > 0
      ? (Math.pow(finalEquity / initialEquity, 1 / years) - 1) * 100
      : 0;

  return {
    label,
    initialEquity,
    finalEquity,
    totalReturnPct,
    cagrPct,
    maxDrawdownPct: maxDD * 100,
    equity,
  };
}
