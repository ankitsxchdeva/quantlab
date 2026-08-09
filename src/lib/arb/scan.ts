import { fetchMarket, fetchMarketPages, type KalshiMarket } from "@/lib/kalshi/client";
import { DEFAULT_FEE_RATE } from "@/lib/kalshi/fees";
import { evaluateDeadParlay, evaluateParlay, type ParlayEvaluation } from "./parlay";

/**
 * How much of the exchange a scan actually looked at.
 *
 * The open set is ~1M markets across ~1000 pages and takes ~220s to walk, so
 * any scan inside a request budget is a sample. Every number here is surfaced
 * in the UI: a bounded scan that reports "no arbitrage" without saying what it
 * skipped is indistinguishable from a broken one.
 */
export interface ScanCoverage {
  marketsScanned: number;
  pagesScanned: number;
  exhausted: boolean;
  parlaysFound: number;
  parlaysQuoted: number;
  parlaysPriced: number;
  legFetches: number;
  skippedNoOffer: number;
  skippedUnpriceable: number;
  skippedBudget: number;
  elapsedMs: number;
}

export interface DeadParlay {
  ticker: string;
  yesBidCents: number;
  size: number;
  profitCentsPerContract: number;
}

export interface ScanResult {
  opportunities: ParlayEvaluation[];
  nearMisses: ParlayEvaluation[];
  deadParlays: DeadParlay[];
  coverage: ScanCoverage;
}

export interface ScanOptions {
  maxPages?: number;
  /** Cap on individual leg lookups, the dominant cost once parlays are found. */
  legBudget?: number;
  minSize?: number;
  feeRate?: number;
}

async function loadLegs(
  parlays: KalshiMarket[],
  legBudget: number,
  cache: Map<string, KalshiMarket>,
): Promise<{ fetches: number; exhaustedAt: number }> {
  let fetches = 0;
  for (let i = 0; i < parlays.length; i += 1) {
    const legs = parlays[i].mve_selected_legs ?? [];
    const wanted = legs.map((l) => l.market_ticker).filter((t) => !cache.has(t));
    if (fetches + wanted.length > legBudget) return { fetches, exhaustedAt: i };
    const fetched = await Promise.all(
      wanted.map(async (t) => {
        try {
          return await fetchMarket(t);
        } catch {
          return null;
        }
      }),
    );
    for (const m of fetched) if (m) cache.set(m.ticker, m);
    fetches += wanted.length;
  }
  return { fetches, exhaustedAt: parlays.length };
}

/** Price one named parlay exactly. Cheap: 1 + n requests, no sampling. */
export async function checkParlay(
  ticker: string,
  feeRate: number = DEFAULT_FEE_RATE,
): Promise<{ evaluation: ParlayEvaluation | null; parlay: KalshiMarket; legs: KalshiMarket[] }> {
  const parlay = await fetchMarket(ticker);
  const legTickers = (parlay.mve_selected_legs ?? []).map((l) => l.market_ticker);
  const legs = await Promise.all(legTickers.map((t) => fetchMarket(t)));
  const map = new Map(legs.map((m) => [m.ticker, m]));
  return { evaluation: evaluateParlay(parlay, map, feeRate), parlay, legs };
}

export async function scanForArbitrage(options: ScanOptions = {}): Promise<ScanResult> {
  const { maxPages = 20, legBudget = 240, minSize = 1, feeRate = DEFAULT_FEE_RATE } = options;
  const started = Date.now();

  const { markets, pages, exhausted } = await fetchMarketPages(maxPages);
  const cache = new Map<string, KalshiMarket>();
  for (const m of markets) cache.set(m.ticker, m);

  const parlays = markets.filter((m) => (m.mve_selected_legs?.length ?? 0) > 0);
  // Almost every MVE parlay is quote-on-demand and rests no offers at all, so
  // screening on a live YES ask first collapses the leg-fetch cost by ~99%.
  const quoted = parlays.filter(
    (m) => m.status === "active" && Number(m.yes_ask_dollars ?? 0) > 0 && Number(m.yes_ask_size_fp ?? 0) > 0,
  );

  const { fetches, exhaustedAt } = await loadLegs(quoted, legBudget, cache);
  const reachable = quoted.slice(0, exhaustedAt);

  const opportunities: ParlayEvaluation[] = [];
  const nearMisses: ParlayEvaluation[] = [];
  const deadParlays: DeadParlay[] = [];
  let unpriceable = 0;

  for (const parlay of reachable) {
    const dead = evaluateDeadParlay(parlay, cache, feeRate);
    if (dead) {
      deadParlays.push(dead);
      continue;
    }
    const evaluation = evaluateParlay(parlay, cache, feeRate);
    if (!evaluation) {
      unpriceable += 1;
      continue;
    }
    if (evaluation.maxSize < minSize) {
      unpriceable += 1;
      continue;
    }
    if (evaluation.edgeCentsPerContract > 0) opportunities.push(evaluation);
    else nearMisses.push(evaluation);
  }

  opportunities.sort((a, b) => b.edgeCentsPerContract - a.edgeCentsPerContract);
  nearMisses.sort((a, b) => b.edgeCentsPerContract - a.edgeCentsPerContract);
  deadParlays.sort((a, b) => b.profitCentsPerContract - a.profitCentsPerContract);

  return {
    opportunities,
    nearMisses: nearMisses.slice(0, 25),
    deadParlays,
    coverage: {
      marketsScanned: markets.length,
      pagesScanned: pages,
      exhausted,
      parlaysFound: parlays.length,
      parlaysQuoted: quoted.length,
      parlaysPriced: opportunities.length + nearMisses.length,
      legFetches: fetches,
      skippedNoOffer: parlays.length - quoted.length,
      skippedUnpriceable: unpriceable,
      skippedBudget: quoted.length - exhaustedAt,
      elapsedMs: Date.now() - started,
    },
  };
}
