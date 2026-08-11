import { describe, expect, it } from "vitest";
import type { KalshiEvent, KalshiMarket } from "@/lib/kalshi/client";
import { evaluateDutchBook, quoteLeg } from "./dutchbook";

const market = (over: Partial<KalshiMarket> & { ticker: string }): KalshiMarket => ({
  status: "active",
  yes_bid_dollars: "0.50",
  yes_ask_dollars: "0.52",
  yes_bid_size_fp: "10",
  ...over,
});

const event = (markets: KalshiMarket[], over: Partial<KalshiEvent> = {}): KalshiEvent => ({
  event_ticker: "KXTEST",
  series_ticker: "KXTEST",
  title: "Test event",
  mutually_exclusive: true,
  markets,
  ...over,
});

describe("quoteLeg", () => {
  it("refuses settled markets, whose 0.00/1.00 sentinels are not real quotes", () => {
    expect(quoteLeg(market({ ticker: "A", status: "finalized", yes_bid_dollars: "0.00" }))).toBeNull();
  });

  it("refuses a market with no depth on the bid", () => {
    expect(quoteLeg(market({ ticker: "A", yes_bid_size_fp: "0" }))).toBeNull();
  });

  it("refuses prices pinned at the bounds", () => {
    expect(quoteLeg(market({ ticker: "A", yes_bid_dollars: "1.00" }))).toBeNull();
    expect(quoteLeg(market({ ticker: "A", yes_ask_dollars: "0" }))).toBeNull();
  });

  it("converts dollars to cents", () => {
    const q = quoteLeg(market({ ticker: "A", yes_bid_dollars: "0.61", yes_ask_dollars: "0.63" }));
    expect(q).toMatchObject({ ticker: "A", bidCents: 61, askCents: 63, bidSize: 10 });
  });
});

