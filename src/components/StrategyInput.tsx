"use client";

import { useEffect, useRef } from "react";

export interface ExampleGroup {
  label: string;
  items: string[];
}

interface StrategyInputProps {
  value: string;
  onChange: (v: string) => void;
  onRun: () => void;
  exampleGroups: ExampleGroup[];
  loading: boolean;
  canRun: boolean;
  disabledReason?: string;
}

function ArrowIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

export default function StrategyInput({
  value,
  onChange,
  onRun,
  exampleGroups,
  loading,
  canRun,
  disabledReason,
}: StrategyInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const min = 120;
    const max = 360;
    el.style.height = `${Math.min(Math.max(el.scrollHeight, min), max)}px`;
  }, [value]);

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canRun) {
      e.preventDefault();
      onRun();
    }
  }

  function pickExample(prompt: string) {
    onChange(prompt);
    textareaRef.current?.focus();
  }

  const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);
  const kbd = isMac ? "⌘↩" : "Ctrl+↩";

  return (
    <div className="space-y-5">
      <section className="panel p-5 sm:p-6">
        <div className="flex items-center justify-between mb-3">
          <label htmlFor="prompt" className="micro-label">Your idea</label>
          <span className="text-xs text-text-3">No code. No formulas. Just an idea.</span>
        </div>
        <textarea
          ref={textareaRef}
          id="prompt"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder='Try: "Buy AAPL when its 50-day average crosses above its 200-day, sell when it crosses back below"'
          className="input w-full resize-none text-base leading-relaxed min-h-[120px]"
          spellCheck="false"
        />

        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-xs text-text-3 min-w-0 truncate">
            {disabledReason ? disabledReason : <>Press <span className="font-mono text-text-2">{kbd}</span> to run</>}
          </p>
          <button
            onClick={onRun}
            disabled={!canRun || loading}
            className="btn btn-primary group min-w-[160px]"
            aria-busy={loading}
          >
            <span className="flex items-center gap-2">
              {loading ? "Running" : "Run backtest"}
              {!loading && (
                <span className="transition-transform duration-180 ease-out group-hover:translate-x-0.5">
                  <ArrowIcon />
                </span>
              )}
            </span>
          </button>
        </div>
      </section>

      <div className="space-y-4">
        {exampleGroups.map((group) => (
          <div key={group.label}>
            <div className="micro-label mb-2 px-1">{group.label}</div>
            <div className="scroll-row flex gap-2 pb-1 -mx-1 px-1">
              {group.items.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => pickExample(ex)}
                  className="chip whitespace-nowrap shrink-0 max-w-[420px] truncate"
                  title={ex}
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
