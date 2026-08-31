"use client";

import type { RobustnessReport, RobustnessVerdict, SegmentSummary } from "@/lib/backtest/robustness";
import { cn, fmtNum, fmtPct } from "@/lib/utils";

interface RobustnessCardProps {
  report: RobustnessReport;
}

type Tone = "win" | "even" | "loss";

const VERDICT_COPY: Record<RobustnessVerdict, { title: string; tone: Tone; sentence: (oosPct: number) => string }> = {
  holds: {
    title: "holds up out of sample",
    tone: "win",
    sentence: (oosPct) =>
      `This edge held up in the ${oosPct} percent of history the strategy never saw. That is the strongest evidence a backtest can offer.`,
  },
  degrades: {
    title: "degrades out of sample",
    tone: "even",
    sentence: (oosPct) =>
      `The edge weakened in the ${oosPct} percent of history the strategy never saw. Something may be there, but expect thinner returns than the headline.`,
  },
  collapses: {
    title: "collapses out of sample",
    tone: "loss",
    sentence: (oosPct) =>
      `The edge vanished in the ${oosPct} percent of history the strategy never saw. What looked like signal was probably luck.`,
  },
};

function SegmentStat({ label, segment }: { label: string; segment: SegmentSummary }) {
  return (
    <div>
      <div className="text-label text-muted">{label}</div>
      <div
        className={cn(
          "mt-1.5 text-lede font-bold font-mono tabular-nums",
          segment.totalReturnPct > 0 && "text-data-pos",
          segment.totalReturnPct < 0 && "text-data-neg",
          segment.totalReturnPct === 0 && "text-fg",
        )}
      >
        {fmtPct(segment.totalReturnPct)}
      </div>
      <div className="mt-1 text-meta text-dim">
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
    <section className="border-t border-border pt-4">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="flex items-baseline gap-2">
          <span className="text-label text-muted">robustness check</span>
          {split && (
            <span className="text-meta text-dim">
              trained on {split.splitPct}%, tested on {100 - split.splitPct}%
            </span>
          )}
        </div>
        {copy && (
          <span
            className={cn(
              "text-small font-bold",
              copy.tone === "win" && "text-data-pos",
              copy.tone === "even" && "text-muted",
              copy.tone === "loss" && "text-data-neg",
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
              "text-lede font-bold",
              copy.tone === "win" && "text-data-pos",
              copy.tone === "even" && "text-muted",
              copy.tone === "loss" && "text-data-neg",
            )}
          >
            {copy.title}
          </h3>
          <p className="mt-1.5 text-small text-muted leading-relaxed max-w-[68ch]">{copy.sentence(100 - split.splitPct)}</p>
        </>
      )}

      <div className="mt-4 pt-4 border-t border-border grid grid-cols-2 lg:grid-cols-4 gap-x-5 gap-y-4">
        {split && (
          <>
            <SegmentStat label="in sample" segment={split.inSample} />
            <SegmentStat label="out of sample" segment={split.outOfSample} />
          </>
        )}
        {monteCarlo && (
          <>
            <div>
              <div className="text-label text-muted">worst-case drawdown</div>
              <div className="mt-1.5 text-lede font-bold font-mono tabular-nums text-data-warn">
                -{fmtNum(monteCarlo.maxDrawdownPct.p95, 1)}%
              </div>
              <div className="mt-1 text-meta text-dim">worst 5% of reshuffles fell at least this far</div>
            </div>
            <div>
              <div className="text-label text-muted">odds of losing money</div>
              <div
                className={cn(
                  "mt-1.5 text-lede font-bold font-mono tabular-nums",
                  monteCarlo.probLossPct > 50 ? "text-data-neg" : monteCarlo.probLossPct > 20 ? "text-fg" : "text-data-pos",
                )}
              >
                {fmtNum(monteCarlo.probLossPct, 1)}%
              </div>
              <div className="mt-1 text-meta text-dim">
                of {monteCarlo.runs.toLocaleString()} reshuffles of the same {monteCarlo.tradeCount} trades ended below the starting stake
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
