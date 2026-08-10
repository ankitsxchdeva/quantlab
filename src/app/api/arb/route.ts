import { NextResponse } from "next/server";
import { z } from "zod";
import { checkParlay, scanForArbitrage } from "@/lib/arb/scan";
import { preflight, withCors } from "@/lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Kalshi market data is public, so this route takes no API key of any kind.
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

    const result = await scanForArbitrage(parsed.data);
    return NextResponse.json({ mode: "scan", ...result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Kalshi request failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
