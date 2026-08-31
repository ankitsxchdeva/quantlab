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
  showExamples?: boolean;
}

export default function StrategyInput({
  value,
  onChange,
  onRun,
  exampleGroups,
  loading,
  canRun,
  disabledReason,
  showExamples = true,
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
  const kbd = isMac ? "⌘↩" : "ctrl+↩";

  return (
    <div className="space-y-6">
      <section className="border-t border-border pt-4">
        <div className="flex items-baseline justify-between mb-2">
          <label htmlFor="prompt" className="text-label text-muted">your idea</label>
          <span className="text-meta text-dim italic">no code, no formulas, just an idea.</span>
        </div>
        <textarea
          ref={textareaRef}
          id="prompt"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder='try: "buy AAPL when its 50-day average crosses above its 200-day, sell when it crosses back below"'
          className="input w-full resize-none text-body leading-relaxed min-h-[120px]"
          spellCheck="false"
        />

        <div className="mt-3 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3">
          <p className="text-meta text-dim sm:min-w-0 sm:truncate">
            {disabledReason ? disabledReason : <>press <span className="kbd">{kbd}</span> to run</>}
          </p>
          <button
            onClick={onRun}
            disabled={!canRun || loading}
            className="action-chip action-primary text-title min-w-[140px] self-stretch sm:self-auto"
            aria-busy={loading}
          >
            {loading ? "running" : "run backtest"}
          </button>
        </div>
      </section>

      {showExamples && <div className="space-y-5">
        {exampleGroups.map((group) => (
          <div key={group.label}>
            <div className="flex items-baseline gap-3 mb-2">
              <span className="text-label text-muted">{group.label.toLowerCase()}</span>
              <span className="text-meta text-dim">{group.items.length} ideas</span>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {group.items.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => pickExample(ex)}
                  className="action-chip text-small whitespace-normal text-left w-full leading-snug justify-start"
                  title={ex}
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>}
    </div>
  );
}
