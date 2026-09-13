export const enum ThemePreference {
  System = 'system',
  Light = 'light',
  Dark = 'dark'
}

export const enum ResolvedTheme {
  Light = 'light',
  Dark = 'dark'
}

export type ThemePreferenceOption = { value: ThemePreference; label: string };

export const THEME_PREFERENCE_OPTIONS: readonly ThemePreferenceOption[] = [
  { value: ThemePreference.System, label: 'Sistema' },
  { value: ThemePreference.Light, label: 'Claro' },
  { value: ThemePreference.Dark, label: 'Escuro' }
];

/** A stored value from an older build or a hand-edited storage never breaks the app: it means "follow the system". */
export function parseThemePreference(raw: string | null | undefined): ThemePreference {
  if (raw === ThemePreference.Light) {
    return ThemePreference.Light;
  }

  if (raw === ThemePreference.Dark) {
    return ThemePreference.Dark;
  }

  return ThemePreference.System;
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  if (preference === ThemePreference.Dark) {
    return ResolvedTheme.Dark;
  }

  if (preference === ThemePreference.Light) {
    return ResolvedTheme.Light;
  }

  return systemDark ? ResolvedTheme.Dark : ResolvedTheme.Light;
}
