import { parseThemePreference, ResolvedTheme, resolveTheme, ThemePreference } from "@receivy/common";
import { useCallback, useEffect, useState } from "react";

export const THEME_STORAGE_KEY = "receivy-theme";

const SYSTEM_DARK = "(prefers-color-scheme: dark)";
// `--color-canvas` of each theme: what the browser paints the status bar with. Same values in index.html and public/theme.js.
const LIGHT_THEME_COLOR = "#f7f6fb";
const DARK_THEME_COLOR = "#121122";

function systemDark(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(SYSTEM_DARK).matches;
}

/** Storage can be blocked (private mode, disabled cookies): the app then simply follows the system. */
export function readThemePreference(): ThemePreference {
  try {
    return parseThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return ThemePreference.System;
  }
}

export function saveThemePreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // The choice still applies to this page; it just won't survive a reload.
  }
}

export function applyTheme(preference: ThemePreference): void {
  const theme = resolveTheme(preference, systemDark());
  const root = document.documentElement;

  root.dataset.theme = theme;
  root.style.colorScheme = theme;

  // The tags of index.html follow the system scheme; a theme pinned in the app has to win over it.
  for (const tag of document.querySelectorAll('meta[name="theme-color"]')) {
    tag.setAttribute("content", theme === ResolvedTheme.Dark ? DARK_THEME_COLOR : LIGHT_THEME_COLOR);
  }
}

/** The stored choice is read after mount, so the server render and the first client render agree. */
export function useThemePreference(): [ThemePreference, (preference: ThemePreference) => void] {
  const [preference, setPreference] = useState<ThemePreference | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads localStorage after mount so SSR and the first client render agree
    setPreference(readThemePreference());
  }, []);

  useEffect(() => {
    if (preference === null) {
      return;
    }

    applyTheme(preference);

    if (preference !== ThemePreference.System || typeof window.matchMedia !== "function") {
      return;
    }

    const media = window.matchMedia(SYSTEM_DARK);
    const follow = () => applyTheme(ThemePreference.System);

    media.addEventListener("change", follow);

    return () => media.removeEventListener("change", follow);
  }, [preference]);

  const choose = useCallback((next: ThemePreference) => {
    saveThemePreference(next);
    setPreference(next);
  }, []);

  return [preference ?? ThemePreference.System, choose];
}
