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

  const grossReturn = result.metrics.grossTotalReturnPct;
  const totalCosts = result.metrics.totalCosts;
  const costsMoved = totalCosts > 0 && Math.abs(grossReturn - strategyReturn) >= 0.05;

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
              roughly matched buy-and-hold ({fmtPct(benchmarkReturn)}).
            </>
          ),
        }
      : delta > 0
        ? {
            tone: "win",
            sentence: (
              <>
                that <span className="text-data-pos font-bold">beat buy-and-hold by {fmtPct(delta)}</span>.
              </>
            ),
          }
        : {
            tone: "loss",
            sentence: (
              <>
                <span className="text-data-neg font-bold">buy-and-hold would have made {fmtMoney(result.benchmark.finalEquity - final)} more</span> ({fmtPct(benchmarkReturn)} vs {fmtPct(strategyReturn)}).
              </>
            ),
          };

  const finalEmphasisClass = cn(
    verdict.tone === "win" && "text-data-pos",
    verdict.tone === "loss" && "text-data-neg",
    verdict.tone === "even" && "text-fg",
  );

  return (
    <section className="border-t border-border pt-5">
      <div className="flex items-baseline gap-2 text-label text-muted">
        <span>result</span>
        <span className="mark" aria-hidden="true">·</span>
        <span className="truncate" title={strategy.name}>{strategy.name}</span>
      </div>

      <p className="mt-4 text-display font-mono tabular-nums">
        <span className="text-muted">{fmtMoney(initial)}</span>
        <span className="text-dim"> → </span>
        <span className={finalEmphasisClass}>{fmtMoney(final)}</span>
      </p>

      <p className="mt-2 text-lede text-muted">
        <span className="tabular">{fmtPct(strategyReturn)}</span>{" "}
        over <span className="tabular">{years.toFixed(1)}</span> years.{" "}
        {verdict.sentence}
      </p>

      {costsMoved && (
        <p className="mt-1.5 text-small text-dim">
          Gross <span className="tabular">{fmtPct(grossReturn)}</span>, net{" "}
          <span className="tabular">{fmtPct(strategyReturn)}</span> after{" "}
          <span className="tabular">{fmtMoney(totalCosts)}</span> in costs.
        </p>
      )}

      <div className="mt-5 pt-4 border-t border-border flex flex-wrap items-baseline gap-x-4 gap-y-1 text-meta text-dim">
        <span>
          <span className="tabular text-muted">{result.metrics.totalTrades.toLocaleString()}</span> trade{result.metrics.totalTrades === 1 ? "" : "s"}
        </span>
        <span className="mark" aria-hidden="true">·</span>
        <span>{span.replace(/^over [^ ]+ years? of /, "").replace(/^over [^ ]+ months? of /, "").replace(/^over \d+ days? of /, "")}</span>
      </div>
    </section>
  );
}