describe("evaluateDutchBook", () => {
  it("ignores events Kalshi has not marked mutually exclusive", () => {
    const e = event([market({ ticker: "A" }), market({ ticker: "B" })], { mutually_exclusive: false });
    expect(evaluateDutchBook(e, "quadratic")).toBeNull();
  });

  it("refuses the whole set when one active leg cannot be quoted", () => {
    // The tradeable set would no longer be the set Kalshi called exclusive.
    const e = event([market({ ticker: "A" }), market({ ticker: "B", yes_bid_size_fp: "0" })]);
    expect(evaluateDutchBook(e, "quadratic")).toBeNull();
  });

  it("prices sell-all at the bids, net of per-leg taker fees", () => {
    const e = event([
      market({ ticker: "A", yes_bid_dollars: "0.60", yes_ask_dollars: "0.62", yes_bid_size_fp: "10" }),
      market({ ticker: "B", yes_bid_dollars: "0.45", yes_ask_dollars: "0.47", yes_bid_size_fp: "20" }),
    ]);
    const ev = evaluateDutchBook(e, "quadratic");

    // gross 105c; fees ceil(16.8)=17 and ceil(17.325)=18 over 10 contracts = 3.5c
    expect(ev?.sellTaker).toMatchObject({ grossCents: 105, maxSize: 10 });
    expect(ev?.sellTaker?.feeCents).toBeCloseTo(3.5, 6);
    expect(ev?.sellTaker?.edgeCents).toBeCloseTo(1.5, 6);
  });

  it("sizes the trade to the thinnest leg", () => {
    const e = event([
      market({ ticker: "A", yes_bid_size_fp: "3" }),
      market({ ticker: "B", yes_bid_size_fp: "99" }),
    ]);
    expect(evaluateDutchBook(e, "quadratic")?.sellTaker?.maxSize).toBe(3);
  });

  it("prices the maker side at the midpoint, at zero fees on a quadratic series", () => {
    const e = event([
      market({ ticker: "A", yes_bid_dollars: "0.50", yes_ask_dollars: "0.60" }), // mid 55
      market({ ticker: "B", yes_bid_dollars: "0.50", yes_ask_dollars: "0.55" }), // mid 52.5
    ]);
    const ev = evaluateDutchBook(e, "quadratic");
    expect(ev?.sellMakerAtMid).toMatchObject({ grossCents: 107.5, feeCents: 0, edgeCents: 7.5 });
  });

  it("does not price the maker side at the resting ask, which invents edge on wide books", () => {
    // Regression for a real defect: pricing at the ask turned this book
    // (54c bid / 173c ask across 8 legs) into a fictional 73c edge, because an
    // offer resting at 58c against a 19c bid simply never trades.
    const wide = event([
      market({ ticker: "A", yes_bid_dollars: "0.19", yes_ask_dollars: "0.58" }),
      market({ ticker: "B", yes_bid_dollars: "0.29", yes_ask_dollars: "0.58" }),
    ]);
    const ev = evaluateDutchBook(wide, "quadratic");

    const askSum = 58 + 58;
    expect(ev?.sellMakerAtMid?.grossCents).toBeLessThan(askSum);
    expect(ev?.sellMakerAtMid?.grossCents).toBeCloseTo(82, 6); // 38.5 + 43.5
    expect(ev?.maxSpreadCents).toBeCloseTo(39, 6);
    expect(ev?.aggregateSpreadCents).toBeCloseTo(68, 6); // 39 + 29
  });

  it("shows a fairly-priced set's maker edge to be half its aggregate spread", () => {
    // The decomposition that stops spread capture being mistaken for arbitrage.
    const e = event([
      market({ ticker: "A", yes_bid_dollars: "0.60", yes_ask_dollars: "0.64" }),
      market({ ticker: "B", yes_bid_dollars: "0.40", yes_ask_dollars: "0.44" }),
    ]);
    const ev = evaluateDutchBook(e, "quadratic");

    expect(ev?.sellTaker?.grossCents).toBeCloseTo(100, 6); // bids sum to par: no mispricing
    expect(ev?.aggregateSpreadCents).toBeCloseTo(8, 6);
    expect(ev?.sellMakerAtMid?.edgeCents).toBeCloseTo(4, 6); // exactly half of 8
  });

  it("refuses to price the maker side when the series charges makers an unknown rate", () => {
    const e = event([market({ ticker: "A" }), market({ ticker: "B" })]);
    // Guessing a rate here would manufacture edge that does not exist.
    expect(evaluateDutchBook(e, "quadratic_with_maker_fees")?.sellMakerAtMid).toBeNull();
    expect(evaluateDutchBook(e, "unknown")?.sellMakerAtMid).toBeNull();
  });

  it("reports no maker size, because a resting order's fill is not knowable", () => {
    const e = event([market({ ticker: "A" }), market({ ticker: "B" })]);
    expect(evaluateDutchBook(e, "quadratic")?.sellMakerAtMid?.maxSize).toBeNull();
  });

  it("keeps the buy direction behind an exhaustiveness caveat in its own name", () => {
    const e = event([
      market({ ticker: "A", yes_bid_dollars: "0.38", yes_ask_dollars: "0.40" }),
      market({ ticker: "B", yes_bid_dollars: "0.43", yes_ask_dollars: "0.45" }),
    ]);
    const ev = evaluateDutchBook(e, "quadratic");
    // Buying both costs 85c for a $1 payout -- but only if one of them MUST win,
    // which mutual exclusivity alone does not promise.
    expect(ev?.buyTakerExhaustiveAssumed?.grossCents).toBe(85);
    expect(ev).not.toHaveProperty("buyTaker");
  });

  // The buy-side fee was written out by hand and dropped the /100 that the
  // published schedule carries, inflating it 100x and driving edgeCents to
  // roughly -400 on a set that is only 15c away from paying. Only grossCents
  // was asserted, so nothing caught it.
  it("charges a buy-side fee on the same scale as the sell side", () => {
    const e = event([
      market({ ticker: "A", yes_bid_dollars: "0.38", yes_ask_dollars: "0.40" }),
      market({ ticker: "B", yes_bid_dollars: "0.43", yes_ask_dollars: "0.45" }),
    ]);
    const ev = evaluateDutchBook(e, "quadratic")!;
    const buyFee = ev.buyTakerExhaustiveAssumed!.feeCents;

    // 0.07 * 40 * 60 / 100 + 0.07 * 45 * 55 / 100 = 1.68 + 1.7325
    expect(buyFee).toBeCloseTo(3.4125, 6);
    // A two-leg fee can never exceed the $1 the trade is competing for.
    expect(buyFee).toBeLessThan(100);
    expect(ev.buyTakerExhaustiveAssumed!.edgeCents).toBeCloseTo(100 - 85 - 3.4125, 6);
  });

  it("skips settled legs but still prices the live remainder", () => {
    const e = event([
      market({ ticker: "A" }),
      market({ ticker: "B" }),
      market({ ticker: "C", status: "finalized" }),
    ]);
    expect(evaluateDutchBook(e, "quadratic")?.legCount).toBe(2);
  });

  it("needs at least two live legs to be a constraint at all", () => {
    const e = event([market({ ticker: "A" }), market({ ticker: "B", status: "finalized" })]);
    expect(evaluateDutchBook(e, "quadratic")).toBeNull();
  });
});
