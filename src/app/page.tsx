"use client";

import { useEffect, useMemo, useState } from "react";
import SettingsPanel, { type LLMSettings } from "@/components/SettingsPanel";
import StrategyInput, { type ExampleGroup } from "@/components/StrategyInput";
import StrategyView from "@/components/StrategyView";
import MetricsCards from "@/components/MetricsCards";
import EquityChart from "@/components/EquityChart";
import PriceChart from "@/components/PriceChart";
import TradeLog from "@/components/TradeLog";
import ResultsHeadline from "@/components/ResultsHeadline";
import MarketBadge from "@/components/MarketBadge";
import PhaseIndicator from "@/components/PhaseIndicator";
import type { BacktestResult } from "@/lib/types";
import type { Strategy } from "@/lib/strategy/schema";
import { getExampleResult } from "@/lib/demo/example";

const SETTINGS_KEY = "algotrading.llm.settings.v1";

const DEFAULT_SETTINGS: LLMSettings = {
  provider: "openai",
  apiKey: "",
  model: undefined,
};

const EXAMPLE_GROUPS: ExampleGroup[] = [
  {
    label: "Classics",
    items: [
      "Buy AAPL when its 50-day SMA crosses above its 200-day SMA, sell when it crosses back below",
      "Go long SPY when RSI(14) drops below 30, exit when RSI rises above 70, with a 5% stop loss",
      "Long QQQ on every monthly close above its 12-month moving average, otherwise hold cash",
    ],
  },
  {
    label: "Memes",
    items: [
      "Buy NVDA every time it drops 8% in a day, sell when it recovers 4%, with a 10% stop",
      "Buy TSLA whenever RSI(2) drops under 10, exit on the next green candle",
      "Long DOGE-USD when price breaks above its 20-day high with a 7% trailing stop",
    ],
  },
  {
    label: "Prediction markets",
    items: [
      "Buy YES on the Polymarket Trump 2028 nomination market when it dips below 30 cents, exit above 60 cents",
      "Polymarket momentum: long any election market when its 24-hour average crosses above its 7-day average",
    ],
  },
  {
    label: "Counter-intuitive",
    items: [
      "Sell SPY into strength: short whenever it closes 2% above its 20-day high, cover at the next close below the 5-day low",
      "Fade the morning gap on QQQ: when the open is 1% above yesterday's close, short for the day with a 0.5% stop",
    ],
  },
];

interface RunResponse {
  strategy: Strategy;
  result: BacktestResult;
}

