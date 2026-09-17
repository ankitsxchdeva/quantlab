"use client";

import { useEffect, useMemo, useState } from "react";
import { Gear, GithubLogo } from "@phosphor-icons/react";
import SettingsPanel, { type LLMSettings } from "@/components/SettingsPanel";
import ThemeToggle from "@/components/ThemeToggle";
import { apiUrl } from "@/lib/apiBase";
import TabNav from "@/components/TabNav";
import StrategyInput, { type ExampleGroup } from "@/components/StrategyInput";
import StrategyView from "@/components/StrategyView";
import MetricsCards from "@/components/MetricsCards";
import EquityChart from "@/components/EquityChart";
import PriceChart from "@/components/PriceChart";
import TradeLog from "@/components/TradeLog";
import ResultsHeadline from "@/components/ResultsHeadline";
import MarketBadge from "@/components/MarketBadge";
import PhaseIndicator from "@/components/PhaseIndicator";
import RobustnessCard from "@/components/RobustnessCard";
import LiveSignalCard from "@/components/LiveSignalCard";
import type { BacktestResult } from "@/lib/types";
import type { Strategy } from "@/lib/strategy/schema";
import { assessRobustness, type RobustnessReport } from "@/lib/backtest/robustness";
import { runMonteCarlo } from "@/lib/backtest/montecarlo";
import { getExampleResult } from "@/lib/demo/example";

const SETTINGS_KEY = "algotrading.llm.settings.v1";

const DEFAULT_SETTINGS: LLMSettings = {
  provider: "openai",
  apiKey: "",
  model: undefined,
};

const EXAMPLE_GROUPS: ExampleGroup[] = [
  {
    label: "classics",
    items: [
      "Buy AAPL when its 50-day SMA crosses above its 200-day SMA, sell when it crosses back below",
      "Go long SPY when RSI(14) drops below 30, exit when RSI rises above 70, with a 5% stop loss",
      "Long QQQ on every monthly close above its 12-month moving average, otherwise hold cash",
    ],
  },
  {
    label: "memes",
    items: [
      "Buy NVDA every time it drops 8% in a day, sell when it recovers 4%, with a 10% stop",
      "Buy TSLA whenever RSI(2) drops under 10, exit on the next green candle",
      "Long DOGE-USD when price breaks above its 20-day high with a 7% trailing stop",
    ],
  },
  {
    label: "prediction markets",
    items: [
      "Buy YES on the Polymarket Trump 2028 nomination market when it dips below 30 cents, exit above 60 cents",
      "Polymarket momentum: long any election market when its 24-hour average crosses above its 7-day average",
    ],
  },
  {
    label: "counter-intuitive",
    items: [
      "Sell SPY into strength: short whenever it closes 2% above its 20-day high, cover at the next close below the 5-day low",
      "Fade the morning gap on QQQ: when the open is 1% above yesterday's close, short for the day with a 0.5% stop",
    ],
  },
];

interface StageTimings {
  compileMs: number;
  fetchMs: number;
  backtestMs: number;
}

interface RunResponse {
  strategy: Strategy;
  result: BacktestResult;
  requestId?: string;
  timings?: StageTimings;
  robustness?: RobustnessReport;
}

interface ErrorResponse {
  error: string;
  // 502/500 bodies echo the compiled strategy so users can see what the LLM
  // produced even when the data fetch or backtest failed.
  strategy?: Strategy;
}

