"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
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
  tooltip: string;
}

function toneFromSign(n: number): "pos" | "neg" | "neutral" {
  if (!Number.isFinite(n) || n === 0) return "neutral";
  return n > 0 ? "pos" : "neg";
}

function InfoIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

function MetricCell({ cell, openId, setOpenId, id }: { cell: Cell; openId: string | null; setOpenId: Dispatch<SetStateAction<string | null>>; id: string }) {
  const open = openId === id;
  return (
    <div className="relative">
      <div className="flex items-center gap-1.5">
        <span className="micro-label">{cell.label}</span>
        <button
          type="button"
          aria-label={`What is ${cell.label}?`}
          aria-expanded={open}
          onClick={() => setOpenId(open ? null : id)}
          onMouseEnter={() => setOpenId(id)}
          onMouseLeave={() => setOpenId((curr) => (curr === id ? null : curr))}
          className="text-text-3 hover:text-text-1 transition-colors duration-120 ease-out"
        >
          <InfoIcon />
        </button>
      </div>
      <div
        className={cn(
          "mt-2 text-xl sm:text-2xl font-mono tabular-nums",
          cell.tone === "pos" && "text-accent",
          cell.tone === "neg" && "text-warning",
          (!cell.tone || cell.tone === "neutral") && "text-text-1",
        )}
      >
        {cell.value}
      </div>
      {cell.hint && <div className="mt-1 text-xs text-text-3">{cell.hint}</div>}
      {open && (
        <div
          role="tooltip"
          className="absolute z-20 top-full mt-2 left-0 right-0 sm:left-auto sm:right-auto sm:min-w-[260px] sm:max-w-[300px] panel-raised px-3 py-2.5 text-xs text-text-2 leading-relaxed animate-fade-in shadow-lg"
        >
          {cell.tooltip}
        </div>
      )}
    </div>
  );
}

export default function MetricsCards({ metrics }: MetricsCardsProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const cells: Cell[] = [
    {
      label: "Total return",
      value: fmtPct(metrics.totalReturnPct),
      tone: toneFromSign(metrics.totalReturnPct),
      tooltip: "What percent your starting equity grew or shrank by the end. Includes every trade plus any cash sitting idle.",
    },
    {
      label: "CAGR",
      value: fmtPct(metrics.cagrPct),
      tone: toneFromSign(metrics.cagrPct),
      tooltip: "Compound annual growth rate. Your total return expressed as a steady yearly rate, so you can compare strategies of different durations.",
    },
    {
      label: "Sharpe",
      value: fmtNum(metrics.sharpe, 2),
      tone: toneFromSign(metrics.sharpe),
      tooltip: "Return per unit of volatility. Above 1 is decent, above 2 is good, above 3 is rare. Negative means the equity curve was a roller coaster going the wrong way.",
    },
    {
      label: "Max drawdown",
      value: fmtPct(-Math.abs(metrics.maxDrawdownPct)),
      tone: metrics.maxDrawdownPct > 0 ? "neg" : "neutral",
      tooltip: "The deepest peak-to-trough loss the strategy ever sat through. The pain you'd need to stomach to actually run it.",
    },
    {
      label: "Win rate",
      value: `${fmtNum(metrics.winRatePct, 1)}%`,
      hint: `${metrics.totalTrades} trade${metrics.totalTrades === 1 ? "" : "s"}`,
      tooltip: "Share of trades that closed in profit. Less important than profit factor; many profitable strategies win only 30 to 40 percent of the time.",
    },
    {
      label: "Profit factor",
      value: Number.isFinite(metrics.profitFactor) ? fmtNum(metrics.profitFactor, 2) : "∞",
      tone: metrics.profitFactor >= 1 ? "pos" : "neg",
      tooltip: "Total profit divided by total loss. Above 1 means winners outpaced losers. Above 2 is strong. Below 1 means the strategy bled.",
    },
    {
      label: "Time in market",
      value: `${fmtNum(metrics.exposurePct, 0)}%`,
      hint: `${metrics.totalTrades.toLocaleString()} total`,
      tooltip: "Fraction of bars the strategy held a position. Low exposure with decent returns can mean better risk-adjusted performance.",
    },
  ];

  return (
    <section className="panel overflow-visible">
      <div className="grid grid-cols-2 lg:grid-cols-7">
        {cells.map((c, i) => {
          const lastOnSmall = i === cells.length - 1;
          return (
            <div
              key={c.label}
              className={cn(
                "px-4 py-4 sm:px-5 sm:py-5 relative",
                i > 0 && i % 2 !== 0 && "border-l border-border lg:border-l",
                i > 0 && i % 2 === 0 && "lg:border-l border-border",
                i >= 2 && "border-t border-border lg:border-t-0",
                lastOnSmall && "col-span-2 lg:col-span-1 lg:border-l border-border",
              )}
            >
              <MetricCell cell={c} openId={openId} setOpenId={setOpenId} id={`m-${i}`} />
            </div>
          );
        })}
      </div>
    </section>
  );
}