interface ErrorResponse {
  error: string;
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

function MiniEquitySVG() {
  return (
    <svg viewBox="0 0 360 120" className="w-full h-full" aria-hidden="true">
      <defs>
        <linearGradient id="fade-accent" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.32" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d="M0,96 L18,90 L38,93 L60,78 L82,82 L104,68 L124,72 L148,55 L168,60 L188,46 L210,52 L232,38 L254,44 L274,28 L298,34 L320,20 L340,26 L360,12"
        fill="none"
        stroke="var(--accent)"
        strokeOpacity="0.65"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M0,96 L18,90 L38,93 L60,78 L82,82 L104,68 L124,72 L148,55 L168,60 L188,46 L210,52 L232,38 L254,44 L274,28 L298,34 L320,20 L340,26 L360,12 L360,120 L0,120 Z"
        fill="url(#fade-accent)"
      />
      <path
        d="M0,108 L40,104 L80,100 L120,93 L160,88 L200,80 L240,72 L280,64 L320,56 L360,46"
        fill="none"
        stroke="var(--text-3)"
        strokeOpacity="0.5"
        strokeWidth="1"
        strokeDasharray="2 3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CogIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
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
  const canRun = hydrated && hasKey && prompt.trim().length > 0 && !loading;

  const disabledReason = useMemo(() => {
    if (!hydrated) return undefined;
    if (!hasKey) return "Add your LLM API key in settings to start.";
    if (prompt.trim().length === 0) return "Type or pick an idea to begin.";
    return undefined;
  }, [hydrated, hasKey, prompt]);

  function showExample() {
    const ex = getExampleResult();
    setError(null);
    setStrategy(ex.strategy);
    setResult(ex.result);
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
    try {
      const res = await fetch("/api/run", {
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
        throw new Error(data.error || `Request failed with status ${res.status}`);
      }
      if (!data.strategy || !data.result) {
        throw new Error("Malformed response from server");
      }
      setStrategy(data.strategy);
      setResult(data.result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  const showHero = !result && !loading;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-30 bg-surface-0/85 backdrop-blur-sm border-b border-border">
        <div className="max-w-6xl mx-auto px-5 sm:px-7 py-3.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-mono text-sm tracking-tight text-text-1 font-medium">quantlab</span>
            <span className="hidden sm:inline-block w-1 h-1 rounded-full bg-text-3" aria-hidden="true" />
            <span className="hidden sm:inline text-xs text-text-3 truncate">a quant lab for normal people</span>
          </div>

          <div className="flex items-center gap-2 relative">
            <button
              onClick={() => setHowOpen((v) => !v)}
              className="btn btn-ghost text-xs h-8 px-2.5 hidden sm:inline-flex"
              aria-expanded={howOpen}
            >
              How it works
            </button>
            {howOpen && (
              <div
                role="dialog"
                aria-label="How it works"
                onClick={() => setHowOpen(false)}
                className="absolute right-0 top-10 z-40 panel-raised px-4 py-3 max-w-sm w-[min(22rem,90vw)] animate-fade-in"
              >
                <p className="text-sm text-text-1 leading-relaxed">
                  You type a trading idea. We send it to your chosen LLM (with your key) to compile into structured rules, fetch real price history, simulate every trade, and show you the result.
                </p>
                <p className="mt-2 text-xs text-text-3">Click anywhere to close.</p>
              </div>
            )}
            <button
              onClick={() => setSettingsOpen(true)}
              aria-label="Open provider settings"
              className="btn btn-secondary h-8 px-2.5 text-xs flex items-center gap-1.5"
            >
              <CogIcon />
              <span className="hidden sm:inline">Settings</span>
              {hydrated && !hasKey && (
                <span className="ml-0.5 inline-block w-1.5 h-1.5 rounded-full bg-danger animate-pulse-soft" aria-label="API key required" />
              )}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-5 sm:px-7 py-6 sm:py-10 space-y-6">
        {showHero && (
          <section className="relative pt-2 pb-4 sm:pt-6 sm:pb-8">
            <div className="grid lg:grid-cols-[1fr_280px] gap-6 lg:gap-10 items-end">
              <div>
                <h1 className="text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight text-text-1 leading-[1.05]">
                  <span className="block">Test the wildest trading idea you have.</span>
                  <span className="block text-text-2 mt-1">In plain English.</span>
                </h1>
                <p className="mt-5 text-base sm:text-lg text-text-2 max-w-prose leading-relaxed">
                  Your hypothesis. Real market data. Honest math.
                </p>
                <p className="mt-1 text-sm text-text-3 max-w-prose">
                  Works on stocks, ETFs, crypto, and Polymarket prediction markets.
                </p>

                <div className="mt-6 flex items-center gap-3">
                  <button
                    onClick={showExample}
                    className="btn btn-secondary text-sm h-9"
                  >
                    <span>See an example backtest</span>
                    <ArrowIcon />
                  </button>
                  <span className="text-xs text-text-3 hidden sm:inline">No key required.</span>
                </div>

                <ol className="mt-8 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3 text-xs text-text-3 font-mono">
                  {["Describe an idea", "Compile to rules", "Pull real history", "Simulate every trade"].map((step, i, arr) => (
                    <li key={step} className="flex items-baseline gap-2">
                      <span className="text-text-2">{i + 1}.</span>
                      <span>{step}</span>
                      {i < arr.length - 1 && <span className="text-text-3 ml-2 hidden sm:inline" aria-hidden="true">→</span>}
                    </li>
                  ))}
                </ol>
              </div>

              <div className="hidden lg:block h-[112px] opacity-80">
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
          <div
            role="alert"
            className="px-4 py-3 flex items-start justify-between gap-3 rounded-lg border animate-fade-in"
            style={{ borderColor: "color-mix(in oklch, var(--danger) 40%, transparent)", backgroundColor: "color-mix(in oklch, var(--danger) 10%, transparent)" }}
          >
            <div className="min-w-0">
              <div className="text-sm font-medium text-text-1">Run failed</div>
              <div className="text-sm text-text-2 mt-1 break-words">{error}</div>
            </div>
            <button
              onClick={() => setError(null)}
              className="text-xs text-text-3 hover:text-text-1 shrink-0"
              aria-label="Dismiss error"
            >
              Dismiss
            </button>
          </div>
        )}

        {result && strategy && (
          <div className="space-y-5">
            <div className="flex items-center justify-between flex-wrap gap-3 panel px-4 py-3 animate-fade-in" style={{ animationDelay: "0ms" }}>
              <MarketBadge market={result.market} />
              <div className="flex items-center gap-2">
                {result.warnings.length > 0 && (
                  <span className="text-xs text-warning">
                    {result.warnings.length} warning{result.warnings.length === 1 ? "" : "s"}
                  </span>
                )}
                <button
                  onClick={() => { setResult(null); setStrategy(null); setError(null); }}
                  className="btn btn-secondary h-8 text-xs"
                >
                  Try another idea
                </button>
              </div>
            </div>

            <div className="animate-fade-in" style={{ animationDelay: "60ms" }}>
              <ResultsHeadline result={result} strategy={strategy} />
            </div>

            {result.warnings.length > 0 && (
              <div
                className="px-4 py-3 rounded-lg border text-sm animate-fade-in"
                style={{
                  animationDelay: "120ms",
                  borderColor: "color-mix(in oklch, var(--warning) 40%, transparent)",
                  backgroundColor: "color-mix(in oklch, var(--warning) 8%, transparent)",
                }}
              >
                <div className="micro-label mb-1.5">Caveats</div>
                <ul className="list-disc list-inside space-y-0.5 text-text-2">
                  {result.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="animate-fade-in" style={{ animationDelay: "140ms" }}>
              <PriceChart bars={result.bars} trades={result.trades} symbol={result.market.label} timeframe={strategy.timeframe} />
            </div>
            <div className="animate-fade-in" style={{ animationDelay: "200ms" }}>
              <MetricsCards metrics={result.metrics} />
            </div>
            <div className="animate-fade-in" style={{ animationDelay: "260ms" }}>
              <EquityChart equity={result.equity} benchmark={result.benchmark} />
            </div>
            <div className="animate-fade-in" style={{ animationDelay: "320ms" }}>
              <StrategyView strategy={strategy} />
            </div>
            <div className="animate-fade-in" style={{ animationDelay: "380ms" }}>
              <TradeLog trades={result.trades} />
            </div>
          </div>
        )}
      </main>

      <footer className="max-w-6xl mx-auto w-full px-5 sm:px-7 py-8 mt-6 text-xs text-text-3 border-t border-border">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span>Backtests model what would have happened, not what will. Use this to learn, not to invest.</span>
          <span className="font-mono">quantlab</span>
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
