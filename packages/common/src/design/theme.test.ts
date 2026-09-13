import { describe, expect, it } from 'vitest';
import { parseThemePreference, ResolvedTheme, resolveTheme, THEME_PREFERENCE_OPTIONS, ThemePreference } from './theme';

describe('theme preference', () => {
  it('lists Sistema, Claro and Escuro in that order', () => {
    expect(THEME_PREFERENCE_OPTIONS.map((option) => [option.value, option.label])).toEqual([
      ['system', 'Sistema'],
      ['light', 'Claro'],
      ['dark', 'Escuro']
    ]);
  });

  it('reads a stored value and falls back to the system for anything else', () => {
    expect(parseThemePreference('dark')).toBe(ThemePreference.Dark);
    expect(parseThemePreference('light')).toBe(ThemePreference.Light);
    expect(parseThemePreference('system')).toBe(ThemePreference.System);
    expect(parseThemePreference('sepia')).toBe(ThemePreference.System);
    expect(parseThemePreference(null)).toBe(ThemePreference.System);
    expect(parseThemePreference(undefined)).toBe(ThemePreference.System);
  });

  it('resolves a pinned choice regardless of the system and follows the system otherwise', () => {
    expect(resolveTheme(ThemePreference.Dark, false)).toBe(ResolvedTheme.Dark);
    expect(resolveTheme(ThemePreference.Light, true)).toBe(ResolvedTheme.Light);
    expect(resolveTheme(ThemePreference.System, true)).toBe(ResolvedTheme.Dark);
    expect(resolveTheme(ThemePreference.System, false)).toBe(ResolvedTheme.Light);
  });
});
