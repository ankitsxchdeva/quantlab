import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import type { LLMProvider } from "@/lib/types";

export const DEFAULT_MODELS: Record<LLMProvider, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-sonnet-5",
  google: "gemini-2.0-flash",
  ollama: process.env.OLLAMA_MODEL ?? "muse-glimmer:30b-q4_K_M",
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
      // Local LLM server (Mac Studio, oMLX now — Ollama before it). The
      // OpenAI-compatible /v1 needs a bearer when the server enforces one.
      const baseURL = process.env.OLLAMA_BASE_URL ?? "https://ollama.ankit.casa/v1";
      const client = createOpenAI({ baseURL, apiKey: process.env.OLLAMA_API_KEY ?? "ollama" });
      return client(modelId);
    }
    default: {
      const exhaustive: never = provider;
      throw new Error(`Unknown LLM provider: ${String(exhaustive)}`);
    }
  }
}
