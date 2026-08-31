# quantlab design

All design decisions follow ~/Documents/design/DESIGN.md (Colophon, v0.4,
canonical lane). Do not invent colors, fonts, spacing, or motion outside it.
Where any skill or model suggestion conflicts, the spec wins.

This file holds only quantlab's project-specific addenda, which extend the
spec without overriding it.

## Addenda

- **Data hues are data.** `--data-pos` / `--data-neg` / `--data-warn` appear
  on P&L numbers, candlesticks, trade markers, win/loss counts, robustness
  verdicts, and edge figures. `--data-bench` is the neutral comparison series
  (buy & hold, Monte Carlo bands). Chrome (errors, empty states, labels,
  hints) is muted ink that names the retry, never red, never amber.
- **Charts resolve tokens at runtime** through `src/lib/chartTheme.ts`;
  canvas cannot read CSS variables. Never hardcode a hex in a chart
  component. Charts rebuild on theme change via `onThemeChange`
  (`src/lib/theme.ts`). Plot backgrounds are transparent; the strategy's own
  equity curve is the one licensed accent series.
- **Theme** mechanics are the spec's: `data-theme` on `<html>`, persisted to
  localStorage as `quantlab.theme`, absent choice follows
  `prefers-color-scheme`. The header toggle (`src/components/ThemeToggle.tsx`)
  names the action, not the state.
- **Type scale mapping.** Headline figures (the results money line) use the
  display tier once per page; metric values use lede/body in bold mono. Acute
  hierarchy comes from weight and the dimming ladder, not extra sizes.
- **Voice.** Chrome, labels, buttons, and short notes are lowercase; proper
  nouns and acronyms keep case. Longer explanatory prose (tooltips, the
  disclaimer) keeps sentence case.
- **The one image** is the hero mini equity curve: two strokes, line work
  only, no fills or gradients.

## History

Pre-Colophon, quantlab ran a standalone system (warm amber neutrals, Geist,
green accent, dark-only). Superseded in favor of tracking the shared spec.
