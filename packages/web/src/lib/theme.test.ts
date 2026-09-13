import { ThemePreference } from "@receivy/common";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyTheme, readThemePreference, saveThemePreference, THEME_STORAGE_KEY, useThemePreference } from "@/lib/theme";

/** jsdom has no matchMedia: a controllable stand-in for the OS color scheme. */
function stubSystem(dark: boolean) {
  const listeners = new Set<() => void>();
  const media = {
    matches: dark,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  };

  vi.stubGlobal("matchMedia", vi.fn(() => media));

  return {
    change(next: boolean) {
      media.matches = next;
      listeners.forEach(listener => listener());
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  document.documentElement.style.colorScheme = "";
});

describe("theme preference", () => {
  it("reads a stored choice and treats anything else as the system", () => {
    expect(readThemePreference()).toBe(ThemePreference.System);

    window.localStorage.setItem(THEME_STORAGE_KEY, "sepia");
    expect(readThemePreference()).toBe(ThemePreference.System);

    saveThemePreference(ThemePreference.Dark);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(readThemePreference()).toBe(ThemePreference.Dark);
  });

  it("stamps the resolved theme on the document", () => {
    stubSystem(false);

    applyTheme(ThemePreference.Dark);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");

    applyTheme(ThemePreference.System);
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("follows the system while the preference is Sistema and stops once a theme is pinned", () => {
    const system = stubSystem(false);
    const { result } = renderHook(() => useThemePreference());

    expect(document.documentElement.dataset.theme).toBe("light");

    act(() => system.change(true));
    expect(document.documentElement.dataset.theme).toBe("dark");

    act(() => result.current[1](ThemePreference.Light));
    expect(result.current[0]).toBe(ThemePreference.Light);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");

    act(() => system.change(true));
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
