"use client";

import { useState } from "react";
import Link from "next/link";
import TabNav from "@/components/TabNav";
import type { ParlayEvaluation } from "@/lib/arb/parlay";
import type { ScanCoverage, DeadParlay } from "@/lib/arb/scan";

interface ScanResponse {
  mode: "scan";
  opportunities: ParlayEvaluation[];
  nearMisses: ParlayEvaluation[];
  deadParlays: DeadParlay[];
  coverage: ScanCoverage;
}

interface CheckResponse {
  mode: "check";
  evaluation: ParlayEvaluation | null;
  parlay: { ticker: string; title: string; status: string; legCount: number };
  legs: { ticker: string; title: string; status: string; result: string }[];
}

// MVE parlay tickers are generated per leg-combination and churn constantly, so
// there is no stable example to preload. Scan first, then click a row.
const TICKER_PLACEHOLDER = "KXMVECROSSCATEGORY-S2026...";

function c(n: number): string {
  return `${n >= 0 ? "" : "-"}${Math.abs(n).toFixed(2)}c`;
}

function EdgeCell({ edge }: { edge: number }) {
  const positive = edge > 0;
  return (
    <span className={`font-mono tabular-nums ${positive ? "text-accent" : "text-text-2"}`}>
      {c(edge)}
    </span>
  );
}

