import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "quantlab · backtest any market theory in plain English",
  description:
    "Describe a trading idea like you would to a friend. We turn it into rules, simulate it on years of real data. Stocks, ETFs, crypto, and Polymarket prediction markets.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      style={{ colorScheme: "dark" }}
    >
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
