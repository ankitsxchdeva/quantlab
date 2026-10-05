import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Strategy } from "@/lib/strategy/schema";
import { compileStrategy, LLMError } from "@/lib/llm/compile";
import { fetchBars } from "@/lib/data";
import { runBacktest } from "@/lib/backtest/engine";
import { POST } from "./route";
import { getJob } from "@/lib/runJobs";

vi.mock("@/lib/llm/compile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/llm/compile")>();
  return { ...actual, compileStrategy: vi.fn() };
});
vi.mock("@/lib/data", () => ({ fetchBars: vi.fn() }));
vi.mock("@/lib/backtest/engine", () => ({ runBacktest: vi.fn() }));

const compileMock = vi.mocked(compileStrategy);
const fetchBarsMock = vi.mocked(fetchBars);
const runBacktestMock = vi.mocked(runBacktest);

const strategy: Strategy = {
  name: "test",
  asset: "AAPL",
  market: "stock",
  timeframe: "1d",
  initialEquity: 10_000,
  indicators: [],
  entries: [{ side: "long", when: { op: ">", left: { price: "close" }, right: { const: 100 } } }],
  exits: [],
  risk: { positionSizePct: 100, costs: { commissionBps: 0, slippageBps: 5, borrowRateAnnualPct: 0 } },
  allowShort: false,
} as Strategy;

const bar = { time: 1_700_000_000_000, open: 100, high: 101, low: 99, close: 100.5, volume: 1000 };
const market = { source: "stock" as const, symbol: "AAPL", label: "AAPL" };
const backtestResult = { trades: [], equity: [], bars: [bar], metrics: {}, benchmark: {}, market, warnings: [] };

const validBody = { prompt: "buy AAPL above 100", provider: "openai", apiKey: "sk-test" };

