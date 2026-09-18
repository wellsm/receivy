import { parseThemePreference, ThemePreference } from "@receivy/common";
import * as SecureStore from "expo-secure-store";
import { useCallback, useState } from "react";
import { Appearance } from "react-native";
import { Uniwind } from "uniwind";

export const THEME_STORAGE_KEY = "receivy.theme";

/** Synchronous on purpose: the root layout applies it before the first frame, so a pinned theme never flashes. */
export function readThemePreference(): ThemePreference {
  try {
    return parseThemePreference(SecureStore.getItem(THEME_STORAGE_KEY));
  } catch {
    return ThemePreference.System;
  }
}

/** Uniwind paints the classes; Appearance keeps native alerts, pickers and the keyboard on the same theme. */
export function applyThemePreference(preference: ThemePreference): void {
  Uniwind.setTheme(preference);

  if (preference === ThemePreference.System) {
    // RN 0.85's ColorSchemeName is 'light' | 'dark' | 'unspecified'; it has no null member.
    Appearance.setColorScheme("unspecified");

    return;
  }

  Appearance.setColorScheme(preference);
}

export function saveThemePreference(preference: ThemePreference): void {
  try {
    SecureStore.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // The choice still applies for this session.
  }

  applyThemePreference(preference);
}

export function useThemePreference(): [ThemePreference, (preference: ThemePreference) => void] {
  const [preference, setPreference] = useState(readThemePreference);

  const choose = useCallback((next: ThemePreference) => {
    saveThemePreference(next);
    setPreference(next);
  }, []);

  return [preference, choose];
}
