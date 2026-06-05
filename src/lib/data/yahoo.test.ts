import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchBars } from "./yahoo";

const sampleResponse = (override?: Partial<{ timestamp: number[]; open: (number | null)[]; high: (number | null)[]; low: (number | null)[]; close: (number | null)[]; volume: (number | null)[] }>) => ({
  chart: {
    result: [
      {
        timestamp: override?.timestamp ?? [1700000000, 1700086400, 1700172800],
        indicators: {
          quote: [
            {
              open: override?.open ?? [100, 101, 102],
              high: override?.high ?? [101, 102, 103],
              low: override?.low ?? [99, 100, 101],
              close: override?.close ?? [100.5, 101.5, 102.5],
              volume: override?.volume ?? [1000, 1100, 1200],
            },
          ],
        },
      },
    ],
    error: null,
  },
});

describe("fetchBars (yahoo)", () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch");

  beforeEach(() => {
    fetchSpy.mockReset();
  });
  afterEach(() => {
    fetchSpy.mockReset();
  });

  it("normalizes bars from Yahoo chart response", async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify(sampleResponse()), { status: 200 }));
    const { bars, market } = await fetchBars({ symbol: "AAPL", source: "stock", timeframe: "1d", start: "", end: "" });
    expect(bars).toHaveLength(3);
    expect(bars[0]).toMatchObject({ open: 100, high: 101, low: 99, close: 100.5, volume: 1000 });
    expect(bars[0].time).toBe(1700000000 * 1000);
    expect(market.source).toBe("stock");
    expect(market.symbol).toBe("AAPL");
  });

  it("skips rows with null OHLC", async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify(sampleResponse({ open: [100, null, 102], close: [100.5, 101.5, 102.5] })),
        { status: 200 },
      ),
    );
    const { bars } = await fetchBars({ symbol: "AAPL", source: "stock", timeframe: "1d", start: "", end: "" });
    expect(bars).toHaveLength(2);
  });

  it("treats null volume as zero rather than skipping", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify(sampleResponse({ volume: [1000, null, 1200] })), { status: 200 }),
    );
    const { bars } = await fetchBars({ symbol: "AAPL", source: "stock", timeframe: "1d", start: "", end: "" });
    expect(bars).toHaveLength(3);
    expect(bars[1].volume).toBe(0);
  });

  it("throws when result is empty", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ chart: { result: [], error: null } }), { status: 200 }),
    );
    await expect(fetchBars({ symbol: "ZZZZ", source: "stock", timeframe: "1d", start: "", end: "" })).rejects.toThrow(
      /No data/,
    );
  });

  it("throws when Yahoo returns an error object", async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({ chart: { result: null, error: { code: "Not Found", description: "no such ticker" } } }),
        { status: 200 },
      ),
    );
    await expect(fetchBars({ symbol: "ZZZZ", source: "stock", timeframe: "1d", start: "", end: "" })).rejects.toThrow(
      /no such ticker/,
    );
  });

  it("throws on non-2xx HTTP", async () => {
    fetchSpy.mockResolvedValue(new Response("rate limited", { status: 429 }));
    await expect(fetchBars({ symbol: "AAPL", source: "stock", timeframe: "1d", start: "", end: "" })).rejects.toThrow(
      /429/,
    );
  });

  it("maps 1h timeframe to Yahoo's 60m interval", async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify(sampleResponse()), { status: 200 }));
    await fetchBars({ symbol: "AAPL", source: "stock", timeframe: "1h", start: "", end: "" });
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain("interval=60m");
  });

  it("sorts bars ascending by time", async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify(sampleResponse({ timestamp: [1700172800, 1700000000, 1700086400] })),
        { status: 200 },
      ),
    );
    const { bars } = await fetchBars({ symbol: "AAPL", source: "stock", timeframe: "1d", start: "", end: "" });
    expect(bars[0].time).toBeLessThan(bars[1].time);
    expect(bars[1].time).toBeLessThan(bars[2].time);
  });
});
