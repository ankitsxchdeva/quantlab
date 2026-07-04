"use client";

import { useEffect, useRef } from "react";
import type { BenchmarkResult, EquityPoint } from "@/lib/types";
import type { MonteCarloBandPoint } from "@/lib/backtest/montecarlo";

interface EquityChartProps {
  equity: EquityPoint[];
  benchmark?: BenchmarkResult;
  bands?: MonteCarloBandPoint[];
  height?: number;
}

const ACCENT = "#3ec27a";
const ACCENT_FILL_TOP = "rgba(62, 194, 122, 0.32)";
const ACCENT_FILL_BOTTOM = "rgba(62, 194, 122, 0.02)";
const FAN_FILL = "rgba(62, 194, 122, 0.10)";
const FAN_EDGE = "rgba(62, 194, 122, 0.28)";
const NEUTRAL_LINE = "#857d72";
const TEXT_2 = "#a9a298";
const BORDER = "#36312a";
const SURFACE_1 = "#221f1a";

export default function EquityChart({ equity, benchmark, bands, height = 280 }: EquityChartProps) {
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

      // Monte Carlo percentile fan, drawn first so everything else sits on
      // top. lightweight-charts has no band series, so the 5-95% band is an
      // area fill at p95 masked below p5 with a background-colored fill.
      if (bands && bands.length > 1) {
        const toPoint = (value: number, p: MonteCarloBandPoint) => ({
          time: Math.floor(p.time / 1000) as never,
          value,
        });
        const fanOptions = {
          lineWidth: 1 as const,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        };
        const fanTop = chart.addAreaSeries({
          ...fanOptions,
          lineColor: FAN_EDGE,
          topColor: FAN_FILL,
          bottomColor: FAN_FILL,
        });
        fanTop.setData(bands.map((p) => toPoint(p.p95, p)));
        const fanMask = chart.addAreaSeries({
          ...fanOptions,
          lineColor: FAN_EDGE,
          topColor: SURFACE_1,
          bottomColor: SURFACE_1,
        });
        fanMask.setData(bands.map((p) => toPoint(p.p5, p)));
        const fanMedian = chart.addLineSeries({
          ...fanOptions,
          color: FAN_EDGE,
          lineStyle: 2,
        });
        fanMedian.setData(bands.map((p) => toPoint(p.p50, p)));
      }

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
        topColor: ACCENT_FILL_TOP,
        bottomColor: ACCENT_FILL_BOTTOM,
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
  }, [equity, benchmark, bands, height]);

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
          {bands && bands.length > 1 && (
            <span className="flex items-center gap-1.5 text-text-3">
              <span
                className="inline-block w-2.5 h-2.5 rounded-[3px]"
                style={{ backgroundColor: FAN_FILL, border: `1px solid ${FAN_EDGE}` }}
                aria-hidden="true"
              />{" "}
              Monte Carlo 5-95%
            </span>
          )}
        </div>
      </div>
      <div ref={containerRef} style={{ width: "100%", height }} />
    </section>
  );
}
