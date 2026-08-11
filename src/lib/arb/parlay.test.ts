import { describe, expect, it } from "vitest";
import type { KalshiMarket } from "@/lib/kalshi/client";
import { DEFAULT_FEE_RATE } from "@/lib/kalshi/fees";
import { bestAsk, evaluateDeadParlay, evaluateParlay, legState } from "./parlay";

function market(ticker: string, over: Partial<KalshiMarket> = {}): KalshiMarket {
  return { ticker, status: "active", ...over };
}

function activeLeg(ticker: string, yesBid: number, yesAsk: number): KalshiMarket {
  return market(ticker, {
    yes_bid_dollars: String(yesBid),
    yes_ask_dollars: String(yesAsk),
    no_ask_dollars: String(1 - yesBid),
    yes_bid_size_fp: "1000",
    yes_ask_size_fp: "1000",
  });
}

describe("legState", () => {
  it("treats a NO leg resolving NO as satisfied, not violated", () => {
    // The bug this pins: testing `result === "yes"` instead of
    // `result === leg.side` inverts every settled-leg conclusion.
    const settled = market("L", { status: "finalized", result: "no" });
    expect(legState({ market_ticker: "L", side: "no" }, settled)).toBe("satisfied");
    expect(legState({ market_ticker: "L", side: "yes" }, settled)).toBe("violated");
  });

  it("treats a YES leg resolving YES as satisfied", () => {
    const settled = market("L", { status: "finalized", result: "yes" });
    expect(legState({ market_ticker: "L", side: "yes" }, settled)).toBe("satisfied");
    expect(legState({ market_ticker: "L", side: "no" }, settled)).toBe("violated");
  });

  it("reports unknown for a missing or unresolved market", () => {
    expect(legState({ market_ticker: "L", side: "yes" }, undefined)).toBe("unknown");
    const pending = market("L", { status: "closed", result: "" });
    expect(legState({ market_ticker: "L", side: "yes" }, pending)).toBe("unknown");
  });
});

describe("bestAsk", () => {
  it("refuses the sentinel quotes on settled markets", () => {
    // Finalized markets report bid 0.00 / ask 1.00. Reading those as prices
    // manufactures arbitrage out of contracts that have already paid out.
    const settled = market("X", {
      status: "finalized",
      result: "no",
      yes_ask_dollars: "1.0000",
      yes_bid_dollars: "0.0000",
      yes_ask_size_fp: "0",
      yes_bid_size_fp: "0",
    });
    expect(bestAsk(settled, "yes")).toBeNull();
    expect(bestAsk(settled, "no")).toBeNull();
  });

  it("prices a NO buy off the resting YES bid", () => {
    const m = activeLeg("X", 0.67, 0.71);
    expect(bestAsk(m, "yes")).toEqual({ priceCents: 71, size: 1000 });
    const no = bestAsk(m, "no");
    expect(no?.priceCents).toBeCloseTo(33, 6);
    expect(no?.size).toBe(1000);
  });
});

