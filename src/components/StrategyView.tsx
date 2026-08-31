"use client";

import { useMemo, useState } from "react";
import type { Strategy } from "@/lib/strategy/schema";
import { cn } from "@/lib/utils";
import PlainEnglishStrategy from "./PlainEnglishStrategy";

interface StrategyViewProps {
  strategy: Strategy;
}

type Tab = "english" | "json";

type Token =
  | { kind: "punct"; text: string }
  | { kind: "key"; text: string }
  | { kind: "string"; text: string }
  | { kind: "number"; text: string }
  | { kind: "bool"; text: string }
  | { kind: "null"; text: string };

function tokenize(json: string): Token[] {
  const tokens: Token[] = [];
  const re = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false)\b|\b(null)\b|([{}[\],])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(json)) !== null) {
    if (m.index > last) tokens.push({ kind: "punct", text: json.slice(last, m.index) });
    if (m[1]) {
      if (m[2]) {
        tokens.push({ kind: "key", text: m[1] });
        tokens.push({ kind: "punct", text: m[2] });
      } else {
        tokens.push({ kind: "string", text: m[1] });
      }
    } else if (m[3]) tokens.push({ kind: "number", text: m[3] });
    else if (m[4]) tokens.push({ kind: "bool", text: m[4] });
    else if (m[5]) tokens.push({ kind: "null", text: m[5] });
    else if (m[6]) tokens.push({ kind: "punct", text: m[6] });
    last = re.lastIndex;
  }
  if (last < json.length) tokens.push({ kind: "punct", text: json.slice(last) });
  return tokens;
}

const COLORS: Record<Token["kind"], string> = {
  key: "text-fg",
  string: "text-muted",
  number: "text-fg",
  bool: "text-muted",
  null: "text-muted",
  punct: "text-dim",
};

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={cn("text-dim", open ? "rotate-180" : "rotate-0")}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export default function StrategyView({ strategy }: StrategyViewProps) {
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<Tab>("english");
  const [copied, setCopied] = useState(false);

  const json = useMemo(() => JSON.stringify(strategy, null, 2), [strategy]);
  const tokens = useMemo(() => tokenize(json), [json]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="border-t border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between py-3 text-left"
      >
        <div className="flex items-baseline gap-3 min-w-0">
          <h3 className="text-title font-bold text-fg">compiled strategy</h3>
          <span className="text-meta font-mono tabular-nums text-dim truncate">
            {strategy.indicators.length} indicator{strategy.indicators.length === 1 ? "" : "s"} · {strategy.entries.length} entry · {strategy.exits.length} exit
          </span>
        </div>
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div className="border-t border-border">
          <div role="tablist" aria-label="strategy view tabs" className="flex items-center gap-1 px-5 pt-3 border-b border-border">
            <button
              role="tab"
              aria-selected={tab === "english"}
              onClick={() => setTab("english")}
              className="tab text-title px-3 py-2"
            >
              plain English
            </button>
            <button
              role="tab"
              aria-selected={tab === "json"}
              onClick={() => setTab("json")}
              className="tab text-title px-3 py-2"
            >
              JSON
            </button>
            {tab === "json" && (
              <button onClick={copy} className="action text-label ml-auto">
                {copied ? "copied" : "copy"}
              </button>
            )}
          </div>

          {tab === "english" ? (
            <PlainEnglishStrategy strategy={strategy} />
          ) : (
            <pre className="px-5 py-4 text-label leading-relaxed overflow-auto max-h-[480px] font-mono">
              <code>
                {tokens.map((t, i) => (
                  <span key={i} className={COLORS[t.kind]}>{t.text}</span>
                ))}
              </code>
            </pre>
          )}
        </div>
      )}
    </section>
  );
}
