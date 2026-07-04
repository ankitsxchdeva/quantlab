import { describe, it, expect } from "vitest";
import { compileStrategy, LLMError } from "@/lib/llm/compile";
import { runBacktest } from "@/lib/backtest/engine";
import type { LLMProvider } from "@/lib/types";
import prompts from "./prompts.json";
import { syntheticStockBars, syntheticPolymarketBars } from "./synthetic";

interface EvalPrompt {
  id: string;
  group: string;
  prompt: string;
}

interface Score {
  id: string;
  group: string;
  zodValid: boolean;
  semanticValid: boolean;
  firstTry: boolean;
  repaired: boolean;
  traded: boolean;
  error?: string;
}

const corpus: EvalPrompt[] = prompts;

const PROVIDERS: { provider: LLMProvider; apiKey: string | undefined; model: string | undefined }[] = [
  { provider: "openai", apiKey: process.env.EVAL_OPENAI_KEY, model: process.env.EVAL_OPENAI_MODEL },
  { provider: "anthropic", apiKey: process.env.EVAL_ANTHROPIC_KEY, model: process.env.EVAL_ANTHROPIC_MODEL },
  { provider: "google", apiKey: process.env.EVAL_GOOGLE_KEY, model: process.env.EVAL_GOOGLE_MODEL },
];

const anyKey = PROVIDERS.some((p) => p.apiKey);
const BATCH_SIZE = 4;

const stockBars = syntheticStockBars();
const polymarketBars = syntheticPolymarketBars();

async function scorePrompt(p: EvalPrompt, provider: LLMProvider, apiKey: string, model?: string): Promise<Score> {
  try {
    const result = await compileStrategy({ provider, apiKey, model, prompt: p.prompt });
    let traded = false;
    try {
      const bars = result.strategy.market === "polymarket" ? polymarketBars : stockBars;
      traded = runBacktest(result.strategy, bars).trades.length > 0;
    } catch {
      traded = false;
    }
    return {
      id: p.id,
      group: p.group,
      zodValid: true,
      semanticValid: true,
      firstTry: !result.repaired,
      repaired: result.repaired,
      traded,
    };
  } catch (err: unknown) {
    const semanticFailure = err instanceof LLMError && err.semanticErrors !== undefined;
    return {
      id: p.id,
      group: p.group,
      zodValid: semanticFailure,
      semanticValid: false,
      firstTry: false,
      repaired: false,
      traded: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function pct(n: number, total: number): string {
  return total === 0 ? "-" : `${((100 * n) / total).toFixed(0)}%`;
}

function summarize(scores: Score[]): Record<string, unknown>[] {
  const groups = Array.from(new Set(scores.map((s) => s.group)));
  const row = (label: string, subset: Score[]) => ({
    group: label,
    prompts: subset.length,
    "zod valid": pct(subset.filter((s) => s.zodValid).length, subset.length),
    "semantic valid": pct(subset.filter((s) => s.semanticValid).length, subset.length),
    "first try": pct(subset.filter((s) => s.firstTry).length, subset.length),
    "rescued by repair": pct(subset.filter((s) => s.repaired).length, subset.length),
    "traded >= 1": pct(subset.filter((s) => s.traded).length, subset.length),
  });
  return [...groups.map((g) => row(g, scores.filter((s) => s.group === g))), row("TOTAL", scores)];
}

describe.skipIf(!anyKey)("compileStrategy eval harness", () => {
  for (const { provider, apiKey, model } of PROVIDERS) {
    describe.skipIf(!apiKey)(provider, () => {
      it(`compiles the ${corpus.length}-prompt corpus`, async () => {
        const scores: Score[] = [];
        for (let i = 0; i < corpus.length; i += BATCH_SIZE) {
          const batch = corpus.slice(i, i + BATCH_SIZE);
          const batchScores = await Promise.all(batch.map((p) => scorePrompt(p, provider, apiKey as string, model)));
          scores.push(...batchScores);
        }

        console.log(`\n=== ${provider}${model ? ` (${model})` : ""} ===`);
        console.table(summarize(scores));
        const failures = scores.filter((s) => s.error);
        if (failures.length > 0) {
          console.log("Failures:");
          for (const f of failures) {
            console.log(`  ${f.id}: ${(f.error as string).slice(0, 160)}`);
          }
        }

        expect(scores).toHaveLength(corpus.length);
      });
    });
  }
});
