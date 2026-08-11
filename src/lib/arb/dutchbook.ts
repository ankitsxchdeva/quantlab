import type { KalshiEvent, KalshiMarket } from "@/lib/kalshi/client";
import {
  DEFAULT_FEE_RATE,
  makerFeeCents,
  takerFeeCents,
  takerFeeCentsPerContract,
  type FeeType,
} from "@/lib/kalshi/fees";

/**
 * Dutch-book arbitrage across a mutually exclusive set of markets.
 *
 * Kalshi publishes `mutually_exclusive` on an event, which asserts AT MOST ONE
 * nested market resolves YES. That single fact prices two very different trades,
 * and conflating them is the classic way to lose money here:
 *
 *   SELL every YES   collect sum(prices), pay out $1 if any leg hits, else $0.
 *                    Worst case is exactly $1. Profitable iff sum > 100c + fees.
 *                    Safe under mutual exclusivity ALONE.
 *
 *   BUY every YES    pay sum(prices), receive $1 only if some leg hits.
 *                    Requires the set to also be EXHAUSTIVE -- that one of the
 *                    listed outcomes MUST happen. Kalshi does not assert this,
 *                    and plenty of its events omit a catch-all "other" market.
 *                    If none can win you lose the entire stake.
 *
 * So the sell side is a bound and the buy side is a bet dressed as a bound. The
 * buy direction is still computed, but never reported as an arbitrage without
 * `exhaustiveAssumed` travelling with it.
 *
 * Execution matters as much as direction. Empirically the gross edges here run
 * 1-5c while N-leg taker fees run 6-30c, so nothing clears by crossing the
 * spread. Resting orders on a plain "quadratic" series pay zero fees, which is
 * the only way these constraints become tradeable -- at the cost of fill risk.
 */

export interface DutchBookLeg {
  ticker: string;
  /** Price you collect selling YES immediately, by hitting the resting bid. */
  bidCents: number;
  /** Best offer currently resting. NOT a price you can expect to sell at. */
  askCents: number;
  /** Midpoint: where a passive offer would improve the book and sit first in queue. */
  midCents: number;
  spreadCents: number;
  /** Depth on the bid, i.e. how much you could sell right now. */
  bidSize: number;
}

export interface ExecutionPricing {
  /** Total collected across all legs, in cents per $1 of exposure. */
  grossCents: number;
  feeCents: number;
  /** gross - 100 - fees. Positive means profit. */
  edgeCents: number;
  /** Contracts executable now. Null for maker, where fill is not guaranteed. */
  maxSize: number | null;
}

export interface DutchBookEvaluation {
  eventTicker: string;
  title: string;
  seriesTicker?: string;
  legCount: number;
  feeType: FeeType;
  /** Sell every YES. Safe under mutual exclusivity alone. */
  sellTaker: ExecutionPricing | null;
  /**
   * Sell every YES passively at the midpoint. Zero fees on quadratic series,
   * but every leg must fill, and nothing guarantees they do.
   */
  sellMakerAtMid: ExecutionPricing | null;
  /**
   * Widest leg spread in the set. The single most important sanity number here:
   * a large maker edge on a wide book is a liquidity artifact, not an
   * opportunity, because the midpoint is nowhere near where trades happen.
   */
  maxSpreadCents: number;
  /**
   * Sum of every leg's spread. Read `sellMakerAtMid` against this before
   * believing it.
   *
   * When a set is fairly priced -- bids summing to ~100 -- the midpoint sum
   * exceeds 100 by almost exactly half the aggregate spread, so the "maker
   * edge" is measuring spread width rather than mispricing. A real observed
   * case: 10 legs, bids summing to exactly 100c, 19c of aggregate spread, and a
   * 9.5c maker edge that is precisely 19/2. That is market-making revenue, paid
   * for by quoting every leg and carrying the leg risk, not an arbitrage.
   *
   * The mispricing signal is elsewhere: `sellTaker.grossCents` above 100, or
   * `buyTakerExhaustiveAssumed.grossCents` below it.
   */
  aggregateSpreadCents: number;
  /**
   * Buy every YES. ONLY an arbitrage if the outcome set is exhaustive, which
   * this code cannot verify -- hence the name.
   */
  buyTakerExhaustiveAssumed: ExecutionPricing | null;
  legs: DutchBookLeg[];
}

