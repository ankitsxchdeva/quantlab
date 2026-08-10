// Where the API lives.
//
// Empty string means same-origin, which is what `npm run dev` and the Docker
// image both want. The GitHub Pages build is static-only and has no API, so it
// bakes the tunnel origin in at build time via NEXT_PUBLIC_API_BASE.
//
// The localStorage override exists so a Pages build can be pointed at a
// different backend (a laptop, a second tunnel) without rebuilding.
const BAKED = (process.env.NEXT_PUBLIC_API_BASE ?? "").replace(/\/+$/, "");

export const API_BASE_OVERRIDE_KEY = "quantlab.apiBase";

export function apiBase(): string {
  if (typeof window !== "undefined") {
    const override = window.localStorage.getItem(API_BASE_OVERRIDE_KEY);
    if (override) return override.replace(/\/+$/, "");
  }
  return BAKED;
}

export function apiUrl(path: string): string {
  return `${apiBase()}${path}`;
}
