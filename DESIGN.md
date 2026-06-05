# quantlab design system

## Scene

A retail quant at a kitchen table, late evening, MacBook screen. They have a hypothesis and twenty minutes before they go to bed. They want the tool to feel like a serious lab notebook · not a casino, not a terminal · and they want their idea to look smart when it works.

Dark mode is the default. Light is supported but not the hero.

## Color

Strategy: **Restrained** with a single accent reserved for primary action and positive outcomes.

Neutrals are warm-tinted (slight amber bias, low chroma) so the UI doesn't read as cold or terminal. We never use `#000` or `#fff`.

OKLCH ramp (dark mode):

| Token | OKLCH | Hex (≈) | Use |
|---|---|---|---|
| `--surface-0` | `oklch(0.16 0.005 80)` | `#1a1814` | App background |
| `--surface-1` | `oklch(0.20 0.006 80)` | `#221f1a` | Panels |
| `--surface-2` | `oklch(0.24 0.006 80)` | `#2a2620` | Hover, raised |
| `--border` | `oklch(0.30 0.006 80)` | `#36312a` | Hairlines |
| `--border-strong` | `oklch(0.40 0.008 80)` | `#4d473e` | Active borders |
| `--text-1` | `oklch(0.96 0.006 80)` | `#f5f1ea` | Primary text |
| `--text-2` | `oklch(0.72 0.008 80)` | `#a9a298` | Secondary text |
| `--text-3` | `oklch(0.52 0.008 80)` | `#787268` | Tertiary, muted |

Semantic:

| Token | OKLCH | Hex (≈) | Use |
|---|---|---|---|
| `--accent` | `oklch(0.72 0.16 145)` | `#3ec27a` | Primary action, positive outcomes |
| `--accent-soft` | `oklch(0.30 0.06 145)` | `#1d3a26` | Accent backgrounds |
| `--danger` | `oklch(0.65 0.20 25)` | `#e26241` | Losses, errors, stops |
| `--warning` | `oklch(0.78 0.13 75)` | `#d9a85a` | Warnings, drawdowns |
| `--info` | `oklch(0.70 0.10 240)` | `#6592c4` | Informational, links |

Accent is reserved: primary CTAs, positive return numbers, the resolved "current" tab. Decoration uses tinted neutrals.

## Typography

One family: **Geist** (variable). Mono pairing: **JetBrains Mono** for numbers, tickers, and code-shaped content. System fallback always: `system-ui, -apple-system, "Segoe UI", sans-serif`.

Fixed rem scale, 1.2 ratio:

| Token | Size | Use |
|---|---|---|
| `text-xs` | 0.75 rem | Captions, chips, labels |
| `text-sm` | 0.875 rem | Body small, table cells, hints |
| `text-base` | 1 rem | Body |
| `text-lg` | 1.125 rem | Subheads, card titles |
| `text-xl` | 1.375 rem | Section heads |
| `text-2xl` | 1.75 rem | Page heads |
| `text-3xl` | 2.25 rem | Hero head |
| `text-4xl` | 3 rem | Hero head, desktop |

Weights: 400 (body), 500 (UI default), 600 (emphasis), 700 (hero only).

Numbers are always `font-mono`, `tabular-nums`. Dollar amounts in the headline are also mono, slightly larger weight (500).

Tracking:
- `tracking-tight` (-0.02em) on display sizes (xl+)
- `tracking-normal` on body
- `tracking-wider` (+0.05em), uppercase, on micro-labels

Line height: 1.5 body, 1.2 display, 1.0 single-line numerics.

## Layout

- Container max-width: 72rem (1152px) for product surfaces, 64rem for the hero.
- Vertical rhythm: 1.25rem / 2rem / 3rem (between sections, in increasing structural weight).
- Side padding: 1.25rem mobile, 2rem tablet, 2.5rem desktop.
- Panels: 1px hairline, no shadows by default. Raised state uses `surface-2` background, not shadow.
- Avoid identical card grids. The features row uses 3 different sizes/treatments, not 3 identical icon-cards.

## Components

Every interactive component has: default, hover, focus, active, disabled, loading, error.

- Buttons: 36px height default, 8px radius, mono label optional, no gradient. Primary uses `--accent` background, black text; secondary uses `surface-1` with `border` hairline; ghost uses transparent + border on hover only.
- Inputs: 40px height default, 6px radius, focus ring uses `--border-strong` (not accent · accent is reserved). Placeholder uses `--text-3`.
- Tabs: underline-style, 2px accent on active, `--text-2` on inactive.
- Chips (example prompts): pill shape, mono label optional, hover lifts the border one notch.
- Cards (metrics, etc.): use 1px hairline, never side-stripe accents. Number is the hero; label sits above in `text-xs uppercase tracking-wider text-text-3`.

## Motion

Durations: 120ms (hover/focus), 180ms (state change), 240ms (reveal). Easing: `cubic-bezier(0.22, 1, 0.36, 1)` · ease-out-quart, no bounce.

Animated only:
- Opacity, transform (translate, scale) · never layout properties
- Border color, background color (on hover/active/focus)
- Loading bar in the phase indicator (a thin progress strip, not a spinner)

No orchestrated page-load sequences. No bouncy enters.

## Mobile

Sticky header collapses to logo + cog. Strategy input fills the screen. Examples scroll horizontally as a chip rail. Charts are vertically stacked, full width. Metric grid becomes 2-col then 1-col on narrow.

## What this design isn't

- Not Bloomberg (no amber-on-black terminal, no overload of data on one screen).
- Not Robinhood (no rounded blobs, no confetti, no gamification).
- Not "AI SaaS hero" (no gradient text, no three identical feature cards, no "powered by AI" badge).
- Not crypto neon (no full-saturation greens or pinks on pure black).
