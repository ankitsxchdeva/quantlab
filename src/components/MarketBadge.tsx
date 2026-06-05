"use client";

import type { MarketResolution } from "@/lib/types";

interface MarketBadgeProps {
  market: MarketResolution;
}

function ExternalLinkIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 3h6v6" />
      <path d="M10 14L21 3" />
      <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
    </svg>
  );
}

export default function MarketBadge({ market }: MarketBadgeProps) {
  const sourceLabel = market.source === "polymarket" ? "Polymarket" : "Yahoo Finance";

  const content = (
    <span className="inline-flex items-center gap-2 text-xs text-text-2">
      <span className="micro-label">{sourceLabel}</span>
      <span className="font-mono tabular-nums text-text-1 truncate max-w-[60ch]" title={market.label}>
        {market.label}
      </span>
      {market.url && <ExternalLinkIcon />}
    </span>
  );

  if (!market.url) {
    return <div className="inline-flex">{content}</div>;
  }

  return (
    <a
      href={market.url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center hover:text-text-1 transition-colors duration-120 ease-out group"
    >
      {content}
    </a>
  );
}
