import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Strategy } from "@/lib/strategy/schema";
import { compileStrategy, LLMError } from "@/lib/llm/compile";
import { fetchBars } from "@/lib/data";
import { runBacktest } from "@/lib/backtest/engine";
import { POST } from "../route";
import { GET, OPTIONS } from "./route";

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

function makeGetReq(id: string): Request {
  return new Request(`http://localhost/api/run/${id}`);
}

function mockSuccessPipeline(): void {
  compileMock.mockResolvedValue({ strategy, raw: JSON.stringify(strategy), repaired: false });
  fetchBarsMock.mockResolvedValue({ bars: [bar], market });
  runBacktestMock.mockReturnValue(backtestResult as never);
}

async function accept(body: unknown): Promise<string> {
  const res = await POST(
    new Request("http://localhost/api/run", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `10.1.0.${++ipCounter}`,
      },
      body: JSON.stringify(body),
    }),
  );
  expect(res.status).toBe(202);
  return ((await res.json()) as { id: string }).id;
}

// The pipeline runs detached from POST; drain its microtasks so the job's
// terminal state is observable deterministically.
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(0);
}

// Own time island, same trick as route.test.ts: start with empty limiter state.
let timeIsland = 1_900_000_000_000;

describe("GET /api/run/[id]", () => {
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

  it("returns 404 with an error body for an unknown id", async () => {
    const id = "00000000-0000-4000-8000-000000000000";
    const res = await GET(makeGetReq(id), { params: { id } });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/Unknown or expired/);
  });

  it("reports running while the pipeline is pending, then done with the result", async () => {
    let release!: () => void;
    compileMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ strategy, raw: JSON.stringify(strategy), repaired: false });
        }),
    );
    fetchBarsMock.mockResolvedValue({ bars: [bar], market });
    runBacktestMock.mockReturnValue(backtestResult as never);

    const id = await accept(validBody);
    const running = await GET(makeGetReq(id), { params: { id } });
    expect(running.status).toBe(200);
    expect(await running.json()).toEqual({ status: "running" });

    release();
    await settle();

    const done = await GET(makeGetReq(id), { params: { id } });
    expect(done.status).toBe(200);
    const body = await done.json();
    expect(body.status).toBe("done");
    expect(body.strategy).toEqual(strategy);
    expect(body.result).toBeDefined();
    expect(typeof body.timings.compileMs).toBe("number");
    expect(typeof body.timings.fetchMs).toBe("number");
    expect(typeof body.timings.backtestMs).toBe("number");
  });

  it("reports error with the classified message for a failed job", async () => {
    compileMock.mockRejectedValue(new LLMError("Invalid API key for openai"));
    const id = await accept(validBody);
    await settle();
    const res = await GET(makeGetReq(id), { params: { id } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("error");
    expect(body.error).toBe("Invalid API key for openai");
  });

  it("returns 404 once the job expires past the TTL", async () => {
    mockSuccessPipeline();
    const id = await accept(validBody);
    await settle();
    const fresh = await GET(makeGetReq(id), { params: { id } });
    expect(fresh.status).toBe(200);

    vi.setSystemTime(timeIsland + 15 * 60_000 + 1_000);
    const expired = await GET(makeGetReq(id), { params: { id } });
    expect(expired.status).toBe(404);
  });

  it("answers CORS preflight and attaches CORS headers to GET", async () => {
    const origin = { origin: "http://localhost:3000" };
    const pre = await OPTIONS(new Request("http://localhost/api/run/x", { method: "OPTIONS", headers: origin }));
    expect(pre.status).toBe(204);
    expect(pre.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
    expect(pre.headers.get("Access-Control-Allow-Methods")).toContain("GET");

    mockSuccessPipeline();
    const id = await accept(validBody);
    await settle();
    const res = await GET(new Request(makeGetReq(id).url, { headers: origin }), { params: { id } });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
  });
});
