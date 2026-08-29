import { execFile } from "node:child_process";

import type { Bar, MarketResolution } from "@/lib/types";

export interface FetchResult {
  bars: Bar[];
  market: MarketResolution;
}

export const FETCH_TIMEOUT_MS = 15_000;

/**
 * Yahoo 429s Node's HTTP client (undici) while curl from the same host — same
 * egress IP, same UA string — succeeds. Verified 2026-08-29 from both the Pi
 * and a laptop on the same LAN: TLS-fingerprint filtering, not rate or IP
 * based. Extra browser headers don't help. So Yahoo fetches shell out to curl
 * (present in the runtime image); every other source keeps using undici.
 *
 * execFile with an argv array: no shell, and the URL is built server-side from
 * a schema-validated symbol, so nothing visitor-controlled reaches a shell.
 */
export function fetchViaCurl(url: string, headers: Record<string, string>, timeoutMessage: string): Promise<Response> {
  const args = ["-sS", "--max-time", String(FETCH_TIMEOUT_MS / 1000), "-o", "-", "-w", "\n%{http_code}"];
  for (const [k, v] of Object.entries(headers)) args.push("-H", `${k}: ${v}`);
  args.push(url);

  return new Promise((resolve, reject) => {
    execFile("curl", args, { maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => {
      if (err) {
        reject(new Error(/timed out/i.test(err.message) ? timeoutMessage : `curl failed: ${err.message}`));
        return;
      }
      const m = stdout.match(/\n(\d{3})$/);
      const status = m ? Number(m[1]) : 502;
      const body = m ? stdout.slice(0, m.index) : stdout;
      resolve(new Response(body, { status }));
    });
  });
}

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
