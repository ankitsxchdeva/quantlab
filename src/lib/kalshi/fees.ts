/**
 * Kalshi's published trading fee schedule.
 *
 *   taker fee = ceil(rate * C * P * (1 - P))   in cents, rounded UP per order
 *
 * `rate` is 0.07 on every series the scanner touches (verified via
 * /series/{ticker}: fee_type "quadratic", fee_multiplier 1). Maker fees are
 * zero except on a listed handful of series.
 *
 * The quadratic term is why parlay arbitrage is so hard to clear: the fee is
 * widest at 50c, exactly where multi-leg contracts trade. A three-leg hedge at
 * mid prices costs roughly 3c per contract in fees alone, so any edge narrower
 * than that is a loss dressed up as an arb.
 */
export const DEFAULT_FEE_RATE = 0.07;

/** Fee in cents for ONE order of `contracts` at `priceCents` (0 < p < 100). */
export function takerFeeCents(
  priceCents: number,
  contracts: number,
  rate: number = DEFAULT_FEE_RATE,
): number {
  const p = priceCents / 100;
  return Math.ceil(rate * contracts * p * (1 - p) * 100);
}

/** Per-contract fee, for comparing legs priced at different sizes. */
export function takerFeePerContract(
  priceCents: number,
  contracts: number,
  rate: number = DEFAULT_FEE_RATE,
): number {
  if (contracts <= 0) return 0;
  return takerFeeCents(priceCents, contracts, rate) / contracts;
}

/**
 * How a series charges, straight from /series/{ticker}.fee_type.
 *
 * This distinction decides whether a logical arbitrage clears at all. Crossing
 * the spread (taker) on an N-leg trade pays the quadratic fee N times, which
 * empirically swamps the 1-5c gross edges these constraints throw off. Resting
 * orders (maker) on a plain "quadratic" series pays nothing.
 */
export type FeeType = "quadratic" | "quadratic_with_maker_fees" | "unknown";

export function parseFeeType(raw: string | undefined): FeeType {
  if (raw === "quadratic") return "quadratic";
  if (raw === "quadratic_with_maker_fees") return "quadratic_with_maker_fees";
  return "unknown";
}

/**
 * Maker fee in cents for ONE resting order, or null when it cannot be priced.
 *
 * Deliberately asymmetric with the taker side. On a plain "quadratic" series
 * Kalshi charges makers nothing, which is a fact worth relying on. On a
 * maker-fee series the published multiplier is NOT exposed on the series
 * endpoint, so rather than invent a rate this returns null and the caller must
 * exclude the market from maker-side results. A guessed fee here would
 * manufacture edge that does not exist.
 */
export function makerFeeCents(feeType: FeeType): number | null {
  return feeType === "quadratic" ? 0 : null;
}
