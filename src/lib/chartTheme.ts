/**
 * Chart colors, resolved from the real CSS tokens.
 *
 * lightweight-charts paints to a canvas and takes concrete color strings, so it
 * cannot consume `var(--accent)` the way the DOM does. Both chart components
 * previously hardcoded hex literals copied out of DESIGN.md's hex column, and
 * every one of them was a different color from the token it named: the charts
 * drew their background at #221f1a while `--surface-1` actually resolves to
 * #171613, so each plot area sat a visible shade lighter than the panel
 * wrapping it.
 *
 * Reading the tokens back out of the document removes the second source of
 * truth entirely. Change a token in globals.css and the charts follow.
 */

/**
 * Resolve one custom property to a concrete `rgb(r, g, b)` string.
 *
 * The raw token value is an `oklch()` expression. Canvas does parse those in
 * current browsers, so passing one straight through would render correctly, but
 * it would still be the wrong thing to return: `getComputedStyle` preserves the
 * colour space rather than converting, so callers get an `oklch(...)` string
 * back and anything that tries to take it apart (see `withAlpha`) reads the
 * lightness as a red channel.
 *
 * Painting one pixel and reading it back makes the browser do the conversion
 * and always yields sRGB components, which is both canvas-safe and safe to
 * decompose. It also fails loudly rather than silently: an unparseable value
 * leaves `fillStyle` at the sentinel, which we detect and fall back from.
 */
function resolveToken(name: string, fallback: string): string {
  if (typeof window === "undefined" || typeof document === "undefined") return fallback;

  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!raw) return fallback;

  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return fallback;

  // Deliberately a colour no token in a warm-neutral palette could be, so a
  // legitimately-resolved token can never be mistaken for a parse failure.
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
 * Restate a resolved `rgb(r, g, b)` at a given alpha.
 *
 * The area fills and Monte Carlo fan are tints of the accent, so they have to
 * be derived from it rather than written out as their own literals, or they
 * drift the moment the accent moves.
 */
export function withAlpha(rgb: string, alpha: number): string {
  const parts = rgb.match(/-?[\d.]+/g);
  if (!parts || parts.length < 3) return rgb;
  const [r, g, b] = parts;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export interface ChartTheme {
  accent: string;
  warning: string;
  benchmark: string;
  text2: string;
  border: string;
  surface1: string;
}

/**
 * Call inside the effect that builds the chart, never at module scope: the
 * tokens only exist once the document has a computed style.
 *
 * Fallbacks are the sRGB equivalents of the tokens as of writing. They only
 * apply if a property is missing entirely, so they should never render, but a
 * chart with slightly stale colors beats a chart that throws.
 */
export function chartTheme(): ChartTheme {
  return {
    accent: resolveToken("--accent", "rgb(110, 210, 116)"),
    warning: resolveToken("--warning", "rgb(238, 177, 84)"),
    benchmark: resolveToken("--chart-benchmark", "rgb(139, 134, 128)"),
    text2: resolveToken("--text-2", "rgb(167, 164, 159)"),
    border: resolveToken("--border", "rgb(47, 45, 42)"),
    surface1: resolveToken("--surface-1", "rgb(23, 22, 19)"),
  };
}
