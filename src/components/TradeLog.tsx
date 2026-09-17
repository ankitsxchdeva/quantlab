"use client";

import { useState } from "react";
import type { Trade } from "@/lib/types";
import { cn, fmtDate, fmtNum, fmtPct } from "@/lib/utils";

interface TradeLogProps {
  trades: Trade[];
}

const REASON_LABEL: Record<Trade["reason"], string> = {
  signal: "signal",
  stop_loss: "stop",
  take_profit: "take",
  end_of_data: "closed",
};

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={cn("text-dim", open ? "rotate-180" : "rotate-0")}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export default function TradeLog({ trades }: TradeLogProps) {
  const [open, setOpen] = useState(true);

  const wins = trades.filter((t) => t.pnlPct > 0).length;
  const losses = trades.filter((t) => t.pnlPct < 0).length;

  return (
    <section className="border-t border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between py-3 text-left"
      >
        <div className="flex items-baseline gap-3 min-w-0">
          <h3 className="text-title font-bold text-fg">trade log</h3>
          <span className="text-meta font-mono tabular-nums text-dim whitespace-nowrap">
            {trades.length} total
            {trades.length > 0 && (
              <>
                <span className="mx-2">·</span>
                <span className="text-data-pos">{wins}w</span>
                <span className="mx-1">/</span>
                <span className="text-data-neg">{losses}l</span>
              </>
            )}
          </span>
        </div>
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div className="border-t border-border overflow-auto max-h-[480px] scroll-row">
          {trades.length === 0 ? (
            <div className="px-5 py-8 text-small text-muted text-center">
              no trades were executed. the entry rule never fired.
            </div>
          ) : (
            <table className="w-full">
              <thead className="sticky top-0 bg-bg z-10">
                <tr className="border-b border-border">
                  <th className="text-left px-2 sm:px-4 py-2 text-label text-muted font-normal hidden sm:table-cell">#</th>
                  <th className="text-left px-2 sm:px-4 py-2 text-label text-muted font-normal">side</th>
                  <th className="text-left px-2 sm:px-4 py-2 text-label text-muted font-normal">entry</th>
                  <th className="text-right px-2 sm:px-4 py-2 text-label text-muted font-normal hidden sm:table-cell">entry px</th>
                  <th className="text-left px-2 sm:px-4 py-2 text-label text-muted font-normal">exit</th>
                  <th className="text-right px-2 sm:px-4 py-2 text-label text-muted font-normal hidden sm:table-cell">exit px</th>
                  <th className="text-right px-2 sm:px-4 py-2 text-label text-muted font-normal">p&amp;l</th>
                  <th className="text-left px-2 sm:px-4 py-2 text-label text-muted font-normal hidden md:table-cell">why</th>
                </tr>
              </thead>
              <tbody className="text-small font-mono tabular-nums">
                {trades.map((t, i) => {
                  const pos = t.pnlPct >= 0;
                  return (
                    <tr key={i} className="border-b border-border last:border-b-0">
                      <td className="px-2 sm:px-4 py-2 text-dim hidden sm:table-cell">{i + 1}</td>
                      <td className="px-2 sm:px-4 py-2 text-muted">{t.side}</td>
                      <td className="px-2 sm:px-4 py-2 text-fg whitespace-nowrap">{fmtDate(t.entryTime)}</td>
                      <td className="px-2 sm:px-4 py-2 text-right text-fg hidden sm:table-cell">{fmtNum(t.entryPrice, 2)}</td>
                      <td className="px-2 sm:px-4 py-2 text-fg whitespace-nowrap">{fmtDate(t.exitTime)}</td>
                      <td className="px-2 sm:px-4 py-2 text-right text-fg hidden sm:table-cell">{fmtNum(t.exitPrice, 2)}</td>
                      <td className="px-2 sm:px-4 py-2 text-right">
                        <span className={cn("whitespace-nowrap", pos ? "text-data-pos" : "text-data-neg")}>
                          {fmtPct(t.pnlPct)}
                        </span>
                      </td>
                      <td className="px-2 sm:px-4 py-2 text-label text-dim hidden md:table-cell">{REASON_LABEL[t.reason]}</td>
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