function num(v: string | undefined): number | undefined {
  if (v === undefined || v === null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Top of book for one market, or null if it cannot be traded.
 *
 * Same sentinel trap as parlay pricing: settled markets report bid 0.00 /
 * ask 1.00, and reading those as live quotes invents arbitrage out of contracts
 * that have already resolved.
 */
export function quoteLeg(market: KalshiMarket): DutchBookLeg | null {
  if (market.status !== "active") return null;
  const bid = num(market.yes_bid_dollars);
  const ask = num(market.yes_ask_dollars);
  const bidSize = num(market.yes_bid_size_fp);
  if (bid === undefined || ask === undefined || bidSize === undefined) return null;
  if (bid <= 0 || bid >= 1 || ask <= 0 || ask >= 1) return null;
  if (bidSize <= 0) return null;
  const bidCents = bid * 100;
  const askCents = ask * 100;
  if (askCents < bidCents) return null;
  return {
    ticker: market.ticker,
    bidCents,
    askCents,
    midCents: (bidCents + askCents) / 2,
    spreadCents: askCents - bidCents,
    bidSize,
  };
}

function sellTakerPricing(legs: DutchBookLeg[], rate: number): ExecutionPricing {
  const maxSize = Math.min(...legs.map((l) => l.bidSize));
  const gross = legs.reduce((s, l) => s + l.bidCents, 0);
  const fees = legs.reduce((s, l) => s + takerFeeCents(l.bidCents, maxSize, rate), 0) / maxSize;
  return { grossCents: gross, feeCents: fees, edgeCents: gross - 100 - fees, maxSize };
}

/**
 * Passive sell: rest an offer on every leg rather than hitting bids.
 *
 * Prices at the MIDPOINT, not at the resting ask. Resting at the ask looks far
 * more profitable and is close to meaningless: on an illiquid book the ask sits
 * tens of cents above the bid precisely because nobody pays it, so an offer
 * placed there joins a queue that never trades. Pricing that way turned an
 * 8-leg book quoted 54c bid / 173c ask into a fictional 73c "edge".
 *
 * The midpoint at least represents an offer that improves the best price and
 * sits first in queue. It is still an assumption, not a fill: `maxSize` stays
 * null because how much trades depends on who crosses you, and a number there
 * would read as executable depth.
 */
function sellMakerPricing(legs: DutchBookLeg[], feeType: FeeType): ExecutionPricing | null {
  const fee = makerFeeCents(feeType);
  // Null means the series charges makers an amount this code does not know.
  // Excluding it is the honest move; guessing would manufacture edge.
  if (fee === null) return null;
  const gross = legs.reduce((s, l) => s + l.midCents, 0);
  return { grossCents: gross, feeCents: fee, edgeCents: gross - 100 - fee, maxSize: null };
}

function buyTakerPricing(legs: DutchBookLeg[], rate: number): ExecutionPricing {
  // Buying lifts offers, so cost is the ask side and payout is the fixed $1.
  const cost = legs.reduce((s, l) => s + l.askCents, 0);
  // Size on the offer is not carried per-leg here; report cost-side edge only.
  const fees = legs.reduce((s, l) => s + takerFeeCentsPerContract(l.askCents, rate), 0);
  return { grossCents: cost, feeCents: fees, edgeCents: 100 - cost - fees, maxSize: null };
}

/**
 * Price one mutually exclusive event. Returns null when the set cannot be
 * priced end to end -- a partially quoted book is an unknown, not a cheap one.
 */
export function evaluateDutchBook(
  event: KalshiEvent,
  feeType: FeeType,
  rate: number = DEFAULT_FEE_RATE,
): DutchBookEvaluation | null {
  if (!event.mutually_exclusive) return null;
  const markets = event.markets ?? [];
  if (markets.length < 2) return null;

  const legs: DutchBookLeg[] = [];
  for (const m of markets) {
    if (m.status !== "active") continue;
    const leg = quoteLeg(m);
    // One unquotable active leg breaks the constraint: the set you can trade is
    // no longer the set Kalshi called mutually exclusive.
    if (!leg) return null;
    legs.push(leg);
  }
  if (legs.length < 2) return null;

  return {
    eventTicker: event.event_ticker,
    title: event.title ?? "",
    seriesTicker: event.series_ticker,
    legCount: legs.length,
    feeType,
    sellTaker: sellTakerPricing(legs, rate),
    sellMakerAtMid: sellMakerPricing(legs, feeType),
    maxSpreadCents: Math.max(...legs.map((l) => l.spreadCents)),
    aggregateSpreadCents: legs.reduce((s, l) => s + l.spreadCents, 0),
    buyTakerExhaustiveAssumed: buyTakerPricing(legs, rate),
    legs,
  };
}
