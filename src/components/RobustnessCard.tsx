"use client";

import type { RobustnessReport, RobustnessVerdict, SegmentSummary } from "@/lib/backtest/robustness";
import { cn, fmtNum, fmtPct } from "@/lib/utils";

interface RobustnessCardProps {
  report: RobustnessReport;
}

type Tone = "win" | "even" | "loss";

const VERDICT_COPY: Record<RobustnessVerdict, { title: string; tone: Tone; sentence: (oosPct: number) => string }> = {
  holds: {
    title: "Holds up out of sample",
    tone: "win",
    sentence: (oosPct) =>
      `This edge held up in the ${oosPct} percent of history the strategy never saw. That is the strongest evidence a backtest can offer.`,
  },
  degrades: {
    title: "Degrades out of sample",
    tone: "even",
    sentence: (oosPct) =>
      `The edge weakened in the ${oosPct} percent of history the strategy never saw. Something may be there, but expect thinner returns than the headline.`,
  },
  collapses: {
    title: "Collapses out of sample",
    tone: "loss",
    sentence: (oosPct) =>
      `The edge vanished in the ${oosPct} percent of history the strategy never saw. What looked like signal was probably luck.`,
  },
};

function SegmentStat({ label, segment }: { label: string; segment: SegmentSummary }) {
  return (
    <div>
      <div className="micro-label">{label}</div>
      <div
        className={cn(
          "mt-2 text-xl sm:text-2xl font-mono tabular-nums",
          segment.totalReturnPct > 0 && "text-accent",
          segment.totalReturnPct < 0 && "text-warning",
          segment.totalReturnPct === 0 && "text-text-1",
        )}
      >
        {fmtPct(segment.totalReturnPct)}
      </div>
      <div className="mt-1 text-xs text-text-3">
        vs {fmtPct(segment.buyHoldReturnPct)} buy &amp; hold, {segment.trades} trade{segment.trades === 1 ? "" : "s"}
      </div>
    </div>
  );
}

export default function RobustnessCard({ report }: RobustnessCardProps) {
  const { split, monteCarlo } = report;
  if (!split && !monteCarlo) return null;

  const copy = split ? VERDICT_COPY[split.verdict] : null;

  return (
    <section className="panel p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="flex items-center gap-2">
          <span className="micro-label">Robustness check</span>
          <span className="h-px w-8 bg-border" aria-hidden="true" />
          {split && (
            <span className="micro-label">
              trained on {split.splitPct}%, tested on {100 - split.splitPct}%
            </span>
          )}
        </div>
        {copy && (
          <span
            className={cn(
              "inline-block rounded px-2 py-0.5 text-xs font-medium",
              copy.tone === "win" && "bg-accent-soft text-accent",
              copy.tone === "even" && "bg-surface-2 text-text-2",
              copy.tone === "loss" && "bg-danger-soft text-warning",
            )}
          >
            {split!.verdict}
          </span>
        )}
      </div>

      {copy && split && (
        <>
          <h3
            className={cn(
              "text-lg sm:text-xl font-medium tracking-tight",
              copy.tone === "win" && "text-accent",
              copy.tone === "even" && "text-text-1",
              copy.tone === "loss" && "text-warning",
            )}
          >
            {copy.title}
          </h3>
          <p className="mt-1.5 text-sm text-text-2 leading-relaxed max-w-prose">{copy.sentence(100 - split.splitPct)}</p>
        </>
      )}

      <div className="mt-4 pt-4 border-t border-border grid grid-cols-2 lg:grid-cols-4 gap-x-5 gap-y-4">
        {split && (
          <>
            <SegmentStat label="In sample" segment={split.inSample} />
            <SegmentStat label="Out of sample" segment={split.outOfSample} />
          </>
        )}
        {monteCarlo && (
          <>
            <div>
              <div className="micro-label">Worst-case drawdown</div>
              <div className="mt-2 text-xl sm:text-2xl font-mono tabular-nums text-warning">
                -{fmtNum(monteCarlo.maxDrawdownPct.p95, 1)}%
              </div>
              <div className="mt-1 text-xs text-text-3">worst 5% of reshuffles fell at least this far</div>
            </div>
            <div>
              <div className="micro-label">Odds of losing money</div>
              <div
                className={cn(
                  "mt-2 text-xl sm:text-2xl font-mono tabular-nums",
                  monteCarlo.probLossPct > 50 ? "text-warning" : monteCarlo.probLossPct > 20 ? "text-text-1" : "text-accent",
                )}
              >
                {fmtNum(monteCarlo.probLossPct, 1)}%
              </div>
              <div className="mt-1 text-xs text-text-3">
                of {monteCarlo.runs.toLocaleString()} reshuffles of the same {monteCarlo.tradeCount} trades ended below the starting stake
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
