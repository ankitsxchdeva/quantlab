"use client";

import { useEffect, useRef } from "react";
import type { Bar, Trade } from "@/lib/types";

interface PriceChartProps {
  bars: Bar[];
  trades: Trade[];
  symbol?: string;
  timeframe?: string;
  height?: number;
}

const ACCENT = "oklch(0.78 0.16 145)";
const WARNING = "oklch(0.80 0.13 75)";
const TEXT_2 = "oklch(0.72 0.008 80)";
const BORDER = "oklch(0.30 0.006 80)";
const SURFACE_1 = "oklch(0.20 0.006 80)";

export default function PriceChart({ bars, trades, symbol, timeframe, height = 360 }: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || bars.length === 0) return;

    let disposed = false;
    let cleanup: (() => void) | undefined;

    void (async () => {
      const mod = await import("lightweight-charts");
      if (disposed || !containerRef.current) return;

      const chart = mod.createChart(container, {
        width: container.clientWidth,
        height,
        layout: {
          background: { color: SURFACE_1 },
          textColor: TEXT_2,
          fontFamily: "var(--font-mono), ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 11,
        },
        grid: {
          vertLines: { color: BORDER },
          horzLines: { color: BORDER },
        },
        rightPriceScale: { borderColor: BORDER },
        timeScale: { borderColor: BORDER, timeVisible: false, secondsVisible: false },
        crosshair: { mode: 1 },
        autoSize: false,
      });

      const series = chart.addCandlestickSeries({
        upColor: ACCENT,
        downColor: WARNING,
        wickUpColor: ACCENT,
        wickDownColor: WARNING,
        borderVisible: false,
      });

      series.setData(
        bars.map((b) => ({
          time: Math.floor(b.time / 1000) as never,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
        })),
      );

      const markers = trades.flatMap((t) => {
        const entryTime = Math.floor(t.entryTime / 1000) as never;
        const exitTime = Math.floor(t.exitTime / 1000) as never;
        const isLong = t.side === "long";
        const profit = t.pnlPct >= 0;
        return [
          {
            time: entryTime,
            position: (isLong ? "belowBar" : "aboveBar") as "belowBar" | "aboveBar",
            color: ACCENT,
            shape: (isLong ? "arrowUp" : "arrowDown") as "arrowUp" | "arrowDown",
            text: isLong ? "Long" : "Short",
          },
          {
            time: exitTime,
            position: (isLong ? "aboveBar" : "belowBar") as "belowBar" | "aboveBar",
            color: profit ? ACCENT : WARNING,
            shape: (isLong ? "arrowDown" : "arrowUp") as "arrowUp" | "arrowDown",
            text: `${profit ? "+" : ""}${t.pnlPct.toFixed(2)}%`,
          },
        ];
      });
      markers.sort((a, b) => (a.time as number) - (b.time as number));
      series.setMarkers(markers);

      chart.timeScale().fitContent();

      const ro = new ResizeObserver(() => {
        if (!containerRef.current) return;
        chart.applyOptions({ width: containerRef.current.clientWidth });
      });
      ro.observe(container);

      cleanup = () => {
        ro.disconnect();
        chart.remove();
      };
    })();

    return () => {
      disposed = true;
      if (cleanup) cleanup();
    };
  }, [bars, trades, height]);

  if (bars.length === 0) {
    return (
      <div className="panel p-5 text-sm text-text-3" style={{ height }}>
        No price data.
      </div>
    );
  }

  return (
    <section className="panel p-4">
      <div className="flex items-baseline justify-between mb-3 gap-4">
        <div className="flex items-baseline gap-3 min-w-0">
          <h3 className="text-sm font-medium text-text-1 truncate">{symbol ?? "Price"}</h3>
          <span className="text-xs font-mono tabular-nums text-text-3 whitespace-nowrap">
            {timeframe ? `${timeframe} · ` : ""}{bars.length.toLocaleString()} bars · {trades.length} trade{trades.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-text-3">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full bg-accent" aria-hidden="true" /> Long
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full bg-warning" aria-hidden="true" /> Loss
          </span>
        </div>
      </div>
      <div ref={containerRef} style={{ width: "100%", height }} />
    </section>
  );
}
