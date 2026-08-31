"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { GithubLogo } from "@phosphor-icons/react";
import TabNav from "@/components/TabNav";
import ThemeToggle from "@/components/ThemeToggle";
import SettingsPanel, { type LLMSettings } from "@/components/SettingsPanel";
import { apiUrl } from "@/lib/apiBase";
import type { ParlayEvaluation } from "@/lib/arb/parlay";
import type { ScanCoverage, DeadParlay } from "@/lib/arb/scan";
import type { ConstraintCoverage } from "@/lib/arb/constraints";
import type { DutchBookEvaluation } from "@/lib/arb/dutchbook";
import type { Resolution } from "@/lib/arb/resolve";
import type { LLMProvider } from "@/lib/types";

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

interface ConstraintsResponse {
  mode: "constraints";
  takerOpportunities: DutchBookEvaluation[];
  makerOpportunities: DutchBookEvaluation[];
  nearMisses: DutchBookEvaluation[];
  coverage: ConstraintCoverage;
}

interface ResolveResponse {
  mode: "resolve";
  resolution: Resolution;
  evaluation: ParlayEvaluation | null;
  parlay: { ticker: string; title: string; status: string; rules: string };
  legs: { ticker: string; title: string; status: string; result: string }[];
}

// Shared with the backtest tab: the same key the user already pasted there is
// the one a leg recovery needs, so they never enter it twice.
const SETTINGS_KEY = "algotrading.llm.settings.v1";

const DEFAULT_SETTINGS: LLMSettings = {
  provider: "openai",
  apiKey: "",
  model: undefined,
};

