import { fetchEventPages, fetchSeries, type KalshiEvent } from "@/lib/kalshi/client";
import { DEFAULT_FEE_RATE, parseFeeType, type FeeType } from "@/lib/kalshi/fees";
import { evaluateDutchBook, type DutchBookEvaluation } from "./dutchbook";

/**
 * Bounded scan for dutch-book arbitrage across mutually exclusive events.
 *
 * Same contract as the parlay scanner: a scan inside a request budget is a
 * sample, and reporting "nothing found" without saying what was skipped is
 * indistinguishable from a broken scanner.
 */
export interface ConstraintCoverage {
  eventsScanned: number;
  pagesScanned: number;
  exhausted: boolean;
  mutuallyExclusive: number;
  priced: number;
  skippedUnpriceable: number;
  /** Series whose maker fee is unknown, so maker-side edge could not be computed. */
  skippedMakerFeeUnknown: number;
  /** Books too wide for a midpoint to mean anything. See maxSpreadCents. */
  skippedWideSpread: number;
  seriesFetches: number;
  elapsedMs: number;
}

export interface ConstraintScanResult {
  /** Sell-side edge that clears fees by crossing the spread. Genuinely risk-free. */
  takerOpportunities: DutchBookEvaluation[];
  /** Sell-side edge that clears only as a resting order. Requires fill. */
  makerOpportunities: DutchBookEvaluation[];
  /** Closest sell-taker misses, for calibrating how far off the market is. */
  nearMisses: DutchBookEvaluation[];
  coverage: ConstraintCoverage;
}

export interface ConstraintScanOptions {
  maxPages?: number;
  /** Cap on /series lookups, needed to tell maker-free series from the rest. */
  seriesBudget?: number;
  minSize?: number;
  feeRate?: number;
  /**
   * Widest per-leg spread a maker result may have. Defaults to 15c.
   *
   * This is the difference between a signal and an artifact. An illiquid book
   * quoted 19c/58c has a midpoint no trade ever happens near, so its "maker
   * edge" is arithmetic on prices that do not exist. Without this filter the
   * top results are entirely the least liquid markets on the exchange.
   */
  maxSpreadCents?: number;
}

/**
 * Fee type per series, fetched once per distinct series and cached.
 *
 * Unknown is the safe default: dutchbook.ts refuses to price the maker side
 * without a known-zero maker fee, so a budget exhaustion degrades the result to
 * taker-only rather than to a wrong number.
 */
async function loadFeeTypes(
  seriesTickers: string[],
  budget: number,
): Promise<{ feeTypes: Map<string, FeeType>; fetches: number }> {
  const feeTypes = new Map<string, FeeType>();
  let fetches = 0;
  for (const ticker of seriesTickers) {
    if (fetches >= budget) break;
    fetches += 1;
    try {
      const series = await fetchSeries(ticker);
      feeTypes.set(ticker, parseFeeType(series.fee_type));
    } catch {
      feeTypes.set(ticker, "unknown");
    }
  }
  return { feeTypes, fetches };
}

export async function scanConstraints(
  options: ConstraintScanOptions = {},
): Promise<ConstraintScanResult> {
  const {
    maxPages = 12,
    seriesBudget = 60,
    minSize = 1,
    feeRate = DEFAULT_FEE_RATE,
    maxSpreadCents = 15,
  } = options;
  const started = Date.now();

  const { events, pages, exhausted } = await fetchEventPages(maxPages);
  const exclusive = events.filter(
    (e: KalshiEvent) => e.mutually_exclusive && (e.markets?.length ?? 0) >= 2,
  );

  // Only look up fee schedules for series that actually produced a quotable
  // book -- /series is one request each and the budget is small.
  const quotable = exclusive.filter((e) =>
    (e.markets ?? []).some((m) => m.status === "active" && Number(m.yes_bid_dollars ?? 0) > 0),
  );
  const distinctSeries = [...new Set(quotable.map((e) => e.series_ticker).filter(Boolean))] as string[];
  const { feeTypes, fetches } = await loadFeeTypes(distinctSeries, seriesBudget);

  const takerOpportunities: DutchBookEvaluation[] = [];
  const makerOpportunities: DutchBookEvaluation[] = [];
  const nearMisses: DutchBookEvaluation[] = [];
  let unpriceable = 0;
  let makerUnknown = 0;
  let wideSpread = 0;

  for (const event of quotable) {
    const feeType = feeTypes.get(event.series_ticker ?? "") ?? "unknown";
    const evaluation = evaluateDutchBook(event, feeType, feeRate);
    if (!evaluation) {
      unpriceable += 1;
      continue;
    }
    if (!evaluation.sellMakerAtMid) makerUnknown += 1;

    const taker = evaluation.sellTaker;
    // Taker first: it is the only direction that is executable right now, so a
    // set that clears there never needs the softer maker story.
    if (taker && taker.maxSize !== null && taker.maxSize >= minSize && taker.edgeCents > 0) {
      takerOpportunities.push(evaluation);
      continue;
    }

    const maker = evaluation.sellMakerAtMid;
    if (maker && maker.edgeCents > 0) {
      if (evaluation.maxSpreadCents > maxSpreadCents) wideSpread += 1;
      else makerOpportunities.push(evaluation);
      continue;
    }

    if (taker) nearMisses.push(evaluation);
    else unpriceable += 1;
  }

  const byTakerEdge = (a: DutchBookEvaluation, b: DutchBookEvaluation) =>
    (b.sellTaker?.edgeCents ?? -Infinity) - (a.sellTaker?.edgeCents ?? -Infinity);
  takerOpportunities.sort(byTakerEdge);
  nearMisses.sort(byTakerEdge);
  makerOpportunities.sort(
    (a, b) => (b.sellMakerAtMid?.edgeCents ?? -Infinity) - (a.sellMakerAtMid?.edgeCents ?? -Infinity),
  );

  return {
    takerOpportunities,
    makerOpportunities: makerOpportunities.slice(0, 25),
    nearMisses: nearMisses.slice(0, 25),
    coverage: {
      eventsScanned: events.length,
      pagesScanned: pages,
      exhausted,
      mutuallyExclusive: exclusive.length,
      priced: takerOpportunities.length + makerOpportunities.length + nearMisses.length,
      skippedUnpriceable: unpriceable,
      skippedMakerFeeUnknown: makerUnknown,
      skippedWideSpread: wideSpread,
      seriesFetches: fetches,
      elapsedMs: Date.now() - started,
    },
  };
}