function EvaluationCard({ e }: { e: ParlayEvaluation }) {
  const positive = e.edgeCentsPerContract > 0;
  return (
    <div className="panel p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <span className="font-mono text-xs text-text-1 break-all">{e.ticker}</span>
        <span
          className={`shrink-0 text-xs px-2 py-0.5 rounded ${
            positive ? "bg-accent-soft text-accent" : "bg-surface-2 text-text-3"
          }`}
        >
          {positive ? "edge" : "no edge"}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div>
          <div className="micro-label">Cost</div>
          <div className="font-mono tabular-nums text-text-1">{c(e.costCents)}</div>
        </div>
        <div>
          <div className="micro-label">Fees</div>
          <div className="font-mono tabular-nums text-text-1">{c(e.feeCentsPerContract)}</div>
        </div>
        <div>
          <div className="micro-label">Edge</div>
          <div>
            <EdgeCell edge={e.edgeCentsPerContract} />
          </div>
        </div>
        <div>
          <div className="micro-label">Max size</div>
          <div className="font-mono tabular-nums text-text-1">{e.maxSize.toFixed(0)}</div>
        </div>
      </div>

      <div className="text-xs text-text-3">
        Buy YES at {c(e.parlayAskCents)}. Breaks even at{" "}
        <span className="font-mono tabular-nums text-text-2">
          {c(e.breakevenParlayAskCents)}
        </span>
        {e.settledLegs > 0 && ` · ${e.settledLegs} leg${e.settledLegs > 1 ? "s" : ""} already settled`}
      </div>

      <div className="border-t border-border pt-2 space-y-1">
        {e.legs.map((leg) => (
          <div key={leg.ticker} className="flex items-center justify-between gap-3 text-xs">
            <span className="font-mono text-text-3 truncate">{leg.ticker}</span>
            <span className="shrink-0 font-mono tabular-nums text-text-2">
              buy {leg.buy.toUpperCase()} @ {c(leg.askCents)} · {leg.size.toFixed(0)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Coverage({ coverage }: { coverage: ScanCoverage }) {
  const rows: [string, string][] = [
    ["Markets scanned", coverage.marketsScanned.toLocaleString()],
    ["Pages", `${coverage.pagesScanned}${coverage.exhausted ? " (all)" : ""}`],
    ["Parlays found", coverage.parlaysFound.toLocaleString()],
    ["With a live offer", coverage.parlaysQuoted.toLocaleString()],
    ["Fully priced", coverage.parlaysPriced.toLocaleString()],
    ["Leg lookups", coverage.legFetches.toLocaleString()],
    ["Skipped: no offer", coverage.skippedNoOffer.toLocaleString()],
    ["Skipped: unpriceable", coverage.skippedUnpriceable.toLocaleString()],
    ["Skipped: budget", coverage.skippedBudget.toLocaleString()],
    ["Elapsed", `${(coverage.elapsedMs / 1000).toFixed(1)}s`],
  ];
  return (
    <div className="panel p-4">
      <div className="micro-label mb-3">Coverage</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 text-xs">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-2 border-b border-border/50 pb-1">
            <span className="text-text-3">{label}</span>
            <span className="font-mono tabular-nums text-text-1">{value}</span>
          </div>
        ))}
      </div>
      {!coverage.exhausted && (
        <p className="mt-3 text-xs text-text-3 leading-relaxed">
          This is a bounded sample, not the whole exchange. The full open set is roughly a
          million markets and takes about four minutes to walk, so a scan inside a request
          budget cannot see all of it. &quot;No opportunities&quot; here means none in what
          was scanned.
        </p>
      )}
    </div>
  );
}

export default function ArbPage() {
  const [scan, setScan] = useState<ScanResponse | null>(null);
  const [check, setCheck] = useState<CheckResponse | null>(null);
  const [ticker, setTicker] = useState("");
  const [busy, setBusy] = useState<"scan" | "check" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function post(body: unknown, kind: "scan" | "check") {
    setBusy(kind);
    setError(null);
    if (kind === "scan") setScan(null);
    else setCheck(null);
    try {
      const res = await fetch("/api/arb", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
      if (kind === "scan") setScan(json as ScanResponse);
      else setCheck(json as CheckResponse);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-30 bg-surface-0/85 backdrop-blur-sm border-b border-border">
        <div className="max-w-6xl mx-auto px-5 sm:px-7 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-5">
            <Link href="/" className="text-sm font-semibold tracking-tight text-text-1">
              quantlab
            </Link>
            <TabNav />
          </div>
          <span className="text-xs text-text-3 hidden sm:inline">No API key required</span>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-5 sm:px-7 py-6 sm:py-10 space-y-6">
        <section>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-text-1 leading-tight">
            Multi-leg arbitrage on Kalshi.
          </h1>
          <p className="mt-3 text-sm sm:text-base text-text-2 max-w-prose leading-relaxed">
            A parlay pays $1 only if every leg lands. Buy it, then buy the opposite side of
            each leg, and the worst case is still $1. If that costs under $1 after fees, the
            difference is risk-free regardless of how correlated the legs are.
          </p>
          <p className="mt-2 text-sm text-text-3 max-w-prose leading-relaxed">
            Fees are the whole game. Kalshi charges{" "}
            <span className="font-mono text-text-2">ceil(0.07 x C x P x (1-P))</span>, which
            peaks at 50c, exactly where parlays trade. Three mid-priced legs cost about 3c per
            contract to hedge, so a 2c gap is a loss.
          </p>
        </section>

        {error && (
          <div role="alert" className="panel p-4 border-danger/40 text-sm text-danger">
            {error}
          </div>
        )}

        <section className="panel p-4 space-y-4">
          <div>
            <div className="micro-label mb-2">Check one parlay</div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                value={ticker}
                onChange={(e) => setTicker(e.target.value)}
                spellCheck={false}
                aria-label="Parlay ticker"
                className="flex-1 h-9 px-3 rounded-md bg-surface-1 border border-border text-sm font-mono text-text-1 focus:outline-none focus:border-border-strong"
                placeholder={TICKER_PLACEHOLDER}
              />
              <button
                onClick={() => post({ mode: "check", ticker: ticker.trim() }, "check")}
                disabled={busy !== null || !ticker.trim()}
                className="btn btn-primary h-9 text-sm"
              >
                {busy === "check" ? "Pricing..." : "Price the hedge"}
              </button>
            </div>
            <p className="mt-2 text-xs text-text-3 leading-relaxed">
              Works on MVE parlays, which publish their legs as structured data. Hand-listed
              parlays like <span className="font-mono">KXPROGSWEEP</span> describe their legs
              in rules text only, so they are not priceable here yet. Run a scan and click a
              row to fill this in.
            </p>
          </div>

          <div className="border-t border-border pt-4">
            <div className="micro-label mb-2">Or sweep the exchange</div>
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={() => post({ mode: "scan", maxPages: 20 }, "scan")}
                disabled={busy !== null}
                className="btn btn-secondary h-9 text-sm"
              >
                {busy === "scan" ? "Scanning..." : "Scan 20k markets"}
              </button>
              <span className="text-xs text-text-3">
                Takes a few seconds. Reports exactly what it covered.
              </span>
            </div>
          </div>
        </section>

        {check && (
          <section className="space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-semibold text-text-1">{check.parlay.title || check.parlay.ticker}</h2>
              <span className="text-xs text-text-3 font-mono">{check.parlay.status}</span>
            </div>
            {check.evaluation ? (
              <EvaluationCard e={check.evaluation} />
            ) : (
              <div className="panel p-4 text-sm text-text-2">
                Not priceable right now. A parlay needs a live YES offer and a tradeable
                quote on every unsettled leg; a leg that already went against it makes the
                contract worthless rather than cheap.
                <div className="mt-3 border-t border-border pt-3 space-y-1">
                  {check.legs.map((leg) => (
                    <div key={leg.ticker} className="flex justify-between gap-3 text-xs">
                      <span className="font-mono text-text-3 truncate">{leg.ticker}</span>
                      <span className="shrink-0 font-mono text-text-2">
                        {leg.status}
                        {leg.result ? ` · ${leg.result}` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {scan && (
          <section className="space-y-4">
            {scan.opportunities.length > 0 ? (
              <>
                <h2 className="text-sm font-semibold text-accent">
                  {scan.opportunities.length} opportunit
                  {scan.opportunities.length === 1 ? "y" : "ies"} clearing fees
                </h2>
                <div className="grid gap-3">
                  {scan.opportunities.map((e) => (
                    <EvaluationCard key={e.ticker} e={e} />
                  ))}
                </div>
              </>
            ) : (
              <div className="panel p-4">
                <h2 className="text-sm font-semibold text-text-1">No arbitrage found</h2>
                <p className="mt-2 text-sm text-text-2 leading-relaxed">
                  Nothing in the scanned set clears fees. That is the normal result: Kalshi
                  prices its own parlays against the same legs, and the quadratic fee eats
                  any gap narrower than a few cents.
                </p>
              </div>
            )}

            {scan.deadParlays.length > 0 && (
              <div className="panel p-4">
                <h2 className="text-sm font-semibold text-warning">
                  {scan.deadParlays.length} parlay
                  {scan.deadParlays.length === 1 ? "" : "s"} with a broken leg
                </h2>
                <p className="mt-1 text-xs text-text-3">
                  A leg already resolved against these, so they can never pay. Buying NO
                  returns $1 if the settlement is final.
                </p>
                <div className="mt-3 space-y-1">
                  {scan.deadParlays.slice(0, 10).map((d) => (
                    <div key={d.ticker} className="flex justify-between gap-3 text-xs">
                      <span className="font-mono text-text-3 truncate">{d.ticker}</span>
                      <span className="shrink-0 font-mono tabular-nums text-text-1">
                        bid {c(d.yesBidCents)} · {c(d.profitCentsPerContract)}/contract
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {scan.nearMisses.length > 0 && (
              <div className="panel p-4">
                <div className="micro-label mb-3">Closest misses</div>
                <div className="space-y-1">
                  {scan.nearMisses.slice(0, 10).map((e) => (
                    <button
                      key={e.ticker}
                      onClick={() => setTicker(e.ticker)}
                      className="w-full flex justify-between gap-3 text-xs text-left hover:bg-surface-1 rounded px-1 -mx-1 py-0.5 transition-colors duration-120 ease-out"
                      title="Load this ticker into the checker"
                    >
                      <span className="font-mono text-text-3 truncate">{e.ticker}</span>
                      <span className="shrink-0 font-mono tabular-nums">
                        cost {c(e.costCents)} · fee {c(e.feeCentsPerContract)} ·{" "}
                        <EdgeCell edge={e.edgeCentsPerContract} />
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <Coverage coverage={scan.coverage} />
          </section>
        )}
      </main>
    </div>
  );
}
