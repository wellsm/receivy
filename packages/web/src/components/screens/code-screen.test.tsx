import { LOGIN_CODE_TTL_MS, RESEND_COOLDOWN_MS } from "@receivy/common";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writePendingLogin } from "@/lib/auth/pending-login";
import { CodeScreen } from "@/components/screens/code-screen";

const replace = vi.fn();
const push = vi.fn();
const router = { replace, push };

vi.mock("next/navigation", () => ({ useRouter: () => router }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  replace.mockReset();
  sessionStorage.clear();
});

describe("CodeScreen", () => {
  it("redirects to /login when there is no pending login", async () => {
    render(<CodeScreen />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
  });

  it("filters non-digit characters and enables confirm only at six digits", () => {
    writePendingLogin({ email: "ana@example.com", sentAt: Date.now(), nextPath: "/" });
    render(<CodeScreen />);

    const input = screen.getByLabelText("Código de 6 dígitos");
    const confirm = screen.getByRole("button", { name: /Confirmar e Entrar/ });

    expect(confirm).toBeDisabled();

    fireEvent.change(input, { target: { value: "12a3b4" } });
    expect(input).toHaveValue("1234");
    expect(confirm).toBeDisabled();

    fireEvent.change(input, { target: { value: "123456" } });
    expect(input).toHaveValue("123456");
    expect(confirm).toBeEnabled();
  });

  it("disables confirm and shows the expiry message once the code expires", () => {
    vi.useFakeTimers();
    writePendingLogin({ email: "ana@example.com", sentAt: Date.now(), nextPath: "/" });
    render(<CodeScreen />);

    const input = screen.getByLabelText("Código de 6 dígitos");

    fireEvent.change(input, { target: { value: "123456" } });
    expect(screen.getByRole("button", { name: /Confirmar e Entrar/ })).toBeEnabled();

    act(() => { vi.advanceTimersByTime(LOGIN_CODE_TTL_MS + 1000); });

    expect(screen.getByText("Código expirado. Peça um novo código.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Confirmar e Entrar/ })).toBeDisabled();
  });

  it("disables resend for the cooldown window after any code send", () => {
    vi.useFakeTimers();
    writePendingLogin({ email: "ana@example.com", sentAt: Date.now(), nextPath: "/" });
    render(<CodeScreen />);

    const resend = screen.getByRole("button", { name: /Reenviar/ });

    expect(resend).toBeDisabled();
    expect(resend).toHaveTextContent(/Reenviar em/);

    act(() => { vi.advanceTimersByTime(RESEND_COOLDOWN_MS + 1000); });

    expect(resend).toBeEnabled();
    expect(resend).toHaveTextContent("Reenviar código");
  });

  it("keeps confirm busy after a successful code, so the spinner survives the navigation", async () => {
    writePendingLogin({ email: "ana@example.com", sentAt: Date.now(), nextPath: "/charges" });

    const assign = vi.fn();

    vi.stubGlobal("location", { ...window.location, assign });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    render(<CodeScreen />);

    const confirm = screen.getByRole("button", { name: /Confirmar e Entrar/ });

    fireEvent.change(screen.getByLabelText("Código de 6 dígitos"), { target: { value: "123456" } });
    fireEvent.click(confirm);

    await waitFor(() => expect(assign).toHaveBeenCalledWith("/charges"));

    // Clearing it here would flash the button back mid-navigation.
    expect(confirm).toBeDisabled();
  });

  it("shows the same actionable error for any rejected code", async () => {
    writePendingLogin({ email: "ana@example.com", sentAt: Date.now(), nextPath: "/" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      message: "Código inválido ou expirado. Peça um novo código e tente novamente.",
    }), { status: 401, headers: { "content-type": "application/json" } })));

    render(<CodeScreen />);
    fireEvent.change(screen.getByLabelText("Código de 6 dígitos"), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: /Confirmar e Entrar/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Código inválido ou expirado. Peça um novo código e tente novamente.",
    );
  });
});
