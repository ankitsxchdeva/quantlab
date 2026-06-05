"use client";

import { useState } from "react";
import type { Trade } from "@/lib/types";
import { cn, fmtDate, fmtNum, fmtPct } from "@/lib/utils";

interface TradeLogProps {
  trades: Trade[];
}

const REASON_LABEL: Record<Trade["reason"], string> = {
  signal: "Signal",
  stop_loss: "Stop",
  take_profit: "Take",
  end_of_data: "Closed",
};

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={cn("transition-transform duration-180 ease-out", open ? "rotate-180" : "rotate-0")}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export default function TradeLog({ trades }: TradeLogProps) {
  const [open, setOpen] = useState(true);

  const wins = trades.filter((t) => t.pnlPct > 0).length;
  const losses = trades.filter((t) => t.pnlPct < 0).length;

  return (
    <section className="panel">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-surface-2 transition-colors duration-120 ease-out rounded-t-[10px]"
      >
        <div className="flex items-baseline gap-3 min-w-0">
          <h3 className="text-sm font-medium text-text-1">Trade log</h3>
          <span className="text-xs text-text-3 font-mono tabular-nums whitespace-nowrap">
            {trades.length} total
            {trades.length > 0 && (
              <>
                <span className="mx-2 text-text-3">·</span>
                <span className="text-accent">{wins}W</span>
                <span className="mx-1 text-text-3">/</span>
                <span className="text-warning">{losses}L</span>
              </>
            )}
          </span>
        </div>
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div className="border-t border-border overflow-auto max-h-[480px] scroll-row">
          {trades.length === 0 ? (
            <div className="px-5 py-8 text-sm text-text-3 text-center">
              No trades were executed. The entry rule never fired.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface-1 z-10">
                <tr className="border-b border-border">
                  <th className="text-left px-3 sm:px-4 py-2.5 micro-label">#</th>
                  <th className="text-left px-3 sm:px-4 py-2.5 micro-label">Side</th>
                  <th className="text-left px-3 sm:px-4 py-2.5 micro-label">Entry</th>
                  <th className="text-right px-3 sm:px-4 py-2.5 micro-label hidden sm:table-cell">Entry px</th>
                  <th className="text-left px-3 sm:px-4 py-2.5 micro-label">Exit</th>
                  <th className="text-right px-3 sm:px-4 py-2.5 micro-label hidden sm:table-cell">Exit px</th>
                  <th className="text-right px-3 sm:px-4 py-2.5 micro-label">P&amp;L</th>
                  <th className="text-left px-3 sm:px-4 py-2.5 micro-label hidden md:table-cell">Why</th>
                </tr>
              </thead>
              <tbody className="font-mono tabular-nums">
                {trades.map((t, i) => {
                  const pos = t.pnlPct >= 0;
                  return (
                    <tr key={i} className="border-b border-border last:border-b-0 hover:bg-surface-2 transition-colors duration-120 ease-out">
                      <td className="px-3 sm:px-4 py-2.5 text-text-3">{i + 1}</td>
                      <td className="px-3 sm:px-4 py-2.5">
                        <span className="text-xs uppercase tracking-wider text-text-2">{t.side}</span>
                      </td>
                      <td className="px-3 sm:px-4 py-2.5 text-text-1 whitespace-nowrap">{fmtDate(t.entryTime)}</td>
                      <td className="px-3 sm:px-4 py-2.5 text-right text-text-1 hidden sm:table-cell">{fmtNum(t.entryPrice, 2)}</td>
                      <td className="px-3 sm:px-4 py-2.5 text-text-1 whitespace-nowrap">{fmtDate(t.exitTime)}</td>
                      <td className="px-3 sm:px-4 py-2.5 text-right text-text-1 hidden sm:table-cell">{fmtNum(t.exitPrice, 2)}</td>
                      <td className="px-3 sm:px-4 py-2.5 text-right">
                        <span
                          className={cn(
                            "inline-block rounded px-2 py-0.5 text-xs whitespace-nowrap",
                            pos ? "bg-accent-soft text-accent" : "bg-danger-soft text-warning",
                          )}
                        >
                          {fmtPct(t.pnlPct)}
                        </span>
                      </td>
                      <td className="px-3 sm:px-4 py-2.5 text-text-3 text-xs hidden md:table-cell">{REASON_LABEL[t.reason]}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}