let ipCounter = 0;
function makeReq(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/run", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `10.0.0.${++ipCounter}`,
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function mockSuccessPipeline(): void {
  compileMock.mockResolvedValue({ strategy, raw: JSON.stringify(strategy), repaired: false });
  fetchBarsMock.mockResolvedValue({ bars: [bar], market });
  runBacktestMock.mockReturnValue(backtestResult as never);
}

// Each test gets its own time island, 2h past the last: the module-level
// rate-limit buckets sweep on any window-sized jump, so every test starts
// with empty limiter state no matter what ran before.
let timeIsland = 1_800_000_000_000;

describe("POST /api/run", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.useFakeTimers();
    timeIsland += 7_200_000;
    vi.setSystemTime(timeIsland);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    compileMock.mockReset();
    fetchBarsMock.mockReset();
    runBacktestMock.mockReset();
  });

  // POST accepts the job and returns before the detached pipeline finishes;
  // pull its microtasks through so job state is observable deterministically.
  async function settle(): Promise<void> {
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
  }

  async function accept(body: unknown, headers?: Record<string, string>): Promise<string> {
    const res = await POST(makeReq(body, headers));
    expect(res.status).toBe(202);
    const data = (await res.json()) as { id: unknown };
    expect(typeof data.id).toBe("string");
    expect((data.id as string).length).toBeGreaterThan(0);
    return data.id as string;
  }

  it("returns 400 on invalid JSON body", async () => {
    const res = await POST(makeReq("{not json"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid JSON body");
  });

  it("returns 400 when the request fails zod validation", async () => {
    const res = await POST(makeReq({ provider: "openai", apiKey: "sk-x" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Invalid request/);
  });

  it("returns 400 when the provider is not supported", async () => {
    const res = await POST(makeReq({ ...validBody, provider: "mistral" }));
    expect(res.status).toBe(400);
  });

  it("accepts a valid run with 202 and a job id, then stores the full result payload", async () => {
    mockSuccessPipeline();
    const id = await accept(validBody);
    await settle();
    const job = getJob(id);
    expect(job?.status).toBe("done");
    const payload = job?.payload as Record<string, unknown>;
    expect(payload.strategy).toEqual(strategy);
    expect(payload.result).toBeDefined();
    expect(typeof payload.requestId).toBe("string");
    expect((payload.requestId as string).length).toBeGreaterThan(0);
    expect(typeof (payload.timings as { compileMs: number }).compileMs).toBe("number");
    expect(typeof (payload.timings as { fetchMs: number }).fetchMs).toBe("number");
    expect(typeof (payload.timings as { backtestMs: number }).backtestMs).toBe("number");
  });

  it("maps compile failures to a 400 error job with the LLMError message", async () => {
    compileMock.mockRejectedValue(new LLMError("Invalid API key for openai"));
    const id = await accept(validBody);
    await settle();
    const job = getJob(id);
    expect(job?.status).toBe("error");
    expect(job?.statusCode).toBe(400);
    expect((job?.payload as { error: string }).error).toBe("Invalid API key for openai");
  });

  it("maps data fetch failures to a 502 error job and echoes the compiled strategy", async () => {
    compileMock.mockResolvedValue({ strategy, raw: JSON.stringify(strategy), repaired: false });
    fetchBarsMock.mockRejectedValue(new Error("Yahoo Finance request failed (429) for AAPL"));
    const id = await accept(validBody);
    await settle();
    const job = getJob(id);
    expect(job?.status).toBe("error");
    expect(job?.statusCode).toBe(502);
    const payload = job?.payload as { error: string; strategy: Strategy };
    expect(payload.error).toMatch(/429/);
    expect(payload.strategy).toEqual(strategy);
  });

  it("stores a 502 error job with the strategy when zero bars come back", async () => {
    compileMock.mockResolvedValue({ strategy, raw: JSON.stringify(strategy), repaired: false });
    fetchBarsMock.mockResolvedValue({ bars: [], market });
    const id = await accept(validBody);
    await settle();
    const job = getJob(id);
    expect(job?.status).toBe("error");
    expect(job?.statusCode).toBe(502);
    const payload = job?.payload as { error: string; strategy: Strategy };
    expect(payload.error).toMatch(/No bars returned for AAPL/);
    expect(payload.strategy).toEqual(strategy);
  });

  it("maps backtest failures to a 500 error job with the strategy", async () => {
    compileMock.mockResolvedValue({ strategy, raw: JSON.stringify(strategy), repaired: false });
    fetchBarsMock.mockResolvedValue({ bars: [bar], market });
    runBacktestMock.mockImplementation(() => {
      throw new Error("Backtest exploded");
    });
    const id = await accept(validBody);
    await settle();
    const job = getJob(id);
    expect(job?.status).toBe("error");
    expect(job?.statusCode).toBe(500);
    const payload = job?.payload as { error: string; strategy: Strategy };
    expect(payload.error).toBe("Backtest exploded");
    expect(payload.strategy).toEqual(strategy);
  });

  it("never logs the apiKey", async () => {
    const logSpy = vi.mocked(console.log);
    mockSuccessPipeline();
    await accept(validBody);
    await settle();
    // One accept line plus one completion line, neither carrying secrets.
    expect(logSpy).toHaveBeenCalledTimes(2);
    expect(logSpy.mock.calls[0][0] as string).toContain("requestId");
    for (const call of logSpy.mock.calls) {
      const line = call[0] as string;
      expect(line).not.toContain("sk-test");
      expect(line).not.toContain("apiKey");
    }
  });

  it("rate limits the 11th request in a minute from the same IP", async () => {
    mockSuccessPipeline();
    const ip = "203.0.113.7";
    for (let i = 0; i < 10; i++) {
      const res = await POST(makeReq(validBody, { "x-forwarded-for": ip }));
      expect(res.status).toBe(202);
    }
    const limited = await POST(makeReq(validBody, { "x-forwarded-for": ip }));
    expect(limited.status).toBe(429);
    const body = await limited.json();
    expect(body.error).toMatch(/10 per minute/);

    const otherIp = await POST(makeReq(validBody, { "x-forwarded-for": "203.0.113.8" }));
    expect(otherIp.status).toBe(202);
  });

  it("falls back to x-real-ip for rate limit keying", async () => {
    mockSuccessPipeline();
    const headers = { "x-forwarded-for": "", "x-real-ip": "198.51.100.4" };
    for (let i = 0; i < 10; i++) {
      await POST(makeReq(validBody, headers));
    }
    const limited = await POST(makeReq(validBody, headers));
    expect(limited.status).toBe(429);
  });

  it("accepts the ollama provider without an API key", async () => {
    mockSuccessPipeline();
    await accept({ prompt: "buy SPY above the 200dma", provider: "ollama" });
    await settle();
    expect(compileMock).toHaveBeenCalledWith(expect.objectContaining({ provider: "ollama", apiKey: "" }));
  });

  it("rate limits the ollama provider separately at 5/min per IP", async () => {
    mockSuccessPipeline();
    const headers = { "x-forwarded-for": "203.0.113.55" };
    for (let i = 0; i < 5; i++) {
      const res = await POST(makeReq({ prompt: "x", provider: "ollama" }, headers));
      expect(res.status).toBe(202);
    }
    const limited = await POST(makeReq({ prompt: "x", provider: "ollama" }, headers));
    expect(limited.status).toBe(429);
  });

  it("caps concurrent ollama jobs at the accept stage and recovers afterwards", async () => {
    const resolvers: Array<() => void> = [];
    compileMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(() => resolve({ strategy, raw: JSON.stringify(strategy), repaired: false }));
        }),
    );
    fetchBarsMock.mockResolvedValue({ bars: [bar], market });
    runBacktestMock.mockReturnValue(backtestResult as never);

    const p1 = POST(makeReq({ prompt: "a", provider: "ollama" }));
    const p2 = POST(makeReq({ prompt: "b", provider: "ollama" }));
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.status).toBe(202);
    expect(r2.status).toBe(202);

    const third = await POST(makeReq({ prompt: "c", provider: "ollama" }));
    expect(third.status).toBe(429);
    expect((await third.json()).error).toMatch(/busy/);

    resolvers.forEach((release) => release());
    await settle();
    await settle();

    mockSuccessPipeline();
    const after = await POST(makeReq({ prompt: "d", provider: "ollama" }));
    expect(after.status).toBe(202);
    await settle();
  });
});
