import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bucketByTimeframe, fetchBars, parseClobTokenIds } from "./polymarket";

const sampleMarket = (override?: Partial<Record<string, unknown>>) => ({
  id: "123",
  question: "Will X happen?",
  slug: "will-x-happen",
  conditionId: "0xabc",
  clobTokenIds: JSON.stringify(["tok-yes", "tok-no"]),
  ...override,
});

const sampleHistory = (points?: { t: number; p: number }[]) => ({
  history: points ?? [
    { t: 1_700_000_000, p: 0.4 },
    { t: 1_700_086_400, p: 0.5 },
    { t: 1_700_172_800, p: 0.6 },
  ],
});

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("fetchBars (polymarket)", () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch");

  beforeEach(() => {
    fetchSpy.mockReset();
  });
  afterEach(() => {
    fetchSpy.mockReset();
  });

  it("finds a market by slug and returns bucketed bars", async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse([sampleMarket()]))
      .mockResolvedValueOnce(jsonResponse(sampleHistory()));

    const { bars, market } = await fetchBars({
      symbol: "will-x-happen",
      source: "polymarket",
      timeframe: "1d",
      start: "",
      end: "",
    });

    expect(bars).toHaveLength(3);
    expect(market).toMatchObject({
      source: "polymarket",
      symbol: "will-x-happen",
      label: "Will X happen?",
      url: "https://polymarket.com/event/will-x-happen",
    });

    const slugUrl = String(fetchSpy.mock.calls[0][0]);
    expect(slugUrl).toContain("gamma-api.polymarket.com/markets");
    expect(slugUrl).toContain("slug=will-x-happen");

    const clobUrl = String(fetchSpy.mock.calls[1][0]);
    expect(clobUrl).toContain("clob.polymarket.com/prices-history");
    expect(clobUrl).toContain("market=tok-yes");
  });

  it("strips a polymarket: prefix from the symbol", async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse([sampleMarket()]))
      .mockResolvedValueOnce(jsonResponse(sampleHistory()));

    await fetchBars({ symbol: "polymarket:will-x-happen", source: "polymarket", timeframe: "1d", start: "", end: "" });
    expect(String(fetchSpy.mock.calls[0][0])).toContain("slug=will-x-happen");
  });

  it("falls back to question search when slug lookup misses", async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([sampleMarket({ question: "Will the Fed cut rates?", slug: "fed-cut" })]))
      .mockResolvedValueOnce(jsonResponse(sampleHistory()));

    const { market } = await fetchBars({ symbol: "fed cut", source: "polymarket", timeframe: "1d", start: "", end: "" });
    expect(market.symbol).toBe("fed-cut");
    expect(market.label).toBe("Will the Fed cut rates?");

    const searchUrl = String(fetchSpy.mock.calls[1][0]);
    expect(searchUrl).toContain("order=volume");
  });

  it("throws when no market is found by slug or search", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse([])).mockResolvedValueOnce(jsonResponse([]));
    await expect(
      fetchBars({ symbol: "no-such-market", source: "polymarket", timeframe: "1d", start: "", end: "" }),
    ).rejects.toThrow(/Could not find Polymarket market/);
  });

  it("throws when the market has no CLOB token IDs", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse([sampleMarket({ clobTokenIds: undefined })]));
    await expect(
      fetchBars({ symbol: "will-x-happen", source: "polymarket", timeframe: "1d", start: "", end: "" }),
    ).rejects.toThrow(/no CLOB token IDs/);
  });

  it("throws when price history is empty", async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse([sampleMarket()]))
      .mockResolvedValueOnce(jsonResponse(sampleHistory([])));
    await expect(
      fetchBars({ symbol: "will-x-happen", source: "polymarket", timeframe: "1d", start: "", end: "" }),
    ).rejects.toThrow(/No price history/);
  });

  it("uses startTs/endTs when a start date is given, interval=max otherwise", async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse([sampleMarket()]))
      .mockResolvedValueOnce(jsonResponse(sampleHistory()));
    await fetchBars({ symbol: "will-x-happen", source: "polymarket", timeframe: "1d", start: "2024-01-01", end: "2024-06-01" });
    expect(String(fetchSpy.mock.calls[1][0])).toContain("startTs=");

    fetchSpy.mockReset();
    fetchSpy
      .mockResolvedValueOnce(jsonResponse([sampleMarket()]))
      .mockResolvedValueOnce(jsonResponse(sampleHistory()));
    await fetchBars({ symbol: "will-x-happen", source: "polymarket", timeframe: "1d", start: "", end: "" });
    expect(String(fetchSpy.mock.calls[1][0])).toContain("interval=max");
  });

  it("surfaces a distinct timeout message when the Gamma lookup times out", async () => {
    fetchSpy.mockRejectedValueOnce(new DOMException("The operation timed out", "TimeoutError"));
    await expect(
      fetchBars({ symbol: "will-x-happen", source: "polymarket", timeframe: "1d", start: "", end: "" }),
    ).rejects.toThrow(/Polymarket market lookup \(Gamma\) timed out/);
  });

  it("surfaces a distinct timeout message when the CLOB fetch times out", async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse([sampleMarket()]))
      .mockRejectedValueOnce(new DOMException("The operation timed out", "TimeoutError"));
    await expect(
      fetchBars({ symbol: "will-x-happen", source: "polymarket", timeframe: "1d", start: "", end: "" }),
    ).rejects.toThrow(/Polymarket price history \(CLOB\) timed out/);
  });

  it("passes an abort signal to outbound fetches", async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse([sampleMarket()]))
      .mockResolvedValueOnce(jsonResponse(sampleHistory()));
    await fetchBars({ symbol: "will-x-happen", source: "polymarket", timeframe: "1d", start: "", end: "" });
    for (const call of fetchSpy.mock.calls) {
      expect(call[1]?.signal).toBeInstanceOf(AbortSignal);
    }
  });
});

