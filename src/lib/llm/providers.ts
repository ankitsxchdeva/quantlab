import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import type { LLMProvider } from "@/lib/types";

export const DEFAULT_MODELS: Record<LLMProvider, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-sonnet-4-6",
  google: "gemini-2.0-flash",
};

export function resolveModel(provider: LLMProvider, apiKey: string, model?: string): LanguageModel {
  const modelId = model && model.trim().length > 0 ? model.trim() : DEFAULT_MODELS[provider];
  switch (provider) {
    case "openai": {
      const client = createOpenAI({ apiKey });
      return client(modelId);
    }
    case "anthropic": {
      const client = createAnthropic({ apiKey });
      return client(modelId);
    }
    case "google": {
      const client = createGoogleGenerativeAI({ apiKey });
      return client(modelId);
    }
    default: {
      const exhaustive: never = provider;
      throw new Error(`Unknown LLM provider: ${String(exhaustive)}`);
    }
  }
}
