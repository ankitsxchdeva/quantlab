"use client";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
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

function MetricCell({
  cell,
  openId,
  setOpenId,
  id,
  rank,
}: {
  cell: Cell;
  openId: string | null;
  setOpenId: Dispatch<SetStateAction<string | null>>;
  id: string;
  rank: "primary" | "supporting";
}) {
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
          "font-mono tabular-nums",
          // 2.25rem against 1.125rem. The verdict metrics have to win the
          // glance; a flat scale across all twelve makes the reader do the
          // ranking work themselves.
          rank === "primary" ? "mt-2.5 text-2xl sm:text-3xl" : "mt-2 text-base sm:text-lg",
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
          className="absolute z-20 top-full mt-2 left-0 right-0 sm:left-auto sm:right-auto sm:min-w-[260px] sm:max-w-[300px] panel-overlay px-3 py-2.5 text-xs text-text-2 leading-relaxed animate-fade-in"
        >
          {cell.tooltip}
        </div>
      )}
    </div>
  );
}

export default function MetricsCards({ metrics }: MetricsCardsProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const sectionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!openId) return;
    function onDocClick(e: MouseEvent) {
      if (!sectionRef.current) return;
      if (e.target instanceof Node && !sectionRef.current.contains(e.target)) {
        setOpenId(null);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenId(null);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [openId]);

  // The four that answer "did this work, and could I have lived through it".
  // Everything else explains or qualifies them.
  const primary: Cell[] = [
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
  ];

  const supporting: Cell[] = [
    {
      label: "Sortino",
      value: fmtNum(metrics.sortino, 2),
      tone: toneFromSign(metrics.sortino),
      tooltip: "Like Sharpe, but only downside volatility counts against you; upside swings are free. Usually higher than Sharpe for the same strategy.",
    },
    {
      label: "Win rate",
      value: `${fmtNum(metrics.winRatePct, 1)}%`,
      hint: `${metrics.totalTrades} trade${metrics.totalTrades === 1 ? "" : "s"}`,
      tooltip: "Share of trades that closed in profit. Less important than profit factor; many profitable strategies win only 30 to 40 percent of the time.",
    },
    {
      label: "Profit factor",
      value: metrics.profitFactor === null ? "n/a" : fmtNum(metrics.profitFactor, 2),
      tone: metrics.profitFactor === null ? "neutral" : metrics.profitFactor >= 1 ? "pos" : "neg",
      hint: metrics.profitFactor === null && metrics.totalTrades > 0 ? "no losing trades" : undefined,
      tooltip: "Total profit divided by total loss. Above 1 means winners outpaced losers. Above 2 is strong. Below 1 means the strategy bled. n/a means there were no losing trades to divide by.",
    },
    {
      label: "Avg win",
      value: fmtPct(metrics.avgWinPct),
      tone: metrics.avgWinPct > 0 ? "pos" : "neutral",
      tooltip: "Average percentage gain across winning trades.",
    },
    {
      label: "Avg loss",
      value: fmtPct(metrics.avgLossPct),
      tone: metrics.avgLossPct < 0 ? "neg" : "neutral",
      tooltip: "Average percentage loss across losing trades. Healthy strategies keep this smaller than the average win, or win often enough to cover it.",
    },
    {
      label: "Best trade",
      value: fmtPct(metrics.bestTradePct),
      tone: metrics.bestTradePct > 0 ? "pos" : "neutral",
      tooltip: "The single best trade, in percent.",
    },
    {
      label: "Worst trade",
      value: fmtPct(metrics.worstTradePct),
      tone: metrics.worstTradePct < 0 ? "neg" : "neutral",
      tooltip: "The single worst trade, in percent. A preview of the bad day this strategy will eventually hand you.",
    },
    {
      label: "Time in market",
      value: `${fmtNum(metrics.exposurePct, 0)}%`,
      hint: `${metrics.totalTrades.toLocaleString()} total`,
      tooltip: "Fraction of bars the strategy held a position. Low exposure with decent returns can mean better risk-adjusted performance.",
    },
  ];

  // Both grids use column counts that divide their cell count exactly, so the
  // rules stay pure index math at every breakpoint: a left border unless first
  // in the row, a top border unless in the first row. The primary row also
  // carries more padding, so the hierarchy reads in the spacing as well as the
  // type scale.
  return (
    <section ref={sectionRef} className="panel overflow-visible">
      <div className="grid grid-cols-2 lg:grid-cols-4">
        {primary.map((c, i) => (
          <div
            key={c.label}
            className={cn(
              "px-4 py-5 sm:px-6 sm:py-6 relative border-border",
              i % 2 !== 0 ? "border-l" : "border-l-0",
              i % 4 !== 0 ? "lg:border-l" : "lg:border-l-0",
              i >= 2 ? "border-t" : "border-t-0",
              "lg:border-t-0",
            )}
          >
            <MetricCell cell={c} openId={openId} setOpenId={setOpenId} id={`m-p${i}`} rank="primary" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 border-t border-border">
        {supporting.map((c, i) => (
          <div
            key={c.label}
            className={cn(
              "px-4 py-4 sm:px-5 relative border-border",
              i % 2 !== 0 ? "border-l" : "border-l-0",
              i % 4 !== 0 ? "sm:border-l" : "sm:border-l-0",
              i >= 2 ? "border-t" : "border-t-0",
              i >= 4 ? "sm:border-t" : "sm:border-t-0",
            )}
          >
            <MetricCell cell={c} openId={openId} setOpenId={setOpenId} id={`m-s${i}`} rank="supporting" />
          </div>
        ))}
      </div>
    </section>
  );
}