describe("parseClobTokenIds", () => {
  it("parses a JSON array of token ids", () => {
    expect(parseClobTokenIds('["a","b"]')).toEqual(["a", "b"]);
  });

  it("stringifies non-string array members", () => {
    expect(parseClobTokenIds("[1,2]")).toEqual(["1", "2"]);
  });

  it("returns empty for undefined, invalid JSON, and non-array JSON", () => {
    expect(parseClobTokenIds(undefined)).toEqual([]);
    expect(parseClobTokenIds("not json")).toEqual([]);
    expect(parseClobTokenIds('{"a":1}')).toEqual([]);
  });
});

describe("bucketByTimeframe", () => {
  const DAY_S = 86_400;

  it("returns empty for no points", () => {
    expect(bucketByTimeframe([], "1d")).toEqual([]);
  });

  it("builds OHLC from unordered points within one bucket", () => {
    const bars = bucketByTimeframe(
      [
        { t: 100, p: 0.4 },
        { t: 50, p: 0.3 },
        { t: 200, p: 0.5 },
        { t: 150, p: 0.2 },
      ],
      "1d",
    );
    expect(bars).toHaveLength(1);
    expect(bars[0]).toEqual({ time: 0, open: 0.3, high: 0.5, low: 0.2, close: 0.5, volume: 0 });
  });

  it("splits points across buckets and sorts them ascending", () => {
    const bars = bucketByTimeframe(
      [
        { t: DAY_S * 2 + 10, p: 0.7 },
        { t: 10, p: 0.4 },
        { t: DAY_S + 10, p: 0.6 },
      ],
      "1d",
    );
    expect(bars).toHaveLength(3);
    expect(bars.map((b) => b.time)).toEqual([0, DAY_S * 1000, DAY_S * 2000]);
    expect(bars.map((b) => b.close)).toEqual([0.4, 0.6, 0.7]);
  });

  it("skips non-finite points", () => {
    const bars = bucketByTimeframe(
      [
        { t: 10, p: 0.4 },
        { t: NaN, p: 0.9 },
        { t: 20, p: Infinity },
      ],
      "1d",
    );
    expect(bars).toHaveLength(1);
    expect(bars[0].high).toBe(0.4);
  });

  it("aligns bucket time to the timeframe boundary", () => {
    const bars = bucketByTimeframe([{ t: 3_700, p: 0.5 }], "1h");
    expect(bars[0].time).toBe(3_600_000);
  });
});
