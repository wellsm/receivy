import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstallOffer, InstallOutcome, resetInstallPrompt, useInstallOffer, watchInstallPrompt } from "@/lib/install";

const DAY = 24 * 60 * 60 * 1000;
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";

/** jsdom has no matchMedia: a stand-in that answers the display mode the test asks for. */
function stubDisplay(standalone: boolean) {
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: standalone && query === "(display-mode: standalone)" })));
}

function stubAgent(userAgent: string) {
  vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(userAgent);
}

/** What Chrome fires when the site can be installed. */
function promptEvent(outcome: InstallOutcome) {
  const event = new Event("beforeinstallprompt", { cancelable: true });
  const prompt = vi.fn().mockResolvedValue(undefined);

  Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome }) });

  return { event, prompt };
}

beforeEach(() => {
  stubDisplay(false);
  stubAgent(ANDROID);
  watchInstallPrompt();
});

afterEach(() => {
  resetInstallPrompt();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  window.localStorage.clear();
});

describe("useInstallOffer", () => {
  it("offers nothing until the browser says the site can be installed", () => {
    const { result } = renderHook(() => useInstallOffer());

    expect(result.current).toBeNull();
  });

  it("offers the browser prompt once it arrives, and keeps the browser's own banner away", () => {
    const { result } = renderHook(() => useInstallOffer());
    const { event } = promptEvent(InstallOutcome.Accepted);

    act(() => {
      window.dispatchEvent(event);
    });

    expect(result.current?.offer).toBe(InstallOffer.Prompt);
    expect(event.defaultPrevented).toBe(true);
  });

  it("keeps a prompt that arrived before the screen mounted", () => {
    window.dispatchEvent(promptEvent(InstallOutcome.Accepted).event);

    const { result } = renderHook(() => useInstallOffer());

    expect(result.current?.offer).toBe(InstallOffer.Prompt);
  });

  it("opens the prompt and withdraws the offer once the person answered", async () => {
    const { result } = renderHook(() => useInstallOffer());
    const { event, prompt } = promptEvent(InstallOutcome.Accepted);

    act(() => {
      window.dispatchEvent(event);
    });

    await act(() => result.current!.install());

    expect(prompt).toHaveBeenCalledTimes(1);
    expect(result.current).toBeNull();
  });

  it("stays away for 30 days after the person refused the prompt", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-29T12:00:00Z"), toFake: ["Date"] });

    const first = renderHook(() => useInstallOffer());

    act(() => {
      window.dispatchEvent(promptEvent(InstallOutcome.Dismissed).event);
    });

    await act(() => first.result.current!.install());

    first.unmount();

    act(() => {
      window.dispatchEvent(promptEvent(InstallOutcome.Accepted).event);
    });

    vi.setSystemTime(new Date(Date.parse("2026-09-29T12:00:00Z") + 29 * DAY));
    expect(renderHook(() => useInstallOffer()).result.current).toBeNull();

    vi.setSystemTime(new Date(Date.parse("2026-09-29T12:00:00Z") + 31 * DAY));
    expect(renderHook(() => useInstallOffer()).result.current?.offer).toBe(InstallOffer.Prompt);
  });

  it("stays away after the person dismissed the banner", () => {
    const { result } = renderHook(() => useInstallOffer());

    act(() => {
      window.dispatchEvent(promptEvent(InstallOutcome.Accepted).event);
    });

    act(() => result.current!.dismiss());

    expect(result.current).toBeNull();
    expect(renderHook(() => useInstallOffer()).result.current).toBeNull();
  });

  it("withdraws the offer when the app gets installed", () => {
    const { result } = renderHook(() => useInstallOffer());

    act(() => {
      window.dispatchEvent(promptEvent(InstallOutcome.Accepted).event);
    });

    act(() => {
      window.dispatchEvent(new Event("appinstalled"));
    });

    expect(result.current).toBeNull();
  });

  it("offers the steps on an iPhone, which has no prompt", () => {
    stubAgent(IPHONE);

    const { result } = renderHook(() => useInstallOffer());

    expect(result.current?.offer).toBe(InstallOffer.Ios);
  });

  it("offers nothing inside the installed app", () => {
    stubAgent(IPHONE);
    stubDisplay(true);

    const { result } = renderHook(() => useInstallOffer());

    expect(result.current).toBeNull();
  });

  it("still offers when the browser blocks storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    stubAgent(IPHONE);

    const { result } = renderHook(() => useInstallOffer());

    expect(result.current?.offer).toBe(InstallOffer.Ios);
  });
});
