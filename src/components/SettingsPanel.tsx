"use client";

import { useEffect, useState } from "react";
import type { LLMProvider } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface LLMSettings {
  provider: LLMProvider;
  apiKey: string;
  model?: string;
}

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  settings: LLMSettings;
  onChange: (next: LLMSettings) => void;
}

const PROVIDER_LABELS: Record<LLMProvider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
};

const DEFAULT_MODEL_HINT: Record<LLMProvider, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-sonnet-4-6",
  google: "gemini-2.0-flash",
};

const KEY_URLS: Record<LLMProvider, string> = {
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://console.anthropic.com/settings/keys",
  google: "https://aistudio.google.com/app/apikey",
};

function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0110 0v4" />
    </svg>
  );
}

function EyeIcon({ on }: { on: boolean }) {
  return on ? (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  ) : (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
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

export default function SettingsPanel({ open, onClose, settings, onChange }: SettingsPanelProps) {
  const [local, setLocal] = useState<LLMSettings>(settings);
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    if (open) setLocal(settings);
  }, [settings, open]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  function save() {
    onChange({
      provider: local.provider,
      apiKey: local.apiKey.trim(),
      model: local.model?.trim() || undefined,
    });
    onClose();
  }

  return (
    <>
      <div
        aria-hidden={!open}
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-40 transition-opacity duration-180 ease-out",
          open ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
        style={{ backgroundColor: "color-mix(in oklch, var(--surface-0) 78%, transparent)", backdropFilter: "blur(4px)" }}
      />
      <aside
        role="dialog"
        aria-label="Provider settings"
        aria-hidden={!open}
        className={cn(
          "fixed top-0 right-0 h-full w-full sm:w-[420px] z-50 transition-transform duration-240 ease-out",
          "bg-surface-1 border-l border-border",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-base font-medium text-text-1">Provider settings</h2>
            <p className="text-xs text-text-3 mt-0.5">Bring your own key.</p>
          </div>
          <button onClick={onClose} className="btn btn-ghost text-sm" aria-label="Close settings">
            Close
          </button>
        </div>

        <div className="px-6 py-5 space-y-6 overflow-y-auto" style={{ height: "calc(100% - 145px)" }}>
          <div>
            <div className="micro-label mb-2">LLM provider</div>
            <div className="grid grid-cols-3 gap-2 p-1 rounded-lg border border-border bg-surface-0">
              {(Object.keys(PROVIDER_LABELS) as LLMProvider[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setLocal((s) => ({ ...s, provider: p }))}
                  aria-pressed={local.provider === p}
                  className={cn(
                    "text-sm py-1.5 rounded-md transition-colors duration-120 ease-out",
                    local.provider === p
                      ? "bg-surface-2 text-text-1 border border-border-strong"
                      : "border border-transparent text-text-2 hover:text-text-1",
                  )}
                >
                  {PROVIDER_LABELS[p]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label htmlFor="apiKey" className="micro-label">API key</label>
              <span className="inline-flex items-center gap-1.5 text-xs text-text-3">
                <LockIcon />
                <span>Stored only in this browser.</span>
              </span>
            </div>
            <div className="relative">
              <input
                id="apiKey"
                type={showKey ? "text" : "password"}
                autoComplete="off"
                spellCheck="false"
                value={local.apiKey}
                onChange={(e) => setLocal((s) => ({ ...s, apiKey: e.target.value }))}
                placeholder={`Paste your ${PROVIDER_LABELS[local.provider]} key`}
                className="input pr-10 font-mono text-sm"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded text-text-3 hover:text-text-1 hover:bg-surface-2 transition-colors duration-120 ease-out"
                aria-label={showKey ? "Hide key" : "Show key"}
              >
                <EyeIcon on={showKey} />
              </button>
            </div>
            <div className="mt-2.5 flex items-center justify-between">
              <a
                href={KEY_URLS[local.provider]}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-info hover:underline"
              >
                Don&apos;t have one? Get one
                <ExternalLinkIcon />
              </a>
              <span className="text-xs text-text-3">Never persisted on our servers.</span>
            </div>
          </div>

          <div>
            <label htmlFor="model" className="micro-label mb-2 block">Model <span className="text-text-3 normal-case tracking-normal">(optional)</span></label>
            <input
              id="model"
              type="text"
              autoComplete="off"
              spellCheck="false"
              value={local.model ?? ""}
              onChange={(e) => setLocal((s) => ({ ...s, model: e.target.value }))}
              placeholder={DEFAULT_MODEL_HINT[local.provider]}
              className="input w-full font-mono text-sm"
            />
            <p className="text-xs text-text-3 mt-2">
              Leave blank to use the default ({DEFAULT_MODEL_HINT[local.provider]}).
            </p>
          </div>
        </div>

        <div className="absolute bottom-0 left-0 right-0 px-6 py-4 border-t border-border bg-surface-1 flex gap-2 justify-end">
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button onClick={save} className="btn btn-primary">Save</button>
        </div>
      </aside>
    </>
  );
}
