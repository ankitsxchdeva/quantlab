import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Strategy } from "@/lib/strategy/schema";

const generateObjectMock = vi.fn();

vi.mock("ai", () => ({
  generateObject: (args: unknown) => generateObjectMock(args),
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => (modelId: string) => ({ provider: "openai", modelId })),
}));
vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn(() => (modelId: string) => ({ provider: "anthropic", modelId })),
}));
vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: vi.fn(() => (modelId: string) => ({ provider: "google", modelId })),
}));

import { compileStrategy, LLMError } from "./compile";
import { SYSTEM_PROMPT } from "./prompts";
import { DEFAULT_MODELS } from "./providers";

const sampleStrategy: Strategy = {
  name: "Test SMA Cross",
  description: "test",
  asset: "AAPL",
  market: "stock",
  timeframe: "1d",
  initialEquity: 10000,
  indicators: [
    { id: "sma_fast", type: "SMA", source: "close", period: 50 },
    { id: "sma_slow", type: "SMA", source: "close", period: 200 },
  ],
  entries: [
    {
      side: "long",
      when: { op: "crosses_above", left: { ref: "sma_fast" }, right: { ref: "sma_slow" } },
    },
  ],
  exits: [],
  risk: { positionSizePct: 100 },
  allowShort: false,
};

beforeEach(() => {
  generateObjectMock.mockReset();
});

describe("compileStrategy", () => {
  it("passes the system prompt, user prompt, and schema to generateObject", async () => {
    generateObjectMock.mockResolvedValueOnce({ object: sampleStrategy });

    const result = await compileStrategy({
      provider: "openai",
      apiKey: "sk-test",
      prompt: "buy AAPL when 50 SMA crosses above 200 SMA",
    });

    expect(generateObjectMock).toHaveBeenCalledTimes(1);
    const callArg = generateObjectMock.mock.calls[0][0] as {
      system: string;
      prompt: string;
      schemaName: string;
      schema: unknown;
      model: { provider: string; modelId: string };
    };

    expect(callArg.system).toBe(SYSTEM_PROMPT);
    expect(callArg.prompt).toContain("buy AAPL when 50 SMA crosses above 200 SMA");
    expect(callArg.schemaName).toBe("Strategy");
    expect(callArg.schema).toBeDefined();
    expect(callArg.model.provider).toBe("openai");
    expect(callArg.model.modelId).toBe(DEFAULT_MODELS.openai);

    expect(result.strategy).toEqual(sampleStrategy);
    expect(JSON.parse(result.raw)).toEqual(sampleStrategy);
  });

  it("uses the user-provided model override when given", async () => {
    generateObjectMock.mockResolvedValueOnce({ object: sampleStrategy });

    await compileStrategy({
      provider: "anthropic",
      apiKey: "sk-ant-test",
      model: "claude-opus-4-5",
      prompt: "long SPY on RSI < 30",
    });

    const callArg = generateObjectMock.mock.calls[0][0] as { model: { modelId: string } };
    expect(callArg.model.modelId).toBe("claude-opus-4-5");
  });

  it("surfaces a friendly error for invalid API key (401)", async () => {
    const err: Error & { statusCode?: number } = Object.assign(new Error("Unauthorized"), { statusCode: 401 });
    generateObjectMock.mockRejectedValueOnce(err);

    await expect(
      compileStrategy({ provider: "openai", apiKey: "bad-key", prompt: "any" }),
    ).rejects.toMatchObject({
      name: "LLMError",
      message: "Invalid API key for openai",
      provider: "openai",
    });
  });

  it("surfaces a friendly error when the message indicates invalid api key", async () => {
    generateObjectMock.mockRejectedValueOnce(new Error("Incorrect API key provided"));

    await expect(
      compileStrategy({ provider: "google", apiKey: "bad", prompt: "x" }),
    ).rejects.toBeInstanceOf(LLMError);
  });

  it("classifies rate-limit errors with retry hint", async () => {
    const err = Object.assign(new Error("Too Many Requests"), {
      statusCode: 429,
      responseHeaders: { "retry-after": "30" },
    });
    generateObjectMock.mockRejectedValueOnce(err);

    await expect(
      compileStrategy({ provider: "anthropic", apiKey: "k", prompt: "x" }),
    ).rejects.toMatchObject({
      name: "LLMError",
      provider: "anthropic",
      message: expect.stringContaining("Rate limit"),
    });
  });

  it("classifies schema validation failures", async () => {
    const err = Object.assign(new Error("schema validation failed"), { name: "AI_NoObjectGeneratedError" });
    generateObjectMock.mockRejectedValueOnce(err);

    await expect(
      compileStrategy({ provider: "openai", apiKey: "k", prompt: "x" }),
    ).rejects.toMatchObject({
      name: "LLMError",
      message: expect.stringContaining("invalid Strategy object"),
    });
  });

  it("rejects empty API keys before calling the SDK", async () => {
    await expect(
      compileStrategy({ provider: "openai", apiKey: "", prompt: "x" }),
    ).rejects.toMatchObject({ message: expect.stringContaining("Missing API key") });
    expect(generateObjectMock).not.toHaveBeenCalled();
  });

  it("rejects empty prompts before calling the SDK", async () => {
    await expect(
      compileStrategy({ provider: "openai", apiKey: "k", prompt: "   " }),
    ).rejects.toMatchObject({ message: "Prompt is empty" });
    expect(generateObjectMock).not.toHaveBeenCalled();
  });
});
