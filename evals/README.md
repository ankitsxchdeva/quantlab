# LLM compile eval harness

Measures how reliably each LLM provider compiles natural-language trading ideas into valid Strategy JSON, and how much the built-in one-shot repair loop improves that rate.

## What it does

`compile.eval.test.ts` runs every prompt in `prompts.json` (50 prompts across five groups: classics, memes, prediction markets, counter-intuitive, adversarial) through the real `compileStrategy` for each provider you supply a key for, then scores each result:

- **zod valid**: the model produced an object that passes the Zod `StrategySchema`, possibly after the repair attempt.
- **semantic valid**: the strategy also passes `validateStrategy` (every `{ ref }` and bare-string reference resolves to a declared indicator id, no ids shadow price sources, no duplicate ids). This is the definition of "compile succeeded".
- **first try**: the strategy was valid without needing the repair call.
- **rescued by repair**: the first attempt failed (schema or semantic) and the single repair call produced a valid strategy. This column is the measured lift from the repair loop.
- **traded >= 1**: running the compiled strategy through `runBacktest` over deterministic synthetic bars (see `synthetic.ts`; stock bars for `market: "stock"`, probability bars in (0, 1) for `market: "polymarket"`) produced at least one closed trade. A valid strategy that never trades is often a sign the model picked unreachable thresholds.

A rate table per group plus a TOTAL row is logged per provider, followed by the error message of every failed prompt.

The adversarial group is expected to score lower by design: it contains ambiguous assets, indicators the DSL does not have (Ichimoku, on-chain data), a trailing stop the DSL cannot express, date-range requests, and arithmetic phrasing. What matters there is that the model degrades gracefully into a runnable approximation instead of emitting invalid JSON.

## How to run

The suite needs your own API keys. It costs real money (up to 100 LLM calls per provider: 50 prompts plus at most one repair each) and takes a few minutes.

```sh
EVAL_OPENAI_KEY=sk-... npx vitest run --config vitest.evals.config.ts
```

Provide any subset of:

- `EVAL_OPENAI_KEY` (optional `EVAL_OPENAI_MODEL`, default gpt-4o-mini)
- `EVAL_ANTHROPIC_KEY` (optional `EVAL_ANTHROPIC_MODEL`, default claude-sonnet-4-6)
- `EVAL_GOOGLE_KEY` (optional `EVAL_GOOGLE_MODEL`, default gemini-2.0-flash)

Providers without a key are skipped. With no keys at all the whole suite skips cleanly, so it is safe to keep in the repo and out of CI's way (`vitest.evals.config.ts` only includes `evals/`, and the main `vitest.config.ts` only includes `src/`, so neither run picks up the other).

## Reading the score

The headline number is the TOTAL row: "semantic valid" is the share of prompts that compiled into a strategy the backtest engine will actually resolve, and the gap between "first try" and "semantic valid" is what the repair loop bought you. Compare TOTAL rows across providers to pick a default model, and compare the adversarial row against the rest to see how much of the remaining failure budget is prompts the DSL genuinely cannot express.
