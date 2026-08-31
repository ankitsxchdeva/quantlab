"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface PhaseIndicatorProps {
  active: boolean;
}

const PHASES = [
  "reading your idea",
  "fetching market history",
  "simulating every trade",
] as const;

/*
 * Progress (Colophon §3): a staged text list (pending one rung down, active
 * full ink, done muted) plus a thin accent bar. Indeterminate motion is
 * opacity-only; no spinners, no position motion, no invented percentages.
 */
export default function PhaseIndicator({ active }: PhaseIndicatorProps) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (!active) {
      setPhase(0);
      return;
    }
    let i = 0;
    const id = window.setInterval(() => {
      i = Math.min(i + 1, PHASES.length - 1);
      setPhase(i);
    }, 1500);
    return () => window.clearInterval(id);
  }, [active]);

  if (!active) return null;

  return (
    <div className="border-t border-border pt-4 animate-rise" role="status" aria-live="polite">
      <ol className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-small">
        {PHASES.map((p, i) => (
          <li
            key={p}
            className={cn(
              i < phase && "text-muted",
              i === phase && "text-fg",
              i > phase && "text-dim",
            )}
          >
            {p}
          </li>
        ))}
      </ol>
      <div className="mt-3 h-[2px] w-full bg-border" aria-hidden="true">
        <div className="h-full w-full bg-accent animate-pulse-soft" />
      </div>
    </div>
  );
}
