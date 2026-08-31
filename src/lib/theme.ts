/**
 * Theme state (Colophon §1, Twin Theme + Small-Choices-Persist).
 *
 * The choice persists in localStorage and lands as data-theme on <html>;
 * with no choice stored, the CSS follows prefers-color-scheme. The inline
 * script in layout.tsx applies the persisted value before first paint.
 *
 * Charts paint to canvas and resolve tokens at runtime, so they cannot see a
 * theme change on their own: setTheme dispatches "quantlab:theme" and chart
 * components rebuild through onThemeChange.
 */

export type Theme = "light" | "dark";

const THEME_KEY = "quantlab.theme";
export const THEME_EVENT = "quantlab:theme";

/** The theme currently in effect: the stored choice, else the OS. */
export function currentTheme(): Theme {
  if (typeof document === "undefined") return "light";
  const t = document.documentElement.dataset.theme;
  if (t === "light" || t === "dark") return t;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function setTheme(t: Theme): void {
  document.documentElement.dataset.theme = t;
  try {
    window.localStorage.setItem(THEME_KEY, t);
  } catch {
    // storage blocked: the theme still applies for this session
  }
  window.dispatchEvent(new Event(THEME_EVENT));
}

/** Subscribe to theme changes; returns the unsubscribe. */
export function onThemeChange(cb: () => void): () => void {
  window.addEventListener(THEME_EVENT, cb);
  return () => window.removeEventListener(THEME_EVENT, cb);
}
