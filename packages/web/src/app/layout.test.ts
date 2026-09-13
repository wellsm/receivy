import { afterEach, describe, expect, it, vi } from "vitest";
import { THEME_SCRIPT } from "@/lib/theme-script";

/** jsdom has no matchMedia: a controllable stand-in for the OS color scheme, same shape as lib/theme.test.ts. */
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

describe("THEME_SCRIPT", () => {
  it("stamps the system theme when nothing is stored, and follows OS changes", () => {
    const system = stubSystem(true);

    // Safe: THEME_SCRIPT is our own constant, not external input, and eval is the only way
    // to exercise the exact inline string injected into the document head.
    eval(THEME_SCRIPT);
    expect(document.documentElement.dataset.theme).toBe("dark");

    system.change(false);
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("keeps a pinned Light theme when the OS changes", () => {
    window.localStorage.setItem("receivy-theme", "light");
    const system = stubSystem(true);

    // Safe: see comment in the first test above.
    eval(THEME_SCRIPT);
    expect(document.documentElement.dataset.theme).toBe("light");

    system.change(true);
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
