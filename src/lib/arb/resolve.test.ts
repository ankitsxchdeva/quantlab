import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KalshiEvent, KalshiMarket } from "@/lib/kalshi/client";
import { buildCorpus, resolveHandListedLegs, ResolutionError, shortlist } from "./resolve";

vi.mock("ai", () => ({ generateObject: vi.fn() }));
vi.mock("@/lib/llm/providers", () => ({ resolveModel: () => ({}) }));

import { generateObject } from "ai";
const mockGenerate = vi.mocked(generateObject);

const market = (over: Partial<KalshiMarket> & { ticker: string }): KalshiMarket => ({
  status: "active",
  ...over,
});

const RULES =
  "If ALL of the following Democratic candidates win their 2026 primary elections: " +
  "Abdul El-Sayed for Senate in Michigan, and Peggy Flanagan for Senate in Minnesota, " +
  "then the market resolves to Yes.";

const parlay = market({ ticker: "KXPROGSWEEP-26NOV03", title: "Progressive sweep?", rules_primary: RULES });

const events: KalshiEvent[] = [
  {
    event_ticker: "E1",
    title: "Michigan Democratic Senate primary",
    markets: [market({ ticker: "KXMISEN-EL", title: "El-Sayed" })],
  },
  {
    event_ticker: "E2",
    title: "Minnesota Democratic Senate primary",
    markets: [market({ ticker: "KXMNSEN-FL", title: "Flanagan" })],
  },
  {
    event_ticker: "E3",
    title: "Ohio Republican Governor primary",
    markets: [market({ ticker: "KXOHGOV-X", title: "Someone else" })],
  },
];

const claims = (combinator: "all" | "any" | "unclear" = "all") => ({
  object: {
    combinator,
    legs: [
      { claim: "El-Sayed wins the Michigan Senate primary", keywords: ["El-Sayed", "Michigan"], needs: "yes" },
      { claim: "Flanagan wins the Minnesota Senate primary", keywords: ["Flanagan", "Minnesota"], needs: "yes" },
    ],
  },
});

const matches = (tickers: string[]) => ({
  object: {
    matches: tickers.map((ticker, i) => ({
      claimIndex: i,
      ticker,
      confidence: "high" as const,
      reasoning: "settles the claim",
    })),
  },
});

const opts = { parlay, events, provider: "openai" as const, apiKey: "k" };

describe("shortlist", () => {
  const corpus = buildCorpus(events);

  it("ranks the market whose title carries the rare token", () => {
    const top = shortlist(["Flanagan", "Minnesota"], corpus, 3)[0];
    expect(top.ticker).toBe("KXMNSEN-FL");
  });

  it("returns nothing when no keyword appears anywhere", () => {
    expect(shortlist(["Zurich", "curling"], corpus)).toEqual([]);
  });

  it("respects the limit", () => {
    expect(shortlist(["primary"], corpus, 2).length).toBeLessThanOrEqual(2);
  });

  it("ignores stopwords so a claim of only filler matches nothing", () => {
    expect(shortlist(["the", "of", "will"], corpus)).toEqual([]);
  });
});

describe("buildCorpus", () => {
  it("skips markets that are not active", () => {
    const withSettled: KalshiEvent[] = [
      { event_ticker: "E", title: "T", markets: [market({ ticker: "DEAD", status: "finalized" })] },
    ];
    expect(buildCorpus(withSettled)).toEqual([]);
  });

  it("joins event and market titles so a claim can match either", () => {
    expect(buildCorpus(events)[0].title).toContain("Michigan");
    expect(buildCorpus(events)[0].title).toContain("El-Sayed");
  });
});

