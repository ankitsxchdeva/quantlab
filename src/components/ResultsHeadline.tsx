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
                That <span className="text-accent font-medium">beat buy-and-hold by {fmtPct(delta)}</span>.
              </>
            ),
          }
        : {
            tone: "loss",
            sentence: (
              <>
                <span className="text-warning font-medium">Buy-and-hold would have made {fmtMoney(result.benchmark.finalEquity - final)} more</span> ({fmtPct(benchmarkReturn)} vs {fmtPct(strategyReturn)}).
              </>
            ),
          };

  const finalEmphasisClass = cn(
    "tabular",
    verdict.tone === "win" && "text-accent",
    verdict.tone === "loss" && "text-warning",
    verdict.tone === "even" && "text-text-1",
  );

  return (
    <section className="panel-raised relative overflow-hidden">
      <div className="absolute inset-0 grid-lines opacity-[0.18] pointer-events-none" aria-hidden="true" />
      <div className="relative px-6 py-8 sm:px-10 sm:py-10">
        <div className="flex items-center gap-2 mb-5">
          <span className="micro-label">Result</span>
          <span className="h-px w-8 bg-border" aria-hidden="true" />
          <span className="micro-label truncate max-w-[40ch]" title={strategy.name}>{strategy.name}</span>
        </div>

        <p className="text-text-2 text-base sm:text-lg mb-3">Your strategy</p>

        <p className="text-3xl sm:text-4xl lg:text-5xl leading-[1.1] tracking-tight text-text-2 font-medium">
          <span className="tabular text-text-1">{fmtMoney(initial)}</span>
          <span className="text-text-2"> → </span>
          <span className={finalEmphasisClass}>{fmtMoney(final)}</span>
        </p>

        <p className="mt-3 text-base sm:text-lg text-text-2 leading-relaxed">
          <span className="tabular">{fmtPct(strategyReturn)}</span>{" "}
          over <span className="tabular">{years.toFixed(1)}</span> years.
          {" "}
          {verdict.sentence}
        </p>

        <div className="mt-5 pt-5 border-t border-border flex flex-wrap items-baseline gap-x-5 gap-y-1.5 text-sm text-text-3">
          <span>
            <span className="tabular text-text-2">{result.metrics.totalTrades.toLocaleString()}</span> trade{result.metrics.totalTrades === 1 ? "" : "s"}
          </span>
          <span className="text-border" aria-hidden="true">·</span>
          <span>{span.replace(/^over [^ ]+ years? of /, "").replace(/^over [^ ]+ months? of /, "").replace(/^over \d+ days? of /, "")}</span>
        </div>
      </div>
    </section>
  );
}
