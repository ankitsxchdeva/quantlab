import type { Config } from "tailwindcss";

/*
 * Tailwind mapping of the Colophon tokens (~/Documents/design/tokens.css,
 * v0.4). Type tiers are named per the spec's scale; there are no other sizes.
 * Data hues are for data values only (§5), never chrome.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        fg: "var(--fg)",
        muted: "var(--muted)",
        border: "var(--border)",
        accent: "var(--accent)",
        "accent-hover": "var(--accent-hover)",
        editorial: "var(--editorial)",
        "data-pos": "var(--data-pos)",
        "data-neg": "var(--data-neg)",
        "data-warn": "var(--data-warn)",
        "data-bench": "var(--data-bench)",
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      /* the spec's type scale (§2). display is one use per page. */
      fontSize: {
        badge: ["10px", { lineHeight: "1.4" }],
        meta: ["11px", { lineHeight: "1.4" }],
        label: ["12px", { lineHeight: "1.5" }],
        small: ["13px", { lineHeight: "1.5" }],
        title: ["14px", { lineHeight: "1.5" }],
        body: ["15px", { lineHeight: "1.65" }],
        lede: ["17px", { lineHeight: "1.6" }],
        display: ["32px", { lineHeight: "1.2", letterSpacing: "-0.5px" }],
      },
      /* the one clock: every state transition, same tempo (§1) */
      transitionTimingFunction: {
        DEFAULT: "cubic-bezier(0.25, 1, 0.5, 1)",
      },
      transitionDuration: {
        DEFAULT: "150ms",
      },
      keyframes: {
        /* entrances land exactly: rise 14px and fade, then rest */
        rise: {
          from: { opacity: "0", transform: "translateY(14px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        /* skeleton/progress pulse: opacity only, never position */
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.45" },
        },
      },
      animation: {
        rise: "rise 400ms cubic-bezier(0.25, 1, 0.5, 1) both",
        "pulse-soft": "pulse-soft 1.2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
export default config;
