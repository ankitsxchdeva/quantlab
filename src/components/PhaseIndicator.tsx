"use client";

import { useEffect, useState } from "react";

interface PhaseIndicatorProps {
  active: boolean;
}

const PHASES = [
  "Reading your idea",
  "Fetching market history",
  "Simulating every trade",
] as const;

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
    <div className="panel px-5 py-4 animate-fade-in" role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <span className="inline-flex h-2 w-2 shrink-0 rounded-full bg-accent animate-pulse-soft" aria-hidden="true" />
          <span className="text-sm text-text-1 truncate">{PHASES[phase]}</span>
        </div>
        <span className="micro-label shrink-0">{phase + 1} / {PHASES.length}</span>
      </div>
      <div className="mt-3 h-[2px] w-full overflow-hidden rounded-full bg-border" aria-hidden="true">
        <div className="h-full w-1/3 bg-accent animate-sweep rounded-full" />
      </div>
    </div>
  );
}
