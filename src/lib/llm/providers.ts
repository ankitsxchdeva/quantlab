import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import type { LLMProvider } from "@/lib/types";

export const DEFAULT_MODELS: Record<LLMProvider, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-sonnet-5",
  google: "gemini-2.0-flash",
  ollama: "qwen3.8:27b",
};

export function resolveModel(provider: LLMProvider, apiKey: string, model?: string): LanguageModel {
  // Visitors can't choose which model the local server runs: the ollama
  // provider is pinned to the one model the Studio serves, so the model field
  // can't be used to probe the box or trigger pulls of arbitrary models.
  const modelId =
    provider === "ollama"
      ? DEFAULT_MODELS.ollama
      : model && model.trim().length > 0
        ? model.trim()
        : DEFAULT_MODELS[provider];
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
    case "ollama": {
      // Local Ollama on the home server (Mac Studio, Metal GPU). Its
      // OpenAI-compatible /v1 ignores the key, but the AI SDK requires one.
      const baseURL = process.env.OLLAMA_BASE_URL ?? "https://ollama.ankit.casa/v1";
      const client = createOpenAI({ baseURL, apiKey: "ollama" });
      return client(modelId);
    }
    default: {
      const exhaustive: never = provider;
      throw new Error(`Unknown LLM provider: ${String(exhaustive)}`);
    }
  }
}
