import { generateObject } from "ai";
import { StrategySchema, type Strategy } from "@/lib/strategy/schema";
import type { LLMProvider, LLMRequest } from "@/lib/types";
import { resolveModel } from "./providers";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompts";

export class LLMError extends Error {
  readonly provider?: LLMProvider;
  readonly cause?: unknown;
  constructor(message: string, opts?: { provider?: LLMProvider; cause?: unknown }) {
    super(message);
    this.name = "LLMError";
    this.provider = opts?.provider;
    this.cause = opts?.cause;
  }
}

export interface CompileResult {
  strategy: Strategy;
  raw: string;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function classifyError(err: unknown, provider: LLMProvider): LLMError {
  const msg = errorMessage(err).toLowerCase();
  const status =
    typeof err === "object" && err !== null && "statusCode" in err
      ? Number((err as { statusCode?: unknown }).statusCode)
      : typeof err === "object" && err !== null && "status" in err
        ? Number((err as { status?: unknown }).status)
        : undefined;

  if (status === 401 || status === 403 || msg.includes("invalid api key") || msg.includes("unauthorized") || msg.includes("authentication")) {
    return new LLMError(`Invalid API key for ${provider}`, { provider, cause: err });
  }
  if (status === 429 || msg.includes("rate limit") || msg.includes("too many requests")) {
    const retry =
      typeof err === "object" && err !== null && "responseHeaders" in err
        ? (err as { responseHeaders?: Record<string, string> }).responseHeaders?.["retry-after"]
        : undefined;
    const hint = retry ? ` (retry after ${retry}s)` : "";
    return new LLMError(`Rate limit exceeded for ${provider}${hint}`, { provider, cause: err });
  }
  if (
    msg.includes("validation") ||
    msg.includes("schema") ||
    msg.includes("no object generated") ||
    msg.includes("invalid_type") ||
    (typeof err === "object" && err !== null && "name" in err && (err as { name?: unknown }).name === "AI_NoObjectGeneratedError")
  ) {
    return new LLMError(`LLM produced an invalid Strategy object: ${errorMessage(err)}`, { provider, cause: err });
  }
  return new LLMError(`LLM request failed: ${errorMessage(err)}`, { provider, cause: err });
}

export async function compileStrategy(req: LLMRequest): Promise<CompileResult> {
  const { provider, apiKey, model, prompt } = req;
  if (!apiKey || apiKey.trim().length === 0) {
    throw new LLMError(`Missing API key for ${provider}`, { provider });
  }
  if (!prompt || prompt.trim().length === 0) {
    throw new LLMError("Prompt is empty", { provider });
  }

  const languageModel = resolveModel(provider, apiKey, model);
  const userPrompt = buildUserPrompt(prompt);

  try {
    const result = await generateObject({
      model: languageModel,
      schema: StrategySchema,
      schemaName: "Strategy",
      schemaDescription: "A backtestable trading strategy in the project's DSL.",
      system: SYSTEM_PROMPT,
      prompt: userPrompt,
    });
    return {
      strategy: result.object,
      raw: JSON.stringify(result.object),
    };
  } catch (err: unknown) {
    throw classifyError(err, provider);
  }
}
