import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

/* Colophon §2: Lato 400/700 (+italic for ephemeral meta), self-hosted woff2. */
const lato = localFont({
  src: [
    { path: "./fonts/lato-regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/lato-italic.woff2", weight: "400", style: "italic" },
    { path: "./fonts/lato-bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-lato",
  display: "swap",
});

export const metadata: Metadata = {
  title: "quantlab · backtest any market theory in plain English",
  description:
    "Describe a trading idea like you would to a friend. We turn it into rules, simulate it on years of real data. Stocks, ETFs, crypto, and Polymarket prediction markets.",
};

/*
 * Theme bootstrap: apply the persisted choice before first paint. Absence of
 * data-theme means "follow prefers-color-scheme" (see globals.css), so an
 * unchosen visit tracks the OS instead of freezing on a stale default.
 */
const themeScript = `(function(){try{var t=window.localStorage.getItem("quantlab.theme");if(t==="light"||t==="dark"){document.documentElement.dataset.theme=t;}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={lato.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-[100dvh] font-sans">{children}</body>
    </html>
  );
}
