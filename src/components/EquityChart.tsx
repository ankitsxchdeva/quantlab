"use client";

import { useEffect, useRef, useState } from "react";
import type { BenchmarkResult, EquityPoint } from "@/lib/types";
import type { MonteCarloBandPoint } from "@/lib/backtest/montecarlo";
import { chartTheme, withAlpha } from "@/lib/chartTheme";
import { onThemeChange } from "@/lib/theme";

interface EquityChartProps {
  equity: EquityPoint[];
  benchmark?: BenchmarkResult;
  bands?: MonteCarloBandPoint[];
  height?: number;
}


export default function EquityChart({ equity, benchmark, bands, height = 280 }: EquityChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Canvas can't see a theme change; bumping this rebuilds with new tokens.
  const [themeTick, setThemeTick] = useState(0);
  useEffect(() => onThemeChange(() => setThemeTick((t) => t + 1)), []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || equity.length === 0) return;

    let disposed = false;
    let cleanup: (() => void) | undefined;

    void (async () => {
      const mod = await import("lightweight-charts");
      if (disposed || !containerRef.current) return;

      // Resolved here rather than at module scope: the tokens only exist
      // once the document has a computed style.
      const {
        accent: ACCENT,
        bench: BENCH,
        muted: MUTED,
        border: BORDER,
        bg: BG,
      } = chartTheme();

      // Constant low-alpha tints of their series color; the gradient ban
      // applies to canvas too.
      const ACCENT_FILL = withAlpha(ACCENT, 0.15);
      const FAN_FILL = withAlpha(BENCH, 0.1);
      const FAN_EDGE = withAlpha(BENCH, 0.35);

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
          topColor: BG,
          bottomColor: BG,
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
          color: BENCH,
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

      // The strategy's own curve is the subject: the one licensed accent series.
      const series = chart.addAreaSeries({
        lineColor: ACCENT,
        topColor: ACCENT_FILL,
        bottomColor: ACCENT_FILL,
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
  }, [equity, benchmark, bands, height, themeTick]);

  if (equity.length === 0) {
    return (
      <div className="border-t border-border pt-4 text-small text-muted" style={{ height }}>
        no equity data.
      </div>
    );
  }

  return (
    <section className="border-t border-border pt-4">
      <div className="flex items-baseline justify-between mb-3 gap-4">
        <h3 className="text-title font-bold">equity curve</h3>
        <div className="flex items-center gap-4 text-meta">
          <span className="flex items-center gap-1.5 text-muted">
            <span className="inline-block w-2.5 h-[2px] bg-accent" aria-hidden="true" /> your strategy
          </span>
          {benchmark && benchmark.equity.length > 0 && (
            <span className="flex items-center gap-1.5 text-dim">
              {/* Same token the series is drawn with, so the key matches the line. */}
              <span className="inline-block w-2.5 h-[1.5px] bg-data-bench" aria-hidden="true" /> buy
              &amp; hold
            </span>
          )}
          {bands && bands.length > 1 && (
            <span className="flex items-center gap-1.5 text-dim">
              {/* This swatch is DOM, not canvas, so it reads the token directly
                  at the same alphas the fan is painted with. */}
              <span
                className="inline-block w-2.5 h-2.5 rounded-[2px]"
                style={{
                  backgroundColor: "color-mix(in srgb, var(--data-bench) 10%, transparent)",
                  border: "1px solid color-mix(in srgb, var(--data-bench) 35%, transparent)",
                }}
                aria-hidden="true"
              />{" "}
              monte carlo 5-95%
            </span>
          )}
        </div>
      </div>
      <div ref={containerRef} style={{ width: "100%", height }} />
    </section>
  );
}
