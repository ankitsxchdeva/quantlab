"use client";

import type { BacktestMetrics } from "@/lib/types";
import { cn, fmtNum, fmtPct } from "@/lib/utils";

interface MetricsCardsProps {
  metrics: BacktestMetrics;
}

interface Cell {
  label: string;
  value: string;
  tone?: "pos" | "neg" | "neutral";
  hint?: string;
}

function toneFromSign(n: number): "pos" | "neg" | "neutral" {
  if (!Number.isFinite(n) || n === 0) return "neutral";
  return n > 0 ? "pos" : "neg";
}

export default function MetricsCards({ metrics }: MetricsCardsProps) {
  const cells: Cell[] = [
    { label: "Total return", value: fmtPct(metrics.totalReturnPct), tone: toneFromSign(metrics.totalReturnPct) },
    { label: "CAGR", value: fmtPct(metrics.cagrPct), tone: toneFromSign(metrics.cagrPct) },
    { label: "Sharpe", value: fmtNum(metrics.sharpe, 2), tone: toneFromSign(metrics.sharpe) },
    { label: "Max drawdown", value: fmtPct(-Math.abs(metrics.maxDrawdownPct)), tone: metrics.maxDrawdownPct > 0 ? "neg" : "neutral" },
    {
      label: "Win rate",
      value: `${fmtNum(metrics.winRatePct, 1)}%`,
      hint: `${metrics.totalTrades} trade${metrics.totalTrades === 1 ? "" : "s"}`,
    },
    {
      label: "Profit factor",
      value: Number.isFinite(metrics.profitFactor) ? fmtNum(metrics.profitFactor, 2) : "∞",
      tone: metrics.profitFactor >= 1 ? "pos" : "neg",
    },
    {
      label: "Time in market",
      value: `${fmtNum(metrics.exposurePct, 0)}%`,
      hint: `${metrics.totalTrades.toLocaleString()} total`,
    },
  ];

  return (
    <section className="panel overflow-hidden">
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7">
        {cells.map((c, i) => (
          <div
            key={c.label}
            className={cn(
              "px-4 py-4 sm:px-5 sm:py-5",
              i > 0 && "border-l border-border",
              i % 2 === 0 && "sm:border-l-0 lg:border-l",
              i >= 4 && "border-t sm:border-t-0 border-border",
            )}
          >
            <div className="micro-label">{c.label}</div>
            <div
              className={cn(
                "mt-2 text-xl sm:text-2xl font-mono tabular-nums",
                c.tone === "pos" && "text-accent",
                c.tone === "neg" && "text-warning",
                (!c.tone || c.tone === "neutral") && "text-text-1",
              )}
            >
              {c.value}
            </div>
            {c.hint && <div className="mt-1 text-xs text-text-3">{c.hint}</div>}
          </div>
        ))}
      </div>
    </section>
  );
}