describe("resolveHandListedLegs", () => {
  beforeEach(() => mockGenerate.mockReset());

  it("refuses a market with no rules text", async () => {
    await expect(
      resolveHandListedLegs({ ...opts, parlay: market({ ticker: "X" }) }),
    ).rejects.toBeInstanceOf(ResolutionError);
  });

  it("resolves every claim to a real candidate ticker", async () => {
    mockGenerate
      .mockResolvedValueOnce(claims() as never)
      .mockResolvedValueOnce(matches(["KXMISEN-EL", "KXMNSEN-FL"]) as never);

    const r = await resolveHandListedLegs(opts);
    expect(r.blockedReason).toBeNull();
    expect(r.legs.map((l) => l.ticker)).toEqual(["KXMISEN-EL", "KXMNSEN-FL"]);
    expect(r.unresolved).toEqual([]);
  });

  it("rejects a ticker that was never on the candidate list", async () => {
    // The signature of a hallucination: plausible shape, not in our corpus.
    mockGenerate
      .mockResolvedValueOnce(claims() as never)
      .mockResolvedValueOnce(matches(["KXMISEN-EL", "KXTOTALLY-MADE-UP"]) as never);

    const r = await resolveHandListedLegs(opts);
    expect(r.legs.map((l) => l.ticker)).toEqual(["KXMISEN-EL"]);
    expect(r.unresolved[0].reason).toContain("not among the candidates");
    expect(r.blockedReason).toContain("could not be matched");
  });

  it("blocks pricing when any claim is unmatched, rather than hedging partially", async () => {
    mockGenerate
      .mockResolvedValueOnce(claims() as never)
      .mockResolvedValueOnce(matches(["KXMISEN-EL", ""]) as never);

    const r = await resolveHandListedLegs(opts);
    expect(r.blockedReason).toContain("not cheaper, it is unhedged");
  });

  it("refuses an ANY parlay, whose hedge is a different trade entirely", async () => {
    mockGenerate
      .mockResolvedValueOnce(claims("any") as never)
      .mockResolvedValueOnce(matches(["KXMISEN-EL", "KXMNSEN-FL"]) as never);

    const r = await resolveHandListedLegs(opts);
    expect(r.blockedReason).toContain("only ONE condition");
  });

  it("refuses when the combinator could not be determined", async () => {
    mockGenerate
      .mockResolvedValueOnce(claims("unclear") as never)
      .mockResolvedValueOnce(matches(["KXMISEN-EL", "KXMNSEN-FL"]) as never);

    expect((await resolveHandListedLegs(opts)).blockedReason).toContain("not clearly state");
  });

  it("upper-cases a lower-case ticker from the model before matching it", async () => {
    mockGenerate
      .mockResolvedValueOnce(claims() as never)
      .mockResolvedValueOnce(matches(["kxmisen-el", "kxmnsen-fl"]) as never);

    expect((await resolveHandListedLegs(opts)).legs.map((l) => l.ticker)).toEqual([
      "KXMISEN-EL",
      "KXMNSEN-FL",
    ]);
  });
});

// Two distinct claims collapsing onto ONE market is not a resolution, it is a
// missing leg wearing a match. `unresolved` stays empty, so nothing else in the
// blocked-reason chain catches it, and evaluateParlay would price that one
// market's hedge twice while the other condition rode completely unhedged.
describe("resolveHandListedLegs - duplicate ticker matches", () => {
  beforeEach(() => mockGenerate.mockReset());

  it("blocks when two claims are matched to the same market", async () => {
    mockGenerate
      .mockResolvedValueOnce(claims("all") as never)
      .mockResolvedValueOnce(matches(["KXMISEN-EL", "KXMISEN-EL"]) as never);

    const r = await resolveHandListedLegs({
      parlay,
      events,
      provider: "openai",
      apiKey: "k",
    });

    expect(r.blockedReason).toMatch(/same market|duplicate/i);
  });

  it("still resolves cleanly when each claim maps to its own market", async () => {
    mockGenerate
      .mockResolvedValueOnce(claims("all") as never)
      .mockResolvedValueOnce(matches(["KXMISEN-EL", "KXMNSEN-FL"]) as never);

    const r = await resolveHandListedLegs({
      parlay,
      events,
      provider: "openai",
      apiKey: "k",
    });

    expect(r.blockedReason).toBeNull();
    expect(r.legs).toHaveLength(2);
  });
});
