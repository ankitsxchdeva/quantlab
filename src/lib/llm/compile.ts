import { generateObject } from "ai";
import type { LanguageModel } from "ai";
import { StrategySchema, type Strategy } from "@/lib/strategy/schema";
import type { LLMProvider, LLMRequest } from "@/lib/types";
import { resolveModel } from "./providers";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompts";
import { validateStrategy } from "./validate";

export class LLMError extends Error {
  readonly provider?: LLMProvider;
  readonly cause?: unknown;
  readonly semanticErrors?: string[];
  constructor(message: string, opts?: { provider?: LLMProvider; cause?: unknown; semanticErrors?: string[] }) {
    super(message);
    this.name = "LLMError";
    this.provider = opts?.provider;
    this.cause = opts?.cause;
    this.semanticErrors = opts?.semanticErrors;
  }
}

export interface CompileResult {
  strategy: Strategy;
  raw: string;
  repaired: boolean;
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

type ErrorKind = "auth" | "rate_limit" | "schema" | "unknown";

function errorKind(err: unknown): ErrorKind {
  const msg = errorMessage(err).toLowerCase();
  const status =
    typeof err === "object" && err !== null && "statusCode" in err
      ? Number((err as { statusCode?: unknown }).statusCode)
      : typeof err === "object" && err !== null && "status" in err
        ? Number((err as { status?: unknown }).status)
        : undefined;

  if (status === 401 || status === 403 || msg.includes("invalid api key") || msg.includes("unauthorized") || msg.includes("authentication")) {
    return "auth";
  }
  if (status === 429 || msg.includes("rate limit") || msg.includes("too many requests")) {
    return "rate_limit";
  }
  if (
    msg.includes("validation") ||
    msg.includes("schema") ||
    msg.includes("no object generated") ||
    msg.includes("invalid_type") ||
    (typeof err === "object" && err !== null && "name" in err && (err as { name?: unknown }).name === "AI_NoObjectGeneratedError")
  ) {
    return "schema";
  }
  return "unknown";
}

function classifyError(err: unknown, provider: LLMProvider): LLMError {
  const kind = errorKind(err);
  switch (kind) {
    case "auth":
      return new LLMError(`Invalid API key for ${provider}`, { provider, cause: err });
    case "rate_limit": {
      const retry =
        typeof err === "object" && err !== null && "responseHeaders" in err
          ? (err as { responseHeaders?: Record<string, string> }).responseHeaders?.["retry-after"]
          : undefined;
      const hint = retry ? ` (retry after ${retry}s)` : "";
      return new LLMError(`Rate limit exceeded for ${provider}${hint}`, { provider, cause: err });
    }
    case "schema":
      return new LLMError(`LLM produced an invalid Strategy object: ${errorMessage(err)}`, { provider, cause: err });
    case "unknown":
      return new LLMError(`LLM request failed: ${errorMessage(err)}`, { provider, cause: err });
    default: {
      const _e: never = kind;
      throw new Error(`Unknown error kind: ${String(_e)}`);
    }
  }
}

function buildRepairPrompt(userPrompt: string, errors: string[]): string {
  return `${userPrompt}

Your previous Strategy JSON had these problems:
${errors.map((e) => `- ${e}`).join("\n")}

Fix every problem and return the corrected Strategy JSON object. Every { "ref": "<id>" } and bare-string reference in entries/exits must match the "id" of an indicator declared in the "indicators" array, indicator ids must not reuse price source names (open/high/low/close/volume/hl2/hlc3/ohlc4), and ids must be unique.`;
}

function generate(model: LanguageModel, promptText: string) {
  return generateObject({
    model,
    schema: StrategySchema,
    schemaName: "Strategy",
    schemaDescription: "A backtestable trading strategy in the project's DSL.",
    system: SYSTEM_PROMPT,
    prompt: promptText,
  });
}

export async function compileStrategy(req: LLMRequest): Promise<CompileResult> {
  const { provider, apiKey, model, prompt } = req;
  // Ollama is the local home-server model and takes no key.
  if (provider !== "ollama" && (!apiKey || apiKey.trim().length === 0)) {
    throw new LLMError(`Missing API key for ${provider}`, { provider });
  }
  if (!prompt || prompt.trim().length === 0) {
    throw new LLMError("Prompt is empty", { provider });
  }

  const languageModel = resolveModel(provider, apiKey, model);
  const userPrompt = buildUserPrompt(prompt);

  let firstErrors: string[];
  let firstWasSemantic = false;
  try {
    const result = await generate(languageModel, userPrompt);
    const semanticErrors = validateStrategy(result.object);
    if (semanticErrors.length === 0) {
      return { strategy: result.object, raw: JSON.stringify(result.object), repaired: false };
    }
    firstErrors = semanticErrors;
    firstWasSemantic = true;
  } catch (err: unknown) {
    if (errorKind(err) !== "schema") throw classifyError(err, provider);
    firstErrors = [errorMessage(err)];
  }

  try {
    const result = await generate(languageModel, buildRepairPrompt(userPrompt, firstErrors));
    const semanticErrors = validateStrategy(result.object);
    if (semanticErrors.length > 0) {
      throw new LLMError(
        `LLM strategy failed semantic validation even after a repair attempt: ${semanticErrors.join("; ")}`,
        { provider, semanticErrors },
      );
    }
    return { strategy: result.object, raw: JSON.stringify(result.object), repaired: true };
  } catch (err: unknown) {
    if (err instanceof LLMError) throw err;
    const kind = errorKind(err);
    if (kind === "auth" || kind === "rate_limit") throw classifyError(err, provider);
    throw new LLMError(
      `LLM strategy repair attempt failed. Original errors: ${firstErrors.join("; ")}. Repair error: ${errorMessage(err)}`,
      { provider, cause: err, semanticErrors: firstWasSemantic ? firstErrors : undefined },
    );
  }
}
