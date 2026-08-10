import { NextResponse } from "next/server";
import { z } from "zod";
import { checkHandListedParlay, checkParlay, scanForArbitrage } from "@/lib/arb/scan";
import { scanConstraints } from "@/lib/arb/constraints";
import { preflight, withCors } from "@/lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Kalshi market data is public, so the scan and check modes take no key at all.
// Only `resolve` needs one, because recovering a hand-listed parlay's legs from
// prose requires an LLM. As everywhere else, the key is the caller's, is used
// for that one request, and is never stored.
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
    provider: z.enum(["openai", "anthropic", "google"]),
    apiKey: z.string().min(1),
    model: z.string().optional(),
    maxPages: z.number().int().min(1).max(40).optional(),
  }),
]);

const RATE_LIMIT = 6;
const RATE_WINDOW_MS = 60_000;
const rateBuckets = new Map<string, number[]>();

function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "local";
}

function isRateLimited(ip: string, now: number): boolean {
  const times = (rateBuckets.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  const limited = times.length >= RATE_LIMIT;
  if (!limited) times.push(now);
  rateBuckets.set(ip, times);
  return limited;
}

export function OPTIONS(req: Request): NextResponse {
  return preflight(req);
}

export async function POST(req: Request): Promise<NextResponse> {
  return withCors(await handleArb(req), req);
}

async function handleArb(req: Request): Promise<NextResponse> {
  const now = Date.now();
  if (isRateLimited(clientIp(req), now)) {
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
    }

    const result = await scanForArbitrage(parsed.data);
    return NextResponse.json({ mode: "scan", ...result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Kalshi request failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
