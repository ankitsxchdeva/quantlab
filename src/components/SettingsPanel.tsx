"use client";

import { useEffect, useState } from "react";
import type { LLMProvider } from "@/lib/types";
import { ArrowSquareOut, Eye, EyeSlash, Lock } from "@phosphor-icons/react";
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

// Key order is UI order: demo first, since it's the keyless default.
const PROVIDER_LABELS: Record<LLMProvider, string> = {
  ollama: "demo",
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
};

const DEFAULT_MODEL_HINT: Record<LLMProvider, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-sonnet-5",
  google: "gemini-2.0-flash",
  ollama: "qwen3.8:27b",
};

const KEY_URLS: Record<LLMProvider, string> = {
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://console.anthropic.com/settings/keys",
  google: "https://aistudio.google.com/app/apikey",
  ollama: "https://ollama.com",
};

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
          "fixed inset-0 z-40 scrim transition-opacity",
          open ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
      />
      <aside
        role="dialog"
        aria-label="provider settings"
        aria-hidden={!open}
        className={cn(
          "fixed top-0 right-0 h-full w-full sm:w-[420px] z-50 transition-opacity",
          "bg-bg border-l border-border",
          open ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-title font-bold">provider settings</h2>
            <p className="text-meta text-dim mt-0.5">demo by default. bring your own key for the hosted providers.</p>
          </div>
          <button onClick={onClose} className="action text-small" aria-label="close settings">
            close
          </button>
        </div>

        <div className="px-6 py-5 space-y-6 overflow-y-auto" style={{ height: "calc(100% - 145px)" }}>
          <div>
            <div className="text-label text-muted mb-2">llm provider</div>
            <div className="grid grid-cols-4 gap-2">
              {(Object.keys(PROVIDER_LABELS) as LLMProvider[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setLocal((s) => ({ ...s, provider: p }))}
                  aria-pressed={local.provider === p}
                  className={cn(
                    "action-chip text-small py-1.5",
                    local.provider === p && "action-primary",
                  )}
                >
                  {PROVIDER_LABELS[p]}
                </button>
              ))}
            </div>
          </div>

          {local.provider === "ollama" ? (
            <p className="text-small text-muted">
              runs a couple requests on my local model (27B GPU). no API key needed.
              rate limited, so short waits between runs are normal.
            </p>
          ) : (
            <>
            <div>
              <div className="flex items-center justify-between mb-2">
                <label htmlFor="apiKey" className="text-label text-muted">api key</label>
                <span className="inline-flex items-center gap-1.5 text-meta text-dim italic">
                <Lock size={12} />
                <span>stored only in this browser.</span>
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
                placeholder={`paste your ${PROVIDER_LABELS[local.provider]} key`}
                className="input pr-10 font-mono text-small"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-dim hover:text-fg transition-colors"
                aria-label={showKey ? "hide key" : "show key"}
              >
                {showKey ? <EyeSlash size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <div className="mt-2.5 flex items-center justify-between">
              <a
                href={KEY_URLS[local.provider]}
                target="_blank"
                rel="noopener noreferrer"
                className="link text-label inline-flex items-center gap-1"
              >
                get a key
                <ArrowSquareOut size={11} />
              </a>
              <span className="text-meta text-dim">never sent anywhere but {PROVIDER_LABELS[local.provider]}.</span>
            </div>
          </div>

          <div>
            <label htmlFor="model" className="text-label text-muted mb-2 block">
              model <span className="text-dim">(optional)</span>
            </label>
            <input
              id="model"
              type="text"
              autoComplete="off"
              spellCheck="false"
              value={local.model ?? ""}
              onChange={(e) => setLocal((s) => ({ ...s, model: e.target.value }))}
              placeholder={DEFAULT_MODEL_HINT[local.provider]}
              className="input w-full font-mono text-small"
            />
            <p className="text-meta text-dim mt-2">
              leave blank to use the default ({DEFAULT_MODEL_HINT[local.provider]}).
            </p>
          </div>
            </>
          )}
        </div>

        <div className="absolute bottom-0 left-0 right-0 px-6 py-4 border-t border-border bg-bg flex gap-3 justify-end">
          <button onClick={onClose} className="action text-small">cancel</button>
          <button onClick={save} className="action-chip action-primary text-small">save</button>
        </div>
      </aside>
    </>
  );
}
