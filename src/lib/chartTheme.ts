/**
 * Chart colors, resolved from the real CSS tokens (Colophon v0.4 §5).
 *
 * lightweight-charts paints to a canvas and takes concrete color strings, so it
 * cannot consume `var(--accent)` the way the DOM does. Reading the tokens back
 * out of the document keeps a single source of truth: change a token in
 * globals.css and the charts follow. Callers re-resolve on theme change via
 * onThemeChange (src/lib/theme.ts); never hardcode a hex in a chart file.
 */

/**
 * Resolve one custom property to a concrete `rgb(r, g, b)` string.
 *
 * Painting one pixel and reading it back makes the browser do the color-space
 * conversion and always yields sRGB components, which is both canvas-safe and
 * safe to decompose (see `withAlpha`). It also fails loudly: an unparseable
 * value leaves `fillStyle` at the sentinel, which we detect and fall back from.
 */
function resolveToken(name: string, fallback: string): string {
  if (typeof window === "undefined" || typeof document === "undefined") return fallback;

  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!raw) return fallback;

  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return fallback;

  // Deliberately a colour no token in the family could be, so a legitimately
  // resolved token can never be mistaken for a parse failure.
  const sentinel = "#ff00ff";
  ctx.fillStyle = sentinel;
  ctx.fillStyle = raw;
  // fillStyle silently ignores values it cannot parse, so an unchanged
  // sentinel means this token is not something the canvas renderer accepts.
  if (ctx.fillStyle === sentinel) return fallback;

  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Restate a resolved `rgb(r, g, b)` at a given alpha. Area fills and the Monte
 * Carlo fan are constant low-alpha tints of their series color (the gradient
 * ban applies to canvas too), so they derive from the tokens rather than
 * written-out literals.
 */
export function withAlpha(rgb: string, alpha: number): string {
  const parts = rgb.match(/-?[\d.]+/g);
  if (!parts || parts.length < 3) return rgb;
  const [r, g, b] = parts;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export interface ChartTheme {
  /** the one licensed accent series: the strategy's own equity curve */
  accent: string;
  /** data hues (§5): up/down series, candles, trade markers */
  pos: string;
  neg: string;
  warn: string;
  /** neutral comparison series: benchmark, Monte Carlo bands */
  bench: string;
  /** axis labels sit one rung down the dimming ladder */
  muted: string;
  /** trade entry markers: ink, neither accent nor a data hue */
  fg: string;
  /** grid, crosshair: the hairline color */
  border: string;
  /** page background, for masking (the fan trick paints bg-colored fills) */
  bg: string;
}

/**
 * Call inside the effect that builds the chart, never at module scope: the
 * tokens only exist once the document has a computed style.
 *
 * Fallbacks are the dark-theme token values as of writing. They only apply if
 * a property is missing entirely, so they should never render, but a chart
 * with slightly stale colors beats a chart that throws.
 */
export function chartTheme(): ChartTheme {
  return {
    accent: resolveToken("--accent", "rgb(139, 135, 200)"),
    pos: resolveToken("--data-pos", "rgb(127, 185, 138)"),
    neg: resolveToken("--data-neg", "rgb(217, 112, 102)"),
    warn: resolveToken("--data-warn", "rgb(217, 168, 92)"),
    bench: resolveToken("--data-bench", "rgb(110, 106, 133)"),
    muted: resolveToken("--muted", "rgb(142, 138, 171)"),
    fg: resolveToken("--fg", "rgb(232, 228, 244)"),
    border: resolveToken("--border", "rgb(65, 63, 84)"),
    bg: resolveToken("--bg", "rgb(30, 28, 34)"),
  };
}