describe("evaluateParlay", () => {
  it("finds no edge when the legs sum through the no-arbitrage bound", () => {
    // 71 + 28 + 4 = 103c against a $1 floor: negative before fees even bite.
    const parlay = market("P", {
      yes_ask_dollars: "0.71",
      yes_ask_size_fp: "100",
      mve_selected_legs: [
        { market_ticker: "A", side: "yes" },
        { market_ticker: "B", side: "yes" },
      ],
    });
    const legs = new Map([
      ["A", activeLeg("A", 0.72, 0.73)],
      ["B", activeLeg("B", 0.96, 0.97)],
    ]);
    const result = evaluateParlay(parlay, legs);
    expect(result).not.toBeNull();
    expect(result!.costCents).toBeCloseTo(103, 6);
    expect(result!.edgeCentsPerContract).toBeLessThan(0);
    // Breakeven must sit below the current ask, or there is nothing to wait for.
    expect(result!.breakevenParlayAskCents).toBeLessThan(result!.parlayAskCents);
  });

  // "< parlayAsk" alone passed even when breakeven collapsed to the search
  // floor, which is what it did while the fee term was 100x too large. Pin the
  // definition instead: buying at the breakeven ask must land total cost plus
  // fees exactly on the $1 payout.
  it("returns a breakeven ask where cost plus fees actually equals 100c", () => {
    const parlay = market("P", {
      yes_ask_dollars: "0.71",
      yes_ask_size_fp: "100",
      mve_selected_legs: [
        { market_ticker: "A", side: "yes" },
        { market_ticker: "B", side: "yes" },
      ],
    });
    const legs = new Map([
      ["A", activeLeg("A", 0.72, 0.73)],
      ["B", activeLeg("B", 0.96, 0.97)],
    ]);
    const result = evaluateParlay(parlay, legs)!;
    const be = result.breakevenParlayAskCents;

    expect(be).toBeGreaterThan(1);

    const perContractFee = (p: number) => (DEFAULT_FEE_RATE * p * (100 - p)) / 100;
    const hedgeFees = result.legs.reduce((s, l) => s + perContractFee(l.askCents), 0);
    const total = be + result.hedgeCostCents + perContractFee(be) + hedgeFees;
    expect(total).toBeCloseTo(100, 2);
  });

  it("reports a genuine edge when the hedge clears fees", () => {
    const parlay = market("P", {
      yes_ask_dollars: "0.40",
      yes_ask_size_fp: "100",
      mve_selected_legs: [{ market_ticker: "A", side: "yes" }],
    });
    const legs = new Map([["A", activeLeg("A", 0.5, 0.52)]]);
    const result = evaluateParlay(parlay, legs)!;
    expect(result.costCents).toBeCloseTo(90, 6);
    expect(result.edgeCentsPerContract).toBeGreaterThan(0);
    expect(result.maxProfitDollars).toBeGreaterThan(0);
  });

  it("drops satisfied legs instead of hedging them", () => {
    // The KXPROGSWEEP shape: one leg already won, so only the rest need hedging.
    const parlay = market("P", {
      yes_ask_dollars: "0.40",
      yes_ask_size_fp: "100",
      mve_selected_legs: [
        { market_ticker: "DONE", side: "yes" },
        { market_ticker: "A", side: "yes" },
      ],
    });
    const legs = new Map([
      ["DONE", market("DONE", { status: "finalized", result: "yes" })],
      ["A", activeLeg("A", 0.5, 0.52)],
    ]);
    const result = evaluateParlay(parlay, legs)!;
    expect(result.settledLegs).toBe(1);
    expect(result.legs).toHaveLength(1);
    expect(result.legs[0].ticker).toBe("A");
  });

  it("refuses to price a parlay with an unresolvable leg", () => {
    const parlay = market("P", {
      yes_ask_dollars: "0.40",
      yes_ask_size_fp: "100",
      mve_selected_legs: [
        { market_ticker: "A", side: "yes" },
        { market_ticker: "GONE", side: "yes" },
      ],
    });
    const legs = new Map([["A", activeLeg("A", 0.5, 0.52)]]);
    expect(evaluateParlay(parlay, legs)).toBeNull();
  });

  it("sizes the trade to the thinnest leg", () => {
    const parlay = market("P", {
      yes_ask_dollars: "0.40",
      yes_ask_size_fp: "5",
      mve_selected_legs: [{ market_ticker: "A", side: "yes" }],
    });
    const legs = new Map([["A", activeLeg("A", 0.5, 0.52)]]);
    expect(evaluateParlay(parlay, legs)!.maxSize).toBe(5);
  });
});

describe("evaluateDeadParlay", () => {
  it("prices a parlay whose leg already went against it", () => {
    const parlay = market("P", {
      yes_bid_dollars: "0.24",
      yes_bid_size_fp: "1000",
      mve_selected_legs: [{ market_ticker: "A", side: "yes" }],
    });
    const legs = new Map([["A", market("A", { status: "finalized", result: "no" })]]);
    const dead = evaluateDeadParlay(parlay, legs)!;
    expect(dead.yesBidCents).toBeCloseTo(24, 6);
    expect(dead.profitCentsPerContract).toBeGreaterThan(0);
  });

  it("does not flag a parlay whose settled legs all went its way", () => {
    // The inverted-side bug reported these as free money. They are just alive.
    const parlay = market("P", {
      yes_bid_dollars: "0.24",
      yes_bid_size_fp: "1000",
      mve_selected_legs: [{ market_ticker: "A", side: "no" }],
    });
    const legs = new Map([["A", market("A", { status: "finalized", result: "no" })]]);
    expect(evaluateDeadParlay(parlay, legs)).toBeNull();
  });
});
