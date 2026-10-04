import { NextResponse } from "next/server";
import { z } from "zod";
import { checkHandListedParlay, checkParlay, scanForArbitrage } from "@/lib/arb/scan";
import { scanConstraints } from "@/lib/arb/constraints";
import { preflight, withCors } from "@/lib/cors";
import { clientIp, createRateLimiter } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Kalshi market data is public, so the scan and check modes take no key at all.
// Only `resolve` touches an LLM, because recovering a hand-listed parlay's legs
// from prose takes a model. The demo provider runs that on the local GPU with
// no key; for hosted providers the key is the caller's, is used for that one
// request, and is never stored.
const RequestSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("scan"),
    maxPages: z.number().int().min(1).max(60).optional(),
    legBudget: z.number().int().min(1).max(600).optional(),
    minSize: z.number().min(0).optional(),
  }),
  z.object({
    mode: z.literal("check"),
    ticker: z.string().min(1).max(120),
  }),
  z.object({
    mode: z.literal("constraints"),
    maxPages: z.number().int().min(1).max(40).optional(),
    seriesBudget: z.number().int().min(1).max(200).optional(),
    minSize: z.number().min(0).optional(),
  }),
  z.object({
    mode: z.literal("resolve"),
    ticker: z.string().min(1).max(120),
    provider: z.enum(["openai", "anthropic", "google", "ollama"]),
    // Optional because the local Ollama provider ignores it; the handler
    // rejects an empty key for the hosted providers.
    apiKey: z.string().optional().default(""),
    model: z.string().optional(),
    maxPages: z.number().int().min(1).max(40).optional(),
  }),
]);

const RATE_LIMIT = 6;
const RATE_WINDOW_MS = 60_000;

const limiter = createRateLimiter(RATE_LIMIT, RATE_WINDOW_MS);

// Ollama resolves run two generations on the same home GPU as /api/run, so the
// demo path gets the same shape of guard: a stricter per-IP limit and one
// resolve at a time.
const OLLAMA_RESOLVE_LIMIT = 3;
const ollamaResolveLimiter = createRateLimiter(OLLAMA_RESOLVE_LIMIT, RATE_WINDOW_MS);
let ollamaResolveBusy = false;

export function OPTIONS(req: Request): NextResponse {
  return preflight(req);
}

export async function POST(req: Request): Promise<NextResponse> {
  return withCors(await handleArb(req), req);
}

async function handleArb(req: Request): Promise<NextResponse> {
  const now = Date.now();
  if (limiter.isLimited(clientIp(req), now)) {
    return NextResponse.json(
      { error: "Too many scans. The exchange crawl is heavy; try again in a minute." },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Bad request." }, { status: 400 });
  }

  try {
    if (parsed.data.mode === "check") {
      const { evaluation, parlay, legs } = await checkParlay(parsed.data.ticker);
      return NextResponse.json({
        mode: "check",
        evaluation,
        parlay: {
          ticker: parlay.ticker,
          title: parlay.title ?? "",
          status: parlay.status,
          legCount: parlay.mve_selected_legs?.length ?? 0,
        },
        legs: legs.map((l) => ({
          ticker: l.ticker,
          title: l.title ?? l.yes_sub_title ?? "",
          status: l.status,
          result: l.result ?? "",
        })),
      });
    }

    if (parsed.data.mode === "constraints") {
      const result = await scanConstraints(parsed.data);
      return NextResponse.json({ mode: "constraints", ...result });
    }

    if (parsed.data.mode === "resolve") {
      const { ticker, provider, apiKey, model, maxPages } = parsed.data;
      if (provider !== "ollama" && apiKey.trim().length === 0) {
        return NextResponse.json({ error: "Missing API key for the chosen provider." }, { status: 400 });
      }
      if (provider === "ollama") {
        if (ollamaResolveLimiter.isLimited(clientIp(req), now)) {
          return NextResponse.json(
            { error: "Too many local-model runs from this address. Use your own provider key in Settings for unlimited runs." },
            { status: 429 },
          );
        }
        if (ollamaResolveBusy) {
          return NextResponse.json(
            { error: "The local model is busy with another run. Try again in a few seconds, or use your own provider key in Settings." },
            { status: 429 },
          );
        }
        ollamaResolveBusy = true;
      }
      try {
        const { parlay, resolution, evaluation, legs } = await checkHandListedParlay({
          ticker,
          provider,
          apiKey,
          model,
          maxPages,
        });
        return NextResponse.json({
          mode: "resolve",
          resolution,
          evaluation,
          parlay: {
            ticker: parlay.ticker,
            title: parlay.title ?? "",
            status: parlay.status,
            rules: parlay.rules_primary ?? "",
          },
          legs: legs.map((l) => ({
            ticker: l.ticker,
            title: l.title ?? l.yes_sub_title ?? "",
            status: l.status,
            result: l.result ?? "",
          })),
        });
      } finally {
        if (provider === "ollama") ollamaResolveBusy = false;
      }
    }

    const result = await scanForArbitrage(parsed.data);
    return NextResponse.json({ mode: "scan", ...result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Kalshi request failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