function loadSettings(): LLMSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<LLMSettings>;
    if (parsed.provider !== "openai" && parsed.provider !== "anthropic" && parsed.provider !== "google") {
      return DEFAULT_SETTINGS;
    }
    return {
      provider: parsed.provider,
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
      model: typeof parsed.model === "string" && parsed.model.length > 0 ? parsed.model : undefined,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function CogIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

// MVE parlay tickers are generated per leg-combination and churn constantly, so
// there is no stable example to preload. Scan first, then click a row.
const TICKER_PLACEHOLDER = "KXMVECROSSCATEGORY-S2026...";

function c(n: number): string {
  return `${n >= 0 ? "" : "-"}${Math.abs(n).toFixed(2)}c`;
}

function EdgeCell({ edge }: { edge: number }) {
  const color = edge > 0 ? "text-data-pos" : edge < 0 ? "text-data-neg" : "text-muted";
  return (
    <span className={`font-mono tabular-nums ${color}`}>
      {c(edge)}
    </span>
  );
}

function EvaluationCard({ e }: { e: ParlayEvaluation }) {
  const positive = e.edgeCentsPerContract > 0;
  return (
    <div className="border-t border-border pt-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <span className="font-mono text-label text-fg break-all">{e.ticker}</span>
        <span
          className={
            positive
              ? "shrink-0 text-small font-bold text-data-pos"
              : "shrink-0 text-small text-muted"
          }
        >
          {positive ? "edge" : "no edge"}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-label">
        <div>
          <div className="text-muted lowercase">cost</div>
          <div className="font-mono tabular-nums text-fg">{c(e.costCents)}</div>
        </div>
        <div>
          <div className="text-muted lowercase">fees</div>
          <div className="font-mono tabular-nums text-fg">{c(e.feeCentsPerContract)}</div>
        </div>
        <div>
          <div className="text-muted lowercase">edge</div>
          <div>
            <EdgeCell edge={e.edgeCentsPerContract} />
          </div>
        </div>
        <div>
          <div className="text-muted lowercase">max size</div>
          <div className="font-mono tabular-nums text-fg">{e.maxSize.toFixed(0)}</div>
        </div>
      </div>

      <div className="text-label text-dim">
        Buy YES at {c(e.parlayAskCents)}. Breaks even at{" "}
        <span className="font-mono tabular-nums text-muted">
          {c(e.breakevenParlayAskCents)}
        </span>
        {e.settledLegs > 0 && ` · ${e.settledLegs} leg${e.settledLegs > 1 ? "s" : ""} already settled`}
      </div>

      <div className="border-t border-border pt-2 space-y-1">
        {e.legs.map((leg) => (
          <div key={leg.ticker} className="flex items-center justify-between gap-3 text-label">
            <span className="font-mono text-dim truncate">{leg.ticker}</span>
            <span className="shrink-0 font-mono tabular-nums text-muted">
              buy {leg.buy.toUpperCase()} @ {c(leg.askCents)} · {leg.size.toFixed(0)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * One mutually exclusive set.
 *
 * Shows bids / mids / asks together on purpose. A maker "edge" is only
 * interesting when the bid sum is above 100 or the ask sum below it; otherwise
 * it is half the aggregate spread wearing a disguise, which the footer says
 * outright rather than leaving for the reader to derive.
 */
function ConstraintCard({ e }: { e: DutchBookEvaluation }) {
  const bidSum = e.sellTaker?.grossCents ?? 0;
  const askSum = e.buyTakerExhaustiveAssumed?.grossCents ?? 0;
  const mispriced = bidSum > 100 || askSum < 100;

  return (
    <div className="border-t border-border pt-4 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-title font-bold text-fg">{e.title || e.eventTicker}</span>
        <span className="text-label font-mono text-dim shrink-0">{e.legCount} legs</span>
      </div>

      <div className="grid grid-cols-3 gap-3 text-label">
        <div>
          <div className="text-dim lowercase">sell all at bid</div>
          <div className="font-mono tabular-nums text-fg">{bidSum.toFixed(1)}c</div>
          <div className="text-dim mt-0.5">
            net {c(e.sellTaker?.edgeCents ?? 0)} · size {e.sellTaker?.maxSize ?? "-"}
          </div>
        </div>
        <div>
          <div className="text-dim lowercase">sell all at mid</div>
          <div className="font-mono tabular-nums text-fg">
            {e.sellMakerAtMid ? `${e.sellMakerAtMid.grossCents.toFixed(1)}c` : "n/a"}
          </div>
          <div className="text-dim mt-0.5">
            {e.sellMakerAtMid ? `net ${c(e.sellMakerAtMid.edgeCents)} · must fill` : "maker fee unknown"}
          </div>
        </div>
        <div>
          <div className="text-dim lowercase">buy all at ask</div>
          <div className="font-mono tabular-nums text-fg">{askSum.toFixed(1)}c</div>
          <div className="text-dim mt-0.5">needs exhaustive set</div>
        </div>
      </div>

      <div className="border-t border-border pt-2 text-label leading-relaxed">
        {mispriced ? (
          <span className="text-data-pos">
            The bid/ask sums straddle $1 the wrong way, which is a genuine mispricing rather
            than a spread artifact.
          </span>
        ) : (
          <span className="text-dim">
            Bids sum to {bidSum.toFixed(1)}c, so the set is fairly priced. Aggregate spread is{" "}
            <span className="font-mono">{e.aggregateSpreadCents.toFixed(1)}c</span>, and the
            mid-price edge is about half of it. That is market-making revenue for quoting every
            leg, not arbitrage.
          </span>
        )}
      </div>
    </div>
  );
}

function Coverage({ coverage }: { coverage: ScanCoverage }) {
  const rows: [string, string][] = [
    ["markets scanned", coverage.marketsScanned.toLocaleString()],
    ["pages", `${coverage.pagesScanned}${coverage.exhausted ? " (all)" : ""}`],
    ["parlays found", coverage.parlaysFound.toLocaleString()],
    ["with a live offer", coverage.parlaysQuoted.toLocaleString()],
    ["fully priced", coverage.parlaysPriced.toLocaleString()],
    ["leg lookups", coverage.legFetches.toLocaleString()],
    ["skipped: no offer", coverage.skippedNoOffer.toLocaleString()],
    ["skipped: unpriceable", coverage.skippedUnpriceable.toLocaleString()],
    ["skipped: budget", coverage.skippedBudget.toLocaleString()],
    ["elapsed", `${(coverage.elapsedMs / 1000).toFixed(1)}s`],
  ];
  return (
    <div className="border-t border-border pt-4 space-y-3">
      <div className="text-label text-muted lowercase">coverage</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 text-label">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-2 border-b border-border pb-1">
            <span className="text-dim">{label}</span>
            <span className="font-mono tabular-nums text-fg">{value}</span>
          </div>
        ))}
      </div>
      {!coverage.exhausted && (
        <p className="text-label text-dim leading-relaxed">
          This is a bounded sample, not the whole exchange. The full open set is roughly a
          million markets and takes about four minutes to walk, so a scan inside a request
          budget cannot see all of it. &quot;No opportunities&quot; here means none in what
          was scanned.
        </p>
      )}
    </div>
  );
}

/** An LLM's proposed legs, always shown before any price derived from them. */
function ResolutionCard({ r }: { r: Resolution }) {
  return (
    <div className="border-t border-border pt-4 space-y-3">
      <div className="text-label text-muted lowercase">recovered legs</div>

      {r.legs.length > 0 && (
        <div className="space-y-2">
          {r.legs.map((leg) => (
            <div key={leg.ticker} className="text-label border-b border-border pb-2">
              <div className="flex justify-between gap-3">
                <span className="font-mono text-fg truncate">{leg.ticker}</span>
                <span
                  className={`shrink-0 font-mono ${leg.confidence === "high" ? "text-muted" : "text-data-warn"}`}
                >
                  needs {leg.needs} · {leg.confidence}
                </span>
              </div>
              <div className="text-dim mt-1">{leg.claim}</div>
              <div className="text-dim mt-0.5 italic">{leg.reasoning}</div>
            </div>
          ))}
        </div>
      )}

      {r.unresolved.length > 0 && (
        <div className="space-y-1">
          {r.unresolved.map((u) => (
            <div key={u.claim} className="text-label text-data-warn">
              unmatched: {u.claim}
              <div className="text-dim">
                {u.reason} ({u.candidatesShown} candidates shown)
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-label text-dim leading-relaxed border-t border-border pt-2">
        A model proposed these mappings from {r.corpusMarkets.toLocaleString()} live markets;
        every ticker was checked to exist before use, and no price came from the model. Read
        them before trusting anything priced on top: a leg matched to the wrong contest is a
        hedge against the wrong contract.
      </p>
    </div>
  );
}

export default function ArbPage() {
  const [scan, setScan] = useState<ScanResponse | null>(null);
  const [check, setCheck] = useState<CheckResponse | null>(null);
  const [constraints, setConstraints] = useState<ConstraintsResponse | null>(null);
  const [resolved, setResolved] = useState<ResolveResponse | null>(null);
  const [ticker, setTicker] = useState("");
  const [busy, setBusy] = useState<"scan" | "check" | "constraints" | "resolve" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [settings, setSettings] = useState<LLMSettings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [howOpen, setHowOpen] = useState(false);

  useEffect(() => {
    setSettings(loadSettings());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // ignore storage failures
    }
  }, [settings, hydrated]);

  const hasKey = settings.apiKey.trim().length > 0;

  async function post(body: unknown, kind: "scan" | "check" | "constraints" | "resolve") {
    setBusy(kind);
    setError(null);
    if (kind === "scan") setScan(null);
    else if (kind === "check") {
      setCheck(null);
      setResolved(null);
    } else if (kind === "constraints") setConstraints(null);
    else setResolved(null);
    try {
      const res = await fetch(apiUrl("/api/arb"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
      if (kind === "scan") setScan(json as ScanResponse);
      else if (kind === "check") setCheck(json as CheckResponse);
      else if (kind === "constraints") setConstraints(json as ConstraintsResponse);
      else setResolved(json as ResolveResponse);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  function recoverLegs() {
    if (!hasKey) return;
    post(
      {
        mode: "resolve",
        ticker: ticker.trim(),
        provider: settings.provider,
        apiKey: settings.apiKey,
        model: settings.model,
        maxPages: 20,
      },
      "resolve",
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-30 bg-bg border-b border-border">
        <div className="max-w-6xl mx-auto px-5 sm:px-7 py-3.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/" className="text-title font-bold lowercase">
              quantlab
            </Link>
            <TabNav />
          </div>

          <div className="flex items-center gap-2 relative">
            <button
              onClick={() => setHowOpen((v) => !v)}
              className="action text-small hidden sm:inline-flex"
              aria-expanded={howOpen}
            >
              how it works
            </button>
            {howOpen && (
              <div
                role="dialog"
                aria-label="how it works"
                onClick={() => setHowOpen(false)}
                className="absolute right-0 top-10 z-40 panel-pop px-4 py-4 w-[min(26rem,92vw)] animate-rise"
              >
                <div className="text-label text-muted lowercase mb-2">how it works</div>
                <ol className="space-y-2.5 text-small text-muted">
                  <li className="flex gap-2.5">
                    <span className="font-mono text-dim shrink-0 mt-0.5">1.</span>
                    <span>A <span className="text-fg">parlay</span> pays $1 only if every leg lands. We read its legs from Kalshi.</span>
                  </li>
                  <li className="flex gap-2.5">
                    <span className="font-mono text-dim shrink-0 mt-0.5">2.</span>
                    <span>Buying the parlay plus the <span className="text-fg">opposite side of each leg</span> pays $1 in every outcome.</span>
                  </li>
                  <li className="flex gap-2.5">
                    <span className="font-mono text-dim shrink-0 mt-0.5">3.</span>
                    <span>We price that hedge off <span className="text-fg">live order books</span> and subtract Kalshi&apos;s per-leg fee.</span>
                  </li>
                  <li className="flex gap-2.5">
                    <span className="font-mono text-dim shrink-0 mt-0.5">4.</span>
                    <span>Anything left under $1 is <span className="text-fg">risk-free</span>, no matter how correlated the legs are.</span>
                  </li>
                </ol>
                <p className="mt-4 pt-3 border-t border-border text-meta italic text-dim leading-relaxed">
                  Scanning needs no key. Only leg recovery on hand-listed parlays calls an LLM. Click anywhere to close.
                </p>
              </div>
            )}
            <ThemeToggle />
            <a
              href="https://github.com/ankitsxchdeva/quantlab"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="source on GitHub"
              className="action-chip text-small"
            >
              <GithubLogo size={14} weight="bold" />
              <span className="hidden sm:inline">GitHub</span>
            </a>
            <button
              onClick={() => setSettingsOpen(true)}
              aria-label="open provider settings"
              className="action-chip text-small"
            >
              <CogIcon />
              <span className="hidden sm:inline">settings</span>
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-5 sm:px-7 py-6 sm:py-10 space-y-6">
        <section className="relative pt-2 pb-4 sm:pt-6 sm:pb-8">
          <h1 className="text-lede font-bold text-fg">
            multi-leg arbitrage on Kalshi.
          </h1>
          <p className="mt-5 text-body text-muted max-w-prose">
            A parlay pays $1 only if every leg lands. Buy it, then buy the opposite side of
            each leg, and the worst case is still $1. If that costs under $1 after fees, the
            difference is risk-free regardless of how correlated the legs are.
          </p>
          <p className="mt-2 text-small text-dim max-w-prose">
            Fees are the whole game. Kalshi charges{" "}
            <span className="font-mono text-muted">ceil(0.07 x C x P x (1-P))</span>, which
            peaks at 50c, exactly where parlays trade. Three mid-priced legs cost about 3c per
            contract to hedge, so a 2c gap is a loss.
          </p>
        </section>

        {error && (
          <div
            role="alert"
            className="border-t border-b border-border py-3 flex items-start justify-between gap-3 animate-rise"
          >
            <div className="min-w-0 text-small text-muted">
              <p>request failed. check your connection and try again.</p>
              <p className="mt-1 break-words text-dim">{error}</p>
            </div>
            <button
              onClick={() => setError(null)}
              className="action text-small shrink-0"
              aria-label="dismiss error"
            >
              dismiss
            </button>
          </div>
        )}

        <section className="border-t border-border pt-4 space-y-4">
          <div>
            <div className="text-label text-muted lowercase mb-2">check one parlay</div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <input
                value={ticker}
                onChange={(e) => setTicker(e.target.value)}
                spellCheck={false}
                aria-label="parlay ticker"
                className="input flex-1 font-mono text-small"
                placeholder={TICKER_PLACEHOLDER}
              />
              <button
                onClick={() => post({ mode: "check", ticker: ticker.trim() }, "check")}
                disabled={busy !== null || !ticker.trim()}
                className="action-chip action-primary text-small"
              >
                {busy === "check" ? "pricing..." : "price the hedge"}
              </button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <button
                onClick={recoverLegs}
                disabled={busy !== null || !ticker.trim() || !hasKey}
                className="action-chip text-small"
              >
                {busy === "resolve" ? "recovering legs..." : "recover legs with an llm"}
              </button>
              <span className="text-label text-dim">
                {hasKey
                  ? "for hand-listed parlays that state their legs in rules text only."
                  : "needs an llm key. paste one in settings."}
              </span>
            </div>
            <p className="mt-2 text-label text-dim leading-relaxed">
              MVE parlays publish their legs as structured data and price directly. Hand-listed
              ones like <span className="font-mono">KXPROGSWEEP</span> describe them in prose,
              so recovering the legs takes a model, which proposes the mapping while the
              pricing stays deterministic.
            </p>
          </div>

          <div className="border-t border-border pt-4">
            <div className="text-label text-muted lowercase mb-2">or sweep the exchange</div>
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={() => post({ mode: "scan", maxPages: 20 }, "scan")}
                disabled={busy !== null}
                className="action-chip text-small"
              >
                {busy === "scan" ? "scanning..." : "scan 20k markets"}
              </button>
              <button
                onClick={() => post({ mode: "constraints", maxPages: 12 }, "constraints")}
                disabled={busy !== null}
                className="action-chip text-small"
              >
                {busy === "constraints" ? "scanning..." : "scan logical constraints"}
              </button>
              <span className="text-label text-dim">
                takes a few seconds. reports exactly what it covered.
              </span>
            </div>
            <p className="mt-2 text-label text-dim leading-relaxed">
              Constraints looks at mutually exclusive events instead of parlays. At most one leg
              can pay, so selling every leg for more than $1 is risk-free. No view on the
              subject required.
            </p>
          </div>
        </section>

        {resolved && (
          <section className="space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-title font-bold text-fg">
                {resolved.parlay.title || resolved.parlay.ticker}
              </h2>
              <span className="text-label text-dim font-mono">{resolved.parlay.status}</span>
            </div>
            {resolved.parlay.rules && (
              <p className="text-label text-dim leading-relaxed border-t border-border pt-3">
                {resolved.parlay.rules}
              </p>
            )}
            <ResolutionCard r={resolved.resolution} />
            {resolved.resolution.blockedReason ? (
              <div className="border-t border-border pt-4 text-small text-muted">
                not priced. {resolved.resolution.blockedReason}
              </div>
            ) : resolved.evaluation ? (
              <EvaluationCard e={resolved.evaluation} />
            ) : (
              <div className="border-t border-border pt-4 text-small text-muted">
                legs recovered, but the hedge is not priceable right now: every unsettled leg
                needs a live quote on the side you would buy.
              </div>
            )}
          </section>
        )}

        {constraints && (
          <section className="space-y-4">
            {constraints.takerOpportunities.length > 0 ? (
              <>
                <h2 className="text-title font-bold text-data-pos">
                  {constraints.takerOpportunities.length} risk-free, executable now
                </h2>
                {constraints.takerOpportunities.map((e) => (
                  <ConstraintCard key={e.eventTicker} e={e} />
                ))}
              </>
            ) : (
              <div className="border-t border-border pt-4 space-y-2">
                <h2 className="text-title font-bold text-fg">
                  nothing clears by crossing the spread
                </h2>
                <p className="text-label text-dim leading-relaxed">
                  Expected. Selling every leg pays the quadratic fee once per leg, and the gross
                  edges these sets throw off run a few cents while the fees run many more. The
                  results below clear only as resting orders, which means they are not
                  arbitrage: they require every leg to fill.
                </p>
              </div>
            )}

            {constraints.makerOpportunities.length > 0 && (
              <>
                <h2 className="text-title font-bold text-data-warn">
                  {constraints.makerOpportunities.length} clear only at mid, if every leg fills
                </h2>
                {constraints.makerOpportunities.map((e) => (
                  <ConstraintCard key={e.eventTicker} e={e} />
                ))}
              </>
            )}

            <div className="border-t border-border pt-4 space-y-3">
              <div className="text-label text-muted lowercase">coverage</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 text-label">
                {(
                  [
                    ["events scanned", constraints.coverage.eventsScanned.toLocaleString()],
                    [
                      "pages",
                      `${constraints.coverage.pagesScanned}${constraints.coverage.exhausted ? " (all)" : ""}`,
                    ],
                    ["mutually exclusive", constraints.coverage.mutuallyExclusive.toLocaleString()],
                    ["priced", constraints.coverage.priced.toLocaleString()],
                    ["skipped: unpriceable", constraints.coverage.skippedUnpriceable.toLocaleString()],
                    [
                      "skipped: maker fee unknown",
                      constraints.coverage.skippedMakerFeeUnknown.toLocaleString(),
                    ],
                    ["skipped: spread too wide", constraints.coverage.skippedWideSpread.toLocaleString()],
                    ["series lookups", constraints.coverage.seriesFetches.toLocaleString()],
                    ["elapsed", `${(constraints.coverage.elapsedMs / 1000).toFixed(1)}s`],
                  ] as [string, string][]
                ).map(([label, value]) => (
                  <div
                    key={label}
                    className="flex justify-between gap-2 border-b border-border pb-1"
                  >
                    <span className="text-dim">{label}</span>
                    <span className="font-mono tabular-nums text-fg">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {check && (
          <section className="space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-title font-bold text-fg">{check.parlay.title || check.parlay.ticker}</h2>
              <span className="text-label text-dim font-mono">{check.parlay.status}</span>
            </div>
            {check.evaluation ? (
              <EvaluationCard e={check.evaluation} />
            ) : (
              <div className="border-t border-border pt-4 text-small text-muted">
                not priceable right now. a parlay needs a live YES offer and a tradeable
                quote on every unsettled leg; a leg that already went against it makes the
                contract worthless rather than cheap.
                <div className="mt-3 border-t border-border pt-3 space-y-1">
                  {check.legs.map((leg) => (
                    <div key={leg.ticker} className="flex justify-between gap-3 text-label">
                      <span className="font-mono text-dim truncate">{leg.ticker}</span>
                      <span className="shrink-0 font-mono text-muted">
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
                <h2 className="text-title font-bold text-data-pos">
                  {scan.opportunities.length} opportunit
                  {scan.opportunities.length === 1 ? "y" : "ies"} clearing fees
                </h2>
                <div className="space-y-4">
                  {scan.opportunities.map((e) => (
                    <EvaluationCard key={e.ticker} e={e} />
                  ))}
                </div>
              </>
            ) : (
              <div className="border-t border-border pt-4 space-y-2">
                <h2 className="text-title font-bold text-fg">no arbitrage found</h2>
                <p className="text-small text-muted leading-relaxed">
                  Nothing in the scanned set clears fees. That is the normal result: Kalshi
                  prices its own parlays against the same legs, and the quadratic fee eats
                  any gap narrower than a few cents.
                </p>
              </div>
            )}

            {scan.deadParlays.length > 0 && (
              <div className="border-t border-border pt-4 space-y-2">
                <h2 className="text-title font-bold text-data-warn">
                  {scan.deadParlays.length} parlay
                  {scan.deadParlays.length === 1 ? "" : "s"} with a broken leg
                </h2>
                <p className="text-label text-dim">
                  A leg already resolved against these, so they can never pay. Buying NO
                  returns $1 if the settlement is final.
                </p>
                <div className="space-y-1">
                  {scan.deadParlays.slice(0, 10).map((d) => (
                    <div key={d.ticker} className="flex justify-between gap-3 text-label">
                      <span className="font-mono text-dim truncate">{d.ticker}</span>
                      <span className="shrink-0 font-mono tabular-nums text-fg">
                        bid {c(d.yesBidCents)} · {c(d.profitCentsPerContract)}/contract
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {scan.nearMisses.length > 0 && (
              <div className="border-t border-border pt-4 space-y-3">
                <div className="text-label text-muted lowercase">closest misses</div>
                <div className="space-y-1">
                  {scan.nearMisses.slice(0, 10).map((e) => (
                    <button
                      key={e.ticker}
                      onClick={() => setTicker(e.ticker)}
                      className="w-full flex justify-between gap-3 text-label text-left text-muted hover:text-accent-hover px-1 -mx-1 py-0.5 transition-colors"
                      title="load this ticker into the checker"
                    >
                      <span className="font-mono truncate">{e.ticker}</span>
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

      <footer className="max-w-6xl mx-auto w-full px-5 sm:px-7 py-10 mt-8 text-label text-dim border-t border-border">
        <div className="grid sm:grid-cols-[1fr_auto] gap-y-5 gap-x-8 items-start">
          <div className="space-y-3 max-w-prose">
            <p className="text-muted leading-relaxed">
              Quotes are a snapshot of the order book at scan time, not a fill. Depth moves, legs go untradeable, and an edge that clears fees on paper can be gone before every leg is on. Use this to find candidates, not to size a position. Nothing here is investment advice.
            </p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <span>your api key never leaves your browser</span>
              <span>no accounts, no tracking, no upsells</span>
            </div>
          </div>
          <div className="flex sm:flex-col gap-4 sm:gap-1 sm:items-end">
            <span className="font-mono text-muted">quantlab</span>
            <span>v0.1</span>
          </div>
        </div>
      </footer>

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onChange={setSettings}
      />
    </div>
  );
}
