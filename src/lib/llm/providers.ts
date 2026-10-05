import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import type { LLMProvider } from "@/lib/types";

export const DEFAULT_MODELS: Record<LLMProvider, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-sonnet-5",
  google: "gemini-2.0-flash",
  ollama: "muse-glimmer:30b-q4_K_M",
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
      // muse-glimmer is a reasoning model: uncapped reasoning pushes compiles
      // past the ~60s the public proxy path allows a buffered response (the
      // connection dies at exactly 60s with a 499). Cap effort to "low" —
      // codegen doesn't need deep thinking.
      const lowEffort: typeof fetch = (input, init) => {
        if (init?.body && typeof init.body === "string") {
          try {
            const body = JSON.parse(init.body) as Record<string, unknown>;
            body.think = "low";
            init = { ...init, body: JSON.stringify(body) };
          } catch {
            // Not a JSON body; pass through untouched.
          }
        }
        return fetch(input, init);
      };
      const client = createOpenAI({ baseURL, apiKey: "ollama", fetch: lowEffort });
      return client(modelId);
    }
    default: {
      const exhaustive: never = provider;
      throw new Error(`Unknown LLM provider: ${String(exhaustive)}`);
    }
  }
}
