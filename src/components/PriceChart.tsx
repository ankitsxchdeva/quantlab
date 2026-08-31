"use client";

import { useEffect, useRef, useState } from "react";
import type { Bar, Trade } from "@/lib/types";
import { chartTheme, withAlpha } from "@/lib/chartTheme";
import { onThemeChange } from "@/lib/theme";

interface PriceChartProps {
  bars: Bar[];
  trades: Trade[];
  symbol?: string;
  timeframe?: string;
  height?: number;
}

export default function PriceChart({ bars, trades, symbol, timeframe, height = 360 }: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Canvas can't see a theme change; bumping this rebuilds with new tokens.
  const [themeTick, setThemeTick] = useState(0);
  useEffect(() => onThemeChange(() => setThemeTick((t) => t + 1)), []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || bars.length === 0) return;

    let disposed = false;
    let cleanup: (() => void) | undefined;

    void (async () => {
      const mod = await import("lightweight-charts");
      if (disposed || !containerRef.current) return;

      // Resolved here rather than at module scope: the tokens only exist
      // once the document has a computed style.
      const { pos: POS, neg: NEG, fg: FG, muted: MUTED, border: BORDER } = chartTheme();

      const chart = mod.createChart(container, {
        width: container.clientWidth,
        height,
        layout: {
          background: { type: mod.ColorType.Solid, color: "transparent" },
          textColor: withAlpha(MUTED, 0.75),
          fontFamily: "monospace",
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

      // Candles are data, so the data hues carry them.
      const series = chart.addCandlestickSeries({
        upColor: POS,
        downColor: NEG,
        wickUpColor: POS,
        wickDownColor: NEG,
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
            color: FG,
            shape: (isLong ? "arrowUp" : "arrowDown") as "arrowUp" | "arrowDown",
            text: isLong ? "long" : "short",
          },
          {
            time: exitTime,
            position: (isLong ? "aboveBar" : "belowBar") as "belowBar" | "aboveBar",
            color: profit ? POS : NEG,
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
  }, [bars, trades, height, themeTick]);

  if (bars.length === 0) {
    return (
      <div className="border-t border-border pt-4 text-small text-muted" style={{ height }}>
        no price data.
      </div>
    );
  }

  return (
    <section className="border-t border-border pt-4">
      <div className="flex items-baseline justify-between mb-3 gap-4">
        <div className="flex items-baseline gap-3 min-w-0">
          <h3 className="text-title font-bold truncate">{symbol ?? "price"}</h3>
          <span className="text-meta font-mono tabular-nums text-dim whitespace-nowrap">
            {timeframe ? `${timeframe} · ` : ""}{bars.length.toLocaleString()} bars · {trades.length} trade{trades.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="flex items-center gap-3 text-meta text-dim">
          <span className="flex items-center gap-1.5" title="trade entry">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className="text-fg" aria-hidden="true">
              <path d="M12 4 L20 20 L4 20 Z" />
            </svg> entry
          </span>
          <span className="flex items-center gap-1.5" title="profitable exit">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className="text-data-pos" aria-hidden="true">
              <path d="M12 20 L20 4 L4 4 Z" />
            </svg> win
          </span>
          <span className="flex items-center gap-1.5" title="losing exit">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className="text-data-neg" aria-hidden="true">
              <path d="M12 20 L20 4 L4 4 Z" />
            </svg> loss
          </span>
        </div>
      </div>
      <div ref={containerRef} style={{ width: "100%", height }} />
    </section>
  );
}
