"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "backtest" },
  { href: "/arb", label: "arbitrage" },
];

export default function TabNav() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-1" aria-label="sections">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className="tab text-title h-8 px-2.5 inline-flex items-center"
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
