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

/** The two tags of index.html: the browser picks one by the system scheme, so both carry the app's theme. */
function themeColorTags(): HTMLMetaElement[] {
  return ["light", "dark"].map(scheme => {
    const tag = document.createElement("meta");

    tag.name = "theme-color";
    tag.media = `(prefers-color-scheme: ${scheme})`;
    tag.content = scheme === "dark" ? "#121122" : "#f7f6fb";
    document.head.append(tag);

    return tag;
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  document.documentElement.style.colorScheme = "";
  document.head.querySelectorAll('meta[name="theme-color"]').forEach(tag => tag.remove());
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

  it("paints the status bar with the theme the app shows, not the one the system prefers", () => {
    stubSystem(false);

    const tags = themeColorTags();

    applyTheme(ThemePreference.Dark);
    expect(tags.map(tag => tag.content)).toEqual(["#121122", "#121122"]);

    applyTheme(ThemePreference.Light);
    expect(tags.map(tag => tag.content)).toEqual(["#f7f6fb", "#f7f6fb"]);
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
