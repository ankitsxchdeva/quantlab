"use client";

import { useEffect, useState } from "react";
import { currentTheme, setTheme, type Theme } from "@/lib/theme";

/*
 * Twin Theme + Small-Choices-Persist (§1): flips data-theme on <html>, the
 * choice persists via setTheme. The label names the action (the theme it
 * switches to), not the state. Before hydration we render an invisible
 * same-width placeholder so the header doesn't shift (Zero Layout Shift).
 */
export default function ThemeToggle() {
  const [theme, setThemeState] = useState<Theme | null>(null);

  useEffect(() => {
    setThemeState(currentTheme());
  }, []);

  if (theme === null) {
    return (
      <span className="action text-small invisible" aria-hidden="true">
        light
      </span>
    );
  }

  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => {
        setTheme(next);
        setThemeState(next);
      }}
      className="action text-small"
      aria-label={`switch to ${next} theme`}
    >
      {next}
    </button>
  );
}
