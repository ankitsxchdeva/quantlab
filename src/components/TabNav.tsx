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
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`h-8 px-3 inline-flex items-center rounded-md text-xs transition-colors duration-120 ease-out ${
              active
                ? "bg-surface-2 text-text-1"
                : "text-text-3 hover:text-text-1 hover:bg-surface-1"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