function fmtDur(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

// Same gate as the API: robustness needs enough closed trades to resample.
function demoRobustness(result: BacktestResult, strategy: Strategy): RobustnessReport | null {
  if (result.trades.length < 5) return null;
  return {
    split: assessRobustness(strategy, result.bars),
    monteCarlo: runMonteCarlo(result.trades, result.metrics.initialEquity),
  };
}

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

/*
 * The one image that carries weight (§2 imagery): the product's whole promise
 * as two strokes. Line work only; fills and gradients are banned.
 */
function MiniEquitySVG() {
  return (
    <svg viewBox="0 0 360 120" className="w-full h-full" aria-hidden="true">
      <path
        d="M0,96 L18,90 L38,93 L60,78 L82,82 L104,68 L124,72 L148,55 L168,60 L188,46 L210,52 L232,38 L254,44 L274,28 L298,34 L320,20 L340,26 L360,12"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M0,108 L40,104 L80,100 L120,93 L160,88 L200,80 L240,72 L280,64 L320,56 L360,46"
        fill="none"
        stroke="var(--muted)"
        strokeWidth="1"
        strokeDasharray="2 3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function Page() {
  const [hydrated, setHydrated] = useState(false);
  const [settings, setSettings] = useState<LLMSettings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [howOpen, setHowOpen] = useState(false);

  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [computeMs, setComputeMs] = useState<number | null>(null);
  const [timings, setTimings] = useState<StageTimings | null>(null);
  const [robustness, setRobustness] = useState<RobustnessReport | null>(null);

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

  // Esc closes the topmost layer (No Dead Keys).
  useEffect(() => {
    if (!howOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setHowOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [howOpen]);

  const hasKey = settings.apiKey.trim().length > 0;
  const canRun = hydrated && hasKey && prompt.trim().length > 0 && !loading;

  const disabledReason = useMemo(() => {
    if (!hydrated) return undefined;
    if (!hasKey) return "add your LLM API key in settings to start.";
    if (prompt.trim().length === 0) return "type or pick an idea to begin.";
    return undefined;
  }, [hydrated, hasKey, prompt]);

  function showExample() {
    const ex = getExampleResult();
    setError(null);
    setStrategy(ex.strategy);
    setResult(ex.result);
    setComputeMs(ex.computeMs);
    setTimings(null);
    setRobustness(demoRobustness(ex.result, ex.strategy));
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  async function run() {
    if (!canRun) return;
    setLoading(true);
    setError(null);
    setStrategy(null);
    setResult(null);
    setComputeMs(null);
    setTimings(null);
    setRobustness(null);
    try {
      const res = await fetch(apiUrl("/api/run"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          provider: settings.provider,
          apiKey: settings.apiKey,
          model: settings.model,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<RunResponse & ErrorResponse>;
      if (!res.ok) {
        // Error bodies may still carry the compiled strategy; keep it so the
        // user can see what the LLM produced before the pipeline failed.
        if (data.strategy) setStrategy(data.strategy);
        throw new Error(data.error || `Request failed with status ${res.status}`);
      }
      if (!data.strategy || !data.result) {
        throw new Error("Malformed response from server");
      }
      setStrategy(data.strategy);
      setResult(data.result);
      setTimings(data.timings ?? null);
      setRobustness(data.robustness ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  const showHero = !result && !loading;

  return (
    <div className="min-h-[100dvh] flex flex-col">
      <header className="sticky top-0 z-30 bg-bg border-b border-border">
        <div className="max-w-6xl mx-auto px-5 sm:px-7 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 sm:gap-4 min-w-0">
            <span className="text-title font-bold">quantlab</span>
            <TabNav />
          </div>

          <div className="flex items-center gap-2 sm:gap-3 relative">
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
                className="absolute right-0 top-9 z-40 panel-pop px-4 py-4 w-[min(26rem,92vw)] animate-rise text-left"
              >
                <div className="text-label text-muted mb-2">how it works</div>
                <ol className="space-y-2.5 text-small text-muted">
                  <li className="flex gap-2.5">
                    <span className="font-mono text-dim shrink-0 mt-0.5">1.</span>
                    <span><span className="text-fg">describe an idea</span> in plain English. we send it to your LLM provider with your API key.</span>
                  </li>
                  <li className="flex gap-2.5">
                    <span className="font-mono text-dim shrink-0 mt-0.5">2.</span>
                    <span>the LLM emits <span className="text-fg">structured rules</span> (indicators, entry conditions, exits, risk). not code, just data.</span>
                  </li>
                  <li className="flex gap-2.5">
                    <span className="font-mono text-dim shrink-0 mt-0.5">3.</span>
                    <span>we pull real <span className="text-fg">OHLCV history</span> from Yahoo Finance or Polymarket.</span>
                  </li>
                  <li className="flex gap-2.5">
                    <span className="font-mono text-dim shrink-0 mt-0.5">4.</span>
                    <span>our engine <span className="text-fg">simulates every bar</span>, tracks every trade, computes Sharpe, drawdown, vs buy-and-hold.</span>
                  </li>
                </ol>
                <p className="mt-4 pt-3 border-t border-border text-meta text-dim italic leading-relaxed">
                  your key stays in this browser. strategies are data, not executable code. click anywhere to close.
                </p>
              </div>
            )}
            <ThemeToggle />
            <a
              href="https://github.com/ankitsxchdeva/quantlab"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="source on GitHub"
              className="action-chip text-small h-8 px-2 sm:px-2.5"
            >
              <GithubLogo size={14} weight="bold" />
              <span className="hidden sm:inline">GitHub</span>
            </a>
            <button
              onClick={() => setSettingsOpen(true)}
              aria-label="open provider settings"
              className="action-chip text-small h-8 px-2 sm:px-2.5"
            >
              <Gear size={14} />
              <span className="hidden sm:inline">settings</span>
              {hydrated && !hasKey && (
                <>
                  <span className="badge hidden sm:inline-flex" aria-label="API key required">key needed</span>
                  <span className="sm:hidden w-1.5 h-1.5 rounded-[2px] bg-accent" aria-label="API key required" />
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-5 sm:px-7 py-6 sm:py-10 space-y-6">
        {showHero && (
          <section className="pt-2 pb-4 sm:pt-6 sm:pb-8">
            <div className="grid lg:grid-cols-[1fr_280px] gap-6 lg:gap-10 items-end">
              <div>
                <h1 className="text-display text-fg">
                  <span className="block">test the wildest trading idea you have.</span>
                  <span className="block text-muted mt-1">in plain English.</span>
                </h1>
                <p className="mt-5 text-lede text-muted max-w-[68ch]">
                  your hypothesis. real market data. honest math.
                </p>
                <p className="mt-1 text-small text-dim max-w-[68ch]">
                  works on stocks, ETFs, crypto, and Polymarket prediction markets.
                </p>

                <div className="mt-6 flex items-center gap-3">
                  <button
                    onClick={showExample}
                    className="action-chip action-primary text-small"
                  >
                    see an example backtest
                  </button>
                  <span className="text-meta text-dim hidden sm:inline">no key required.</span>
                </div>

                <ol className="mt-8 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2 text-meta text-dim">
                  {["describe an idea", "compile to rules", "pull real history", "simulate every trade"].map((step, i, arr) => (
                    <li key={step} className="flex items-baseline gap-2">
                      <span className="font-mono">{i + 1}.</span>
                      <span>{step}</span>
                      {i < arr.length - 1 && <span className="mark ml-2 hidden sm:inline" aria-hidden="true">→</span>}
                    </li>
                  ))}
                </ol>
              </div>

              <div className="hidden lg:block h-[112px]">
                <MiniEquitySVG />
              </div>
            </div>
          </section>
        )}

        {(!result || loading) && (
          <StrategyInput
            value={prompt}
            onChange={setPrompt}
            onRun={run}
            exampleGroups={EXAMPLE_GROUPS}
            loading={loading}
            canRun={canRun}
            disabledReason={disabledReason}
            showExamples={!result && !loading}
          />
        )}

        <PhaseIndicator active={loading} />

        {error && (
          <div role="alert" className="border-t border-border pt-4 animate-rise">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-title font-bold">run failed</p>
              <button
                onClick={() => setError(null)}
                className="action text-label shrink-0"
                aria-label="dismiss error"
              >
                dismiss
              </button>
            </div>
            <p className="text-small text-muted mt-1 break-words">{error}</p>
            <p className="text-small text-muted mt-1">adjust the prompt or your settings, then run again.</p>
          </div>
        )}

        {error && strategy && !result && (
          <div className="space-y-2 animate-rise">
            <p className="text-small text-muted">
              the LLM did compile your idea before the run failed. here is the strategy it produced:
            </p>
            <StrategyView strategy={strategy} />
          </div>
        )}

        {result && strategy && (
          <div className="space-y-5">
            <div className="flex items-center justify-between flex-wrap gap-3 border-y border-border py-3 animate-rise" style={{ animationDelay: "0ms" }}>
              <MarketBadge market={result.market} />
              <div className="flex items-center gap-3">
                {result.warnings.length > 0 && (
                  <span className="text-meta text-dim">
                    {result.warnings.length} caveat{result.warnings.length === 1 ? "" : "s"}
                  </span>
                )}
                {timings ? (
                  <span className="text-meta text-dim font-mono tabular-nums" title="per-stage time measured on the server: LLM compile, market data fetch, backtest simulation.">
                    llm {fmtDur(timings.compileMs)} <span className="mark" aria-hidden="true">·</span> data {fmtDur(timings.fetchMs)} <span className="mark" aria-hidden="true">·</span> backtest {fmtDur(timings.backtestMs)}
                  </span>
                ) : computeMs !== null ? (
                  <span className="text-meta text-dim font-mono tabular-nums" title="backtest simulation time for the demo dataset.">
                    backtest {fmtDur(computeMs)}
                  </span>
                ) : null}
                <button
                  onClick={() => { setResult(null); setStrategy(null); setError(null); setComputeMs(null); setTimings(null); setRobustness(null); }}
                  className="action-chip text-small"
                >
                  try another idea
                </button>
              </div>
            </div>

            <div className="animate-rise" style={{ animationDelay: "40ms" }}>
              <ResultsHeadline result={result} strategy={strategy} />
            </div>

            <div className="animate-rise" style={{ animationDelay: "80ms" }}>
              <LiveSignalCard trades={result.trades} assetLabel={result.market.label} />
            </div>

            {result.warnings.length > 0 && (
              <div
                className="border-t border-border pt-4 animate-rise"
                style={{ animationDelay: "120ms" }}
              >
                <div className="text-label text-muted mb-1.5">caveats</div>
                <ul className="list-disc list-inside space-y-0.5 text-small text-muted">
                  {result.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="animate-rise" style={{ animationDelay: "140ms" }}>
              <PriceChart bars={result.bars} trades={result.trades} symbol={result.market.label} timeframe={strategy.timeframe} />
            </div>
            <div className="animate-rise" style={{ animationDelay: "160ms" }}>
              <MetricsCards metrics={result.metrics} />
            </div>
            {robustness && (robustness.split || robustness.monteCarlo) && (
              <div className="animate-rise" style={{ animationDelay: "180ms" }}>
                <RobustnessCard report={robustness} />
              </div>
            )}
            <div className="animate-rise" style={{ animationDelay: "180ms" }}>
              <EquityChart equity={result.equity} benchmark={result.benchmark} bands={robustness?.monteCarlo?.equityBands} />
            </div>
            <div className="animate-rise" style={{ animationDelay: "200ms" }}>
              <StrategyView strategy={strategy} />
            </div>
            <div className="animate-rise" style={{ animationDelay: "200ms" }}>
              <TradeLog trades={result.trades} />
            </div>
          </div>
        )}
      </main>

      <footer className="max-w-6xl mx-auto w-full px-5 sm:px-7 py-10 mt-8 border-t border-border">
        <div className="grid sm:grid-cols-[1fr_auto] gap-y-5 gap-x-8 items-start">
          <div className="space-y-3 max-w-[68ch]">
            <p className="text-small text-muted leading-relaxed">
              backtests model what would have happened, not what will. use this to learn, not to invest. indicators and metrics are computed from the rules you describe and the price history we fetch. nothing here is investment advice.
            </p>
            <p className="text-meta text-dim">
              your API key never leaves this browser <span className="mark" aria-hidden="true">·</span> no accounts, no tracking, no upsells
            </p>
          </div>
          <div className="flex sm:flex-col gap-4 sm:gap-1 sm:items-end text-meta">
            <span className="text-muted">quantlab</span>
            <span className="text-dim">v0.1</span>
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
