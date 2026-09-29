import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstallBanner } from "@/components/app/install-banner";
import { InstallOutcome, resetInstallPrompt, watchInstallPrompt } from "@/lib/install";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";

function stubAgent(userAgent: string) {
  vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(userAgent);
}

function firePrompt(outcome: InstallOutcome) {
  const event = new Event("beforeinstallprompt", { cancelable: true });
  const prompt = vi.fn().mockResolvedValue(undefined);

  Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome }) });

  act(() => {
    window.dispatchEvent(event);
  });

  return prompt;
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
  stubAgent(ANDROID);
  watchInstallPrompt();
});

afterEach(() => {
  cleanup();
  resetInstallPrompt();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("InstallBanner", () => {
  it("shows nothing where the site cannot be installed", () => {
    const { container } = render(<InstallBanner />);

    expect(container).toBeEmptyDOMElement();
  });

  it("offers the install and opens the browser prompt", async () => {
    render(<InstallBanner />);

    const prompt = firePrompt(InstallOutcome.Accepted);

    expect(screen.getByRole("region", { name: "Instalar o Receivy" })).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: "Instalar" }));

    expect(prompt).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("region", { name: "Instalar o Receivy" })).toBeNull();
  });

  it("leaves when dismissed and does not come back on the next screen", async () => {
    const first = render(<InstallBanner />);

    firePrompt(InstallOutcome.Accepted);

    await userEvent.setup().click(screen.getByRole("button", { name: "Agora não" }));

    expect(screen.queryByRole("region", { name: "Instalar o Receivy" })).toBeNull();

    first.unmount();
    render(<InstallBanner />);

    expect(screen.queryByRole("region", { name: "Instalar o Receivy" })).toBeNull();
  });

  it("teaches the steps on an iPhone, which has no install button", () => {
    stubAgent(IPHONE);

    render(<InstallBanner />);

    expect(screen.getByRole("region", { name: "Instalar o Receivy" })).toBeInTheDocument();
    expect(screen.getByText(/Adicionar à Tela de Início/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Instalar" })).toBeNull();
    expect(screen.getByRole("button", { name: "Agora não" })).toBeInTheDocument();
  });
});
