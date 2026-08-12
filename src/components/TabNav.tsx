"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Backtest" },
  { href: "/arb", label: "Arbitrage" },
];

export default function TabNav() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-1" aria-label="Sections">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          // Underline rather than a filled pill, and accent rather than a
          // neutral fill: accent is reserved for primary action and the
          // resolved current selection, which is exactly what this is.
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`relative h-8 px-2.5 inline-flex items-center text-xs transition-colors duration-120 ease-out ${
              active ? "text-text-1" : "text-text-2 hover:text-text-1"
            }`}
          >
            {tab.label}
            {active && (
              <span
                aria-hidden="true"
                className="absolute inset-x-2.5 bottom-1 h-[2px] rounded-full bg-accent"
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
