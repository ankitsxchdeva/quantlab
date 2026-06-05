"use client";

import { useEffect, useRef } from "react";
import type { BenchmarkResult, EquityPoint } from "@/lib/types";

interface EquityChartProps {
  equity: EquityPoint[];
  benchmark?: BenchmarkResult;
  height?: number;
}

const ACCENT = "oklch(0.78 0.16 145)";
const NEUTRAL_LINE = "oklch(0.55 0.008 80)";
const TEXT_2 = "oklch(0.72 0.008 80)";
const BORDER = "oklch(0.30 0.006 80)";
const SURFACE_1 = "oklch(0.20 0.006 80)";

export default function EquityChart({ equity, benchmark, height = 280 }: EquityChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || equity.length === 0) return;

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

      if (benchmark && benchmark.equity.length > 0) {
        const bench = chart.addLineSeries({
          color: NEUTRAL_LINE,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          lineStyle: 2,
        });
        bench.setData(
          benchmark.equity.map((p) => ({
            time: Math.floor(p.time / 1000) as never,
            value: p.equity,
          })),
        );
      }

      const series = chart.addAreaSeries({
        lineColor: ACCENT,
        topColor: "color-mix(in oklch, oklch(0.78 0.16 145) 35%, transparent)",
        bottomColor: "color-mix(in oklch, oklch(0.78 0.16 145) 2%, transparent)",
        lineWidth: 2,
        priceLineVisible: false,
      });

      series.setData(
        equity.map((p) => ({
          time: Math.floor(p.time / 1000) as never,
          value: p.equity,
        })),
      );

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
  }, [equity, benchmark, height]);

  if (equity.length === 0) {
    return (
      <div className="panel p-5 text-sm text-text-3" style={{ height }}>
        No equity data.
      </div>
    );
  }

  return (
    <section className="panel p-4">
      <div className="flex items-baseline justify-between mb-3 gap-4">
        <h3 className="text-sm font-medium text-text-1">Equity curve</h3>
        <div className="flex items-center gap-4 text-xs">
          <span className="flex items-center gap-1.5 text-text-2">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-accent" aria-hidden="true" /> Your strategy
          </span>
          {benchmark && benchmark.equity.length > 0 && (
            <span className="flex items-center gap-1.5 text-text-3">
              <span className="inline-block w-2.5 h-[1.5px] rounded-full bg-text-3" aria-hidden="true" /> Buy &amp; hold
            </span>
          )}
        </div>
      </div>
      <div ref={containerRef} style={{ width: "100%", height }} />
    </section>
  );
}
