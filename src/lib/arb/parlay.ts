import type { KalshiLeg, KalshiMarket } from "@/lib/kalshi/client";
import { DEFAULT_FEE_RATE, takerFeeCents, takerFeeCentsPerContract } from "@/lib/kalshi/fees";

/**
 * Multi-leg (parlay) arbitrage pricing.
 *
 * A parlay resolves YES iff every leg resolves to the side the parlay selected.
 * So the hedge is: buy YES on the parlay, and buy the OPPOSITE side of every
 * still-active leg.
 *
 *   all legs go the parlay's way -> parlay pays $1, hedges pay $0    = $1
 *   k >= 1 legs go against it    -> parlay pays $0, k hedges pay $1  = $k
 *
 * The floor is $1, so it is an arbitrage iff cost + fees < 100c. This holds
 * regardless of how correlated the legs are, which is what makes it a real
 * bound rather than a modelling assumption.
 */

export interface Quote {
  priceCents: number;
  size: number;
}

export type LegState = "active" | "satisfied" | "violated" | "unknown";

export interface PricedLeg {
  ticker: string;
  /** The side the parlay needs. */
  needs: "yes" | "no";
  /** The side you buy to hedge it -- always the opposite. */
  buy: "yes" | "no";
  askCents: number;
  size: number;
}

export interface ParlayEvaluation {
  ticker: string;
  legCount: number;
  settledLegs: number;
  parlayAskCents: number;
  hedgeCostCents: number;
  costCents: number;
  feeCentsPerContract: number;
  edgeCentsPerContract: number;
  maxSize: number;
  maxProfitDollars: number;
  /** Parlay ask at which the trade would break even, holding hedges fixed. */
  breakevenParlayAskCents: number;
  legs: PricedLeg[];
}

function num(v: string | undefined): number | undefined {
  if (v === undefined || v === null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * The best offer you can lift to BUY `side`, or null if there is none.
 *
 * Only `active` markets carry real quotes. Settled markets report sentinel
 * values (bid 0.00 / ask 1.00) that must never be read as tradeable prices --
 * doing so invents arbitrage out of already-resolved contracts.
 */
export function bestAsk(market: KalshiMarket, side: "yes" | "no"): Quote | null {
  if (market.status !== "active") return null;
  // A NO offer is the mirror of a resting YES bid, so its depth is the YES bid size.
  const price = side === "yes" ? num(market.yes_ask_dollars) : num(market.no_ask_dollars);
  const size = side === "yes" ? num(market.yes_ask_size_fp) : num(market.yes_bid_size_fp);
  if (price === undefined || size === undefined) return null;
  if (price <= 0 || price >= 1 || size <= 0) return null;
  return { priceCents: price * 100, size };
}

/**
 * Whether a leg is still live, already satisfied, or already broken.
 *
 * A settled leg satisfies the parlay iff its result equals the side the parlay
 * selected. `result === "no"` on a leg the parlay picked NO on is a WIN for the
 * parlay, not a loss -- getting this backwards inverts every downstream
 * conclusion, so it is pinned by tests.
 */
export function legState(leg: KalshiLeg, market: KalshiMarket | undefined): LegState {
  if (market && market.status === "active") return "active";
  const result = market?.result;
  if (result === "yes" || result === "no") {
    return result === leg.side ? "satisfied" : "violated";
  }
  return "unknown";
}

function breakeven(hedgeCents: number, hedgeFeeCents: number, rate: number): number {
  // Solve for the parlay ask where cost + fees == 100, hedges held fixed.
  let lo = 0.01;
  let hi = 99.99;
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    const fee = takerFeeCentsPerContract(mid, rate);
    if (mid + hedgeCents + fee + hedgeFeeCents > 100) hi = mid;
    else lo = mid;
  }
  return lo;
}

/**
 * Price the hedge for one parlay. Returns null when any leg cannot be priced --
 * a partially priced parlay is not a cheaper arb, it is an unknown one.
 */
export function evaluateParlay(
  parlay: KalshiMarket,
  legMarkets: Map<string, KalshiMarket>,
  rate: number = DEFAULT_FEE_RATE,
): ParlayEvaluation | null {
  const legs = parlay.mve_selected_legs;
  if (!legs || legs.length === 0) return null;

  const parlayAsk = bestAsk(parlay, "yes");
  if (!parlayAsk) return null;

  const priced: PricedLeg[] = [];
  let settled = 0;
  for (const leg of legs) {
    const market = legMarkets.get(leg.market_ticker);
    const state = legState(leg, market);
    // A satisfied leg drops out of the parlay: it needs no hedge and costs
    // nothing. A violated leg means the parlay can never pay, and a hedge
    // priced against it would be meaningless.
    if (state === "satisfied") {
      settled += 1;
      continue;
    }
    if (state === "violated" || state === "unknown" || !market) return null;

    const buy: "yes" | "no" = leg.side === "yes" ? "no" : "yes";
    const ask = bestAsk(market, buy);
    if (!ask) return null;
    priced.push({
      ticker: leg.market_ticker,
      needs: leg.side,
      buy,
      askCents: ask.priceCents,
      size: ask.size,
    });
  }
  if (priced.length === 0) return null;

  const maxSize = Math.min(parlayAsk.size, ...priced.map((l) => l.size));
  const hedgeCost = priced.reduce((sum, l) => sum + l.askCents, 0);
  const cost = parlayAsk.priceCents + hedgeCost;
  const totalFees =
    takerFeeCents(parlayAsk.priceCents, maxSize, rate) +
    priced.reduce((sum, l) => sum + takerFeeCents(l.askCents, maxSize, rate), 0);
  const feePerContract = totalFees / maxSize;
  const edge = 100 - cost - feePerContract;
  const hedgeFee = priced.reduce((sum, l) => sum + takerFeeCentsPerContract(l.askCents, rate), 0);

  return {
    ticker: parlay.ticker,
    legCount: legs.length,
    settledLegs: settled,
    parlayAskCents: parlayAsk.priceCents,
    hedgeCostCents: hedgeCost,
    costCents: cost,
    feeCentsPerContract: feePerContract,
    edgeCentsPerContract: edge,
    maxSize,
    maxProfitDollars: (edge * maxSize) / 100,
    breakevenParlayAskCents: breakeven(hedgeCost, hedgeFee, rate),
    legs: priced,
  };
}

/**
 * A parlay with a leg that already went against it can never pay. Buying NO at
 * (100 - yes_bid) returns $1, so the profit is the remaining bid less fees.
 */
export function evaluateDeadParlay(
  parlay: KalshiMarket,
  legMarkets: Map<string, KalshiMarket>,
  rate: number = DEFAULT_FEE_RATE,
): { ticker: string; yesBidCents: number; size: number; profitCentsPerContract: number } | null {
  if (parlay.status !== "active") return null;
  const legs = parlay.mve_selected_legs ?? [];
  const anyViolated = legs.some((l) => legState(l, legMarkets.get(l.market_ticker)) === "violated");
  if (!anyViolated) return null;

  const bid = num(parlay.yes_bid_dollars);
  const size = num(parlay.yes_bid_size_fp);
  if (bid === undefined || size === undefined || bid <= 0 || size <= 0) return null;

  const bidCents = bid * 100;
  const profit = bidCents - takerFeeCents(100 - bidCents, size, rate) / size;
  if (profit <= 0) return null;
  return { ticker: parlay.ticker, yesBidCents: bidCents, size, profitCentsPerContract: profit };
}
