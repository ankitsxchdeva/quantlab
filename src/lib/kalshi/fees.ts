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
