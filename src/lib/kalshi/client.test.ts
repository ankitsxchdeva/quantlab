import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMarket } from "./client";

const market = (ticker: string) => ({ market: { ticker, status: "active" } });
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("fetchMarket", () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  const requestedUrl = (): string => String(fetchSpy.mock.calls[0][0]);

  beforeEach(() => fetchSpy.mockReset());
  afterEach(() => fetchSpy.mockReset());

  it("upper-cases the ticker, because Kalshi's API is case-sensitive", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(market("KXPROGSWEEP-26NOV03")));

    await fetchMarket("kxprogsweep-26nov03");

    expect(requestedUrl()).toContain("/markets/KXPROGSWEEP-26NOV03");
  });

  it("trims surrounding whitespace from a pasted ticker", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(market("KXPROGSWEEP-26NOV03")));

    await fetchMarket("  KXPROGSWEEP-26NOV03\n");

    expect(requestedUrl()).toContain("/markets/KXPROGSWEEP-26NOV03");
    expect(requestedUrl()).not.toContain("%20");
  });

  it("leaves an already-correct ticker alone", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(market("KXMLBGAME-26AUG092020HOUSD-HOU")));

    await fetchMarket("KXMLBGAME-26AUG092020HOUSD-HOU");

    expect(requestedUrl()).toContain("/markets/KXMLBGAME-26AUG092020HOUSD-HOU");
  });

  it("surfaces the normalized ticker in the error, not the raw input", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ error: "not found" }, 404));

    await expect(fetchMarket("kxprogsweep-26nov03")).rejects.toThrow("KXPROGSWEEP-26NOV03");
  });
});
