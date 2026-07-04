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
    <section className="panel px-4 py-3 flex items-center gap-2.5 text-sm">
      <span
        className={cn("inline-block w-2 h-2 rounded-full shrink-0", open ? "bg-accent animate-pulse-soft" : "bg-text-3")}
        aria-hidden="true"
      />
      {open ? (
        <span className="text-text-2">
          If run live, this strategy would be{" "}
          <span className={cn("font-medium", open.side === "long" ? "text-accent" : "text-warning")}>
            {open.side.toUpperCase()}
          </span>{" "}
          <span className="text-text-1">{assetLabel}</span> since{" "}
          <span className="font-mono tabular-nums text-text-1">{fmtDate(open.entryTime)}</span>.
        </span>
      ) : (
        <span className="text-text-2">
          If run live, this strategy would be <span className="text-text-1 font-medium">flat</span> right now.{" "}
          {trades.length === 0 ? "No entry signal has fired yet." : "The last signal closed its position."}
        </span>
      )}
    </section>
  );
}
