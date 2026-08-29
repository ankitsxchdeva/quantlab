import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { compileStrategy, LLMError } from "@/lib/llm/compile";
import { fetchBars } from "@/lib/data";
import { runBacktest } from "@/lib/backtest/engine";
import { assessRobustness, type RobustnessReport } from "@/lib/backtest/robustness";
import { runMonteCarlo } from "@/lib/backtest/montecarlo";
import { preflight, withCors } from "@/lib/cors";
import { clientIp, createRateLimiter } from "@/lib/ratelimit";
import type { LLMProvider } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RequestSchema = z.object({
  prompt: z.string().min(1).max(8000),
  provider: z.enum(["openai", "anthropic", "google", "ollama"]),
  // Optional because the local Ollama provider ignores it; compileStrategy
  // rejects an empty key for the hosted providers.
  apiKey: z.string().optional().default(""),
  model: z.string().optional(),
});

const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

const limiter = createRateLimiter(RATE_LIMIT, RATE_WINDOW_MS);

// The ollama provider runs a 27B model on one home GPU: inference is serial
// and a compile takes ~10-30s. Three guards, cheapest first: a global hourly
// cap (bounds sustained abuse even from rotating IPs), a stricter per-IP
// limit, and a concurrency cap (the GPU does 1-2 inferences well, not 10).
// Every limit message points at the BYOK settings path.
const OLLAMA_RATE_LIMIT = 5;
const OLLAMA_GLOBAL_LIMIT = 60;
const OLLAMA_GLOBAL_WINDOW_MS = 3_600_000;
const OLLAMA_MAX_CONCURRENT = 2;
const ollamaLimiter = createRateLimiter(OLLAMA_RATE_LIMIT, RATE_WINDOW_MS);
const ollamaGlobalLimiter = createRateLimiter(OLLAMA_GLOBAL_LIMIT, OLLAMA_GLOBAL_WINDOW_MS);
let ollamaInFlight = 0;

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

  if (limiter.isLimited(ip, Date.now())) {
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
  const isLocal = provider === "ollama";

  if (isLocal) {
    if (ollamaGlobalLimiter.isLimited("global", Date.now())) {
      log(429, { error: "local_global_capped" });
      return NextResponse.json(
        { error: "The local model has reached its hourly limit. Try again later — or open Settings and use your own provider key (OpenAI, Anthropic, or Google)." },
        { status: 429 },
      );
    }
    if (ollamaLimiter.isLimited(ip, Date.now())) {
      log(429, { error: "local_rate_limited" });
      return NextResponse.json(
        { error: `Too many local-model runs from this address. The limit is ${OLLAMA_RATE_LIMIT} per minute — open Settings and use your own provider key for unlimited runs.` },
        { status: 429 },
      );
    }
    if (ollamaInFlight >= OLLAMA_MAX_CONCURRENT) {
      log(429, { error: "local_model_busy" });
      return NextResponse.json(
        { error: "The local model is busy with another run — try again in a few seconds, or use your own provider key in Settings." },
        { status: 429 },
      );
    }
    ollamaInFlight += 1;
  }

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
  } finally {
    if (isLocal) ollamaInFlight -= 1;
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
