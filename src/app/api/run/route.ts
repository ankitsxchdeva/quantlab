import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { compileStrategy, LLMError } from "@/lib/llm/compile";
import { fetchBars } from "@/lib/data";
import { runBacktest } from "@/lib/backtest/engine";
import { assessRobustness, type RobustnessReport } from "@/lib/backtest/robustness";
import { runMonteCarlo } from "@/lib/backtest/montecarlo";
import { preflight, withCors } from "@/lib/cors";
import type { LLMProvider } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RequestSchema = z.object({
  prompt: z.string().min(1).max(8000),
  provider: z.enum(["openai", "anthropic", "google"]),
  apiKey: z.string().min(1),
  model: z.string().optional(),
});

const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

// Per-instance in-memory limiter. For multi-instance deploys, swap this Map
// for a shared store (Redis / Upstash) keyed the same way.
const rateBuckets = new Map<string, number[]>();
let lastSweep = 0;

function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "local";
}

function isRateLimited(ip: string, now: number): boolean {
  if (now - lastSweep > RATE_WINDOW_MS) {
    lastSweep = now;
    for (const [key, times] of rateBuckets) {
      const fresh = times.filter((t) => now - t < RATE_WINDOW_MS);
      if (fresh.length === 0) rateBuckets.delete(key);
      else rateBuckets.set(key, fresh);
    }
  }
  const times = (rateBuckets.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  const limited = times.length >= RATE_LIMIT;
  if (!limited) times.push(now);
  rateBuckets.set(ip, times);
  return limited;
}

interface Timings {
  compileMs: number;
  fetchMs: number;
  backtestMs: number;
}

export function OPTIONS(req: Request): NextResponse {
  return preflight(req);
}

// The UI is served cross-origin from GitHub Pages, so every exit path needs
// CORS headers. Wrapping once here beats threading them through each return.
export async function POST(req: Request): Promise<NextResponse> {
  return withCors(await handleRun(req), req);
}

async function handleRun(req: Request): Promise<NextResponse> {
  const requestId = randomUUID();
  const ip = clientIp(req);
  const timings: Timings = { compileMs: 0, fetchMs: 0, backtestMs: 0 };

  // One structured line per request. The apiKey is deliberately never logged.
  const log = (status: number, extra: Record<string, unknown> = {}): void => {
    console.log(JSON.stringify({ msg: "api/run", requestId, ip, status, timings, ...extra }));
  };

  if (isRateLimited(ip, Date.now())) {
    log(429, { error: "rate_limited" });
    return NextResponse.json(
      { error: `Too many runs from this address. The limit is ${RATE_LIMIT} per minute; please wait a moment and try again.` },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    log(400, { error: "invalid_json" });
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    log(400, { error: "invalid_request" });
    return NextResponse.json(
      { error: `Invalid request: ${parsed.error.issues.map((i) => i.message).join("; ")}` },
      { status: 400 },
    );
  }

  const { prompt, provider, apiKey, model } = parsed.data;

  let strategy;
  const compileStart = performance.now();
  try {
    const compiled = await compileStrategy({
      provider: provider as LLMProvider,
      apiKey,
      model,
      prompt,
    });
    strategy = compiled.strategy;
    timings.compileMs = Math.round(performance.now() - compileStart);
  } catch (err: unknown) {
    timings.compileMs = Math.round(performance.now() - compileStart);
    const message = err instanceof LLMError ? err.message : err instanceof Error ? err.message : "Failed to compile strategy";
    log(400, { provider, promptLength: prompt.length, error: message });
    return NextResponse.json({ error: message }, { status: 400 });
  }

  let fetched;
  const fetchStart = performance.now();
  try {
    fetched = await fetchBars({
      symbol: strategy.asset,
      source: strategy.market,
      timeframe: strategy.timeframe,
      start: strategy.startDate ?? "",
      end: strategy.endDate ?? "",
    });
    timings.fetchMs = Math.round(performance.now() - fetchStart);
  } catch (err: unknown) {
    timings.fetchMs = Math.round(performance.now() - fetchStart);
    const message = err instanceof Error ? err.message : "Failed to fetch market data";
    log(502, { provider, asset: strategy.asset, error: message });
    return NextResponse.json({ error: message, strategy }, { status: 502 });
  }

  if (fetched.bars.length === 0) {
    log(502, { provider, asset: strategy.asset, error: "no_bars" });
    return NextResponse.json(
      { error: `No bars returned for ${strategy.asset}`, strategy },
      { status: 502 },
    );
  }

  const backtestStart = performance.now();
  try {
    const result = runBacktest(strategy, fetched.bars, fetched.market);

    // Robustness is additive: only meaningful with enough closed trades to
    // resample, and never worth failing an otherwise good run over.
    let robustness: RobustnessReport | undefined;
    if (result.trades.length >= 5) {
      try {
        robustness = {
          split: assessRobustness(strategy, fetched.bars),
          monteCarlo: runMonteCarlo(result.trades, result.metrics.initialEquity),
        };
      } catch {
        robustness = undefined;
      }
    }

    timings.backtestMs = Math.round(performance.now() - backtestStart);
    log(200, {
      provider,
      asset: strategy.asset,
      bars: fetched.bars.length,
      trades: result.trades.length,
      ...(robustness?.split ? { verdict: robustness.split.verdict } : {}),
    });
    return NextResponse.json({ strategy, result, requestId, timings, ...(robustness ? { robustness } : {}) });
  } catch (err: unknown) {
    timings.backtestMs = Math.round(performance.now() - backtestStart);
    const message = err instanceof Error ? err.message : "Backtest failed";
    log(500, { provider, asset: strategy.asset, error: message });
    return NextResponse.json({ error: message, strategy }, { status: 500 });
  }
}
