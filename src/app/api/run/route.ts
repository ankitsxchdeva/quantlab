import { NextResponse } from "next/server";
import { z } from "zod";
import { compileStrategy, LLMError } from "@/lib/llm/compile";
import { fetchBars } from "@/lib/data";
import { runBacktest } from "@/lib/backtest/engine";
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

export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: `Invalid request: ${parsed.error.issues.map((i) => i.message).join("; ")}` },
      { status: 400 },
    );
  }

  const { prompt, provider, apiKey, model } = parsed.data;

  let strategy;
  try {
    const compiled = await compileStrategy({
      provider: provider as LLMProvider,
      apiKey,
      model,
      prompt,
    });
    strategy = compiled.strategy;
  } catch (err: unknown) {
    const message = err instanceof LLMError ? err.message : err instanceof Error ? err.message : "Failed to compile strategy";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  let fetched;
  try {
    fetched = await fetchBars({
      symbol: strategy.asset,
      source: strategy.market,
      timeframe: strategy.timeframe,
      start: strategy.startDate ?? "",
      end: strategy.endDate ?? "",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch market data";
    return NextResponse.json({ error: message, strategy }, { status: 502 });
  }

  if (fetched.bars.length === 0) {
    return NextResponse.json(
      { error: `No bars returned for ${strategy.asset}`, strategy },
      { status: 502 },
    );
  }

  try {
    const result = runBacktest(strategy, fetched.bars, fetched.market);
    return NextResponse.json({ strategy, result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Backtest failed";
    return NextResponse.json({ error: message, strategy }, { status: 500 });
  }
}
