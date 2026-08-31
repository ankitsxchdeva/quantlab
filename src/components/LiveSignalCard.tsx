"use client";

import type { Trade } from "@/lib/types";
import { cn, fmtDate } from "@/lib/utils";

interface LiveSignalCardProps {
  trades: Trade[];
  assetLabel: string;
}

export default function LiveSignalCard({ trades, assetLabel }: LiveSignalCardProps) {
  const last = trades.length > 0 ? trades[trades.length - 1] : null;
  // An end_of_data exit means the engine force-closed a position that was
  // still open when the history ran out; live, it would still be on.
  const open = last && last.reason === "end_of_data" ? last : null;

  return (
    <section className="border-y border-border py-3 flex items-baseline gap-2.5 text-small">
      {open ? (
        <span className="text-muted">
          if run live, this strategy would be{" "}
          <span className={cn("font-bold", open.side === "long" ? "text-data-pos" : "text-data-neg")}>
            {open.side}
          </span>{" "}
          <span className="text-fg">{assetLabel}</span> since{" "}
          <span className="font-mono tabular-nums text-fg">{fmtDate(open.entryTime)}</span>.
        </span>
      ) : (
        <span className="text-muted">
          if run live, this strategy would be <span className="text-fg font-bold">flat</span> right now.{" "}
          {trades.length === 0 ? "no entry signal has fired yet." : "the last signal closed its position."}
        </span>
      )}
    </section>
  );
}
