# algotrading

Natural-language backtesting. Describe a trading theory, get a backtest.

- Bring your own LLM key (OpenAI / Anthropic / Google). Never persisted server-side.
- LLM converts plain English into a structured strategy DSL · no code generation, no `eval`.
- Pure-TypeScript backtest engine. Free market data via Yahoo Finance.

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:3000, paste your LLM API key, describe a strategy.

## Architecture

- `src/lib/strategy/` · strategy DSL schema (Zod) + interpreter
- `src/lib/backtest/` · engine, metrics, trade simulator
- `src/lib/data/` · market data adapters (Yahoo Finance)
- `src/lib/llm/` · multi-provider LLM adapter (Vercel AI SDK)
- `src/app/api/` · server routes (compile strategy, run backtest)
- `src/app/` · UI (chat input, equity chart, metrics, trades)

## Strategy DSL

The LLM emits JSON like:

```json
{
  "name": "SMA crossover",
  "asset": "AAPL",
  "timeframe": "1d",
  "indicators": [
    { "id": "fast", "type": "SMA", "source": "close", "period": 10 },
    { "id": "slow", "type": "SMA", "source": "close", "period": 50 }
  ],
  "entries": [
    { "side": "long", "when": { "op": "crosses_above", "left": "fast", "right": "slow" } }
  ],
  "exits": [
    { "when": { "op": "crosses_below", "left": "fast", "right": "slow" } }
  ],
  "risk": { "positionSizePct": 100, "stopLossPct": 5, "takeProfitPct": 10 }
}
```

This data, not code, drives the backtester · no sandbox required.
