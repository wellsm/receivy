import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicPixCopy } from "@/components/app/public-pix-copy";

describe("PublicPixCopy", () => {
  afterEach(() => cleanup());
  it("copies the literal key and confirms on the button itself for three seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn().mockReturnValue(false) });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<PublicPixCopy pixKey="pix@example.com" />);
    const button = screen.getByRole("button", { name: "Copiar chave Pix" });
    fireEvent.click(button);
    await vi.waitFor(() => expect(button).toHaveTextContent("Chave copiada"));
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(writeText).toHaveBeenCalledWith("pix@example.com");
    await act(() => vi.advanceTimersByTimeAsync(3_000));
    expect(button).toHaveTextContent("Copiar chave Pix");
    expect(button).toHaveAttribute("aria-pressed", "false");
    vi.useRealTimers();
  });

  it("exposes a pending state while the clipboard API has not settled", async () => {
    Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn().mockReturnValue(false) });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn(() => new Promise(() => {})) } });
    render(<PublicPixCopy pixKey="pix@example.com" timeoutMs={60_000} />);
    fireEvent.click(screen.getByRole("button", { name: "Copiar chave Pix" }));
    expect(await screen.findByRole("button", { name: "Copiando chave Pix" })).toBeDisabled();
  });

  it("reports clipboard denial and lets the payer copy manually", async () => {
    Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn().mockReturnValue(false) });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    render(<PublicPixCopy pixKey="pix@example.com" />);
    fireEvent.click(screen.getByRole("button", { name: "Copiar chave Pix" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Selecione a chave");
    expect(screen.getByRole("button", { name: "Copiar chave Pix" })).toBeEnabled();
  });
});
