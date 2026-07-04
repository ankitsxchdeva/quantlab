import type { Bar, MarketResolution } from "@/lib/types";

export interface FetchResult {
  bars: Bar[];
  market: MarketResolution;
}

export const FETCH_TIMEOUT_MS = 15_000;

export function parseDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function fetchWithTimeout(url: string, init: RequestInit, timeoutMessage: string): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (err: unknown) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new Error(timeoutMessage);
    }
    throw err;
  }
}
