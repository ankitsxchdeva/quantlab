"use client";

import type { BacktestResult } from "@/lib/types";
import type { Strategy } from "@/lib/strategy/schema";
import { cn, fmtMoney, fmtPct } from "@/lib/utils";

interface ResultsHeadlineProps {
  result: BacktestResult;
  strategy: Strategy;
}

function spanYears(start: number, end: number): number {
  return (end - start) / (365.25 * 24 * 60 * 60 * 1000);
}

function spanDescription(years: number, timeframe: string, barCount: number): string {
  if (years >= 1) {
    return `over ${years.toFixed(1)} years of ${timeframe} bars (${barCount.toLocaleString()} total)`;
  }
  const days = years * 365.25;
  if (days >= 30) {
    return `over ${(days / 30).toFixed(1)} months of ${timeframe} bars (${barCount.toLocaleString()} total)`;
  }
  return `over ${Math.round(days)} days of ${timeframe} bars (${barCount.toLocaleString()} total)`;
}

export default function ResultsHeadline({ result, strategy }: ResultsHeadlineProps) {
  const initial = result.metrics.initialEquity;
  const final = result.metrics.finalEquity;
  const strategyReturn = result.metrics.totalReturnPct;
  const benchmarkReturn = result.benchmark.totalReturnPct;
  const delta = strategyReturn - benchmarkReturn;

  const bars = result.bars;
  const years = bars.length > 0 ? spanYears(bars[0].time, bars[bars.length - 1].time) : 0;
  const span = bars.length > 0 ? spanDescription(years, strategy.timeframe, bars.length) : "with no usable bars";

  const beatBy = Math.abs(delta);
  const verdict: { tone: "win" | "even" | "loss"; sentence: React.ReactNode } =
    beatBy < 5
      ? {
          tone: "even",
          sentence: (
            <>
              Roughly matched buy-and-hold ({fmtPct(benchmarkReturn)}).
            </>
          ),
        }
      : delta > 0
        ? {
            tone: "win",
            sentence: (
              <>
                That <span className="text-accent">beat buy-and-hold by {fmtPct(delta)}</span>.
              </>
            ),
          }
        : {
            tone: "loss",
            sentence: (
              <>
                <span className="text-warning">Buy-and-hold would have made {fmtMoney(result.benchmark.finalEquity - final)} more</span> ({fmtPct(benchmarkReturn)} vs {fmtPct(strategyReturn)}).
              </>
            ),
          };

  const verb = strategyReturn >= 0 ? "Turned" : "Took";
  const finalEmphasisClass = cn(
    "tabular text-text-1",
    verdict.tone === "win" && "text-accent",
    verdict.tone === "loss" && "text-warning",
  );

  return (
    <section className="panel-raised relative overflow-hidden">
      <div className="absolute inset-0 grid-lines opacity-[0.15] pointer-events-none" aria-hidden="true" />
      <div className="relative px-6 py-7 sm:px-8 sm:py-9">
        <div className="flex items-center gap-2 mb-4">
          <span className="micro-label">Result</span>
          <span className="h-px w-8 bg-border" aria-hidden="true" />
          <span className="micro-label">{strategy.name}</span>
        </div>

        <p className="text-2xl sm:text-3xl leading-tight tracking-tight text-text-2">
          <span className="text-text-1">{verb}</span>{" "}
          <span className="tabular text-text-1">{fmtMoney(initial)}</span>{" "}
          <span className="text-text-1">into</span>{" "}
          <span className={finalEmphasisClass}>{fmtMoney(final)}</span>
          <span className="text-text-2"> ({fmtPct(strategyReturn)}).</span>
        </p>

        <p className="mt-3 text-base sm:text-lg text-text-2 leading-relaxed">
          {verdict.sentence}
        </p>

        <p className="mt-4 text-sm text-text-3">
          {result.metrics.totalTrades.toLocaleString()} trade{result.metrics.totalTrades === 1 ? "" : "s"} {span}.
        </p>
      </div>
    </section>
  );
}
