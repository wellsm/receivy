import { LOGIN_CODE_TTL_MS, RESEND_COOLDOWN_MS } from "@receivy/common";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodeScreen } from "@/components/screens/code-screen";
import { ApiError } from "@/lib/api/errors";
import { confirmEmailCode } from "@/lib/auth/flows";
import { writePendingLogin } from "@/lib/auth/pending-login";
import { renderWithRouter } from "@/test/render";

const navigate = vi.fn();

vi.mock("@/lib/navigate", () => ({ useAppNavigate: () => navigate }));
vi.mock("@/lib/auth/flows", () => ({
  confirmEmailCode: vi.fn(),
}));

async function open() {
  const result = renderWithRouter(<CodeScreen />);

  await screen.findByLabelText("Código de 6 dígitos");

  return result;
}

/** With fake timers findBy* would never poll, so the router's async load is flushed by hand. */
async function openWithFakeTimers() {
  const result = renderWithRouter(<CodeScreen />);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });

  return result;
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.useRealTimers();
  navigate.mockReset();
  sessionStorage.clear();
});

describe("CodeScreen", () => {
  it("redirects to /login when there is no pending login", async () => {
    renderWithRouter(<CodeScreen />);

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/login", { replace: true }));
  });

  it("filters non-digit characters and enables confirm only at six digits", async () => {
    writePendingLogin({ email: "ana@example.com", sentAt: Date.now(), nextPath: "/" });
    await open();

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

  it("disables confirm and shows the expiry message once the code expires", async () => {
    vi.useFakeTimers();
    writePendingLogin({ email: "ana@example.com", sentAt: Date.now(), nextPath: "/" });
    await openWithFakeTimers();

    const input = screen.getByLabelText("Código de 6 dígitos");

    fireEvent.change(input, { target: { value: "123456" } });
    expect(screen.getByRole("button", { name: /Confirmar e Entrar/ })).toBeEnabled();

    act(() => { vi.advanceTimersByTime(LOGIN_CODE_TTL_MS + 1000); });

    expect(screen.getByText("Código expirado. Peça um novo código.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Confirmar e Entrar/ })).toBeDisabled();
  });

  it("disables resend for the cooldown window after any code send", async () => {
    vi.useFakeTimers();
    writePendingLogin({ email: "ana@example.com", sentAt: Date.now(), nextPath: "/" });
    await openWithFakeTimers();

    const resend = screen.getByRole("button", { name: /Reenviar/ });

    expect(resend).toBeDisabled();
    expect(resend).toHaveTextContent(/Reenviar em/);

    act(() => { vi.advanceTimersByTime(RESEND_COOLDOWN_MS + 1000); });

    expect(resend).toBeEnabled();
    expect(resend).toHaveTextContent("Reenviar código");
  });

  it("keeps confirm busy after a successful code, so the spinner survives the navigation", async () => {
    writePendingLogin({ email: "ana@example.com", sentAt: Date.now(), nextPath: "/charges" });
    vi.mocked(confirmEmailCode).mockResolvedValue({ id: "u1", email: "ana@example.com" } as never);

    await open();

    const confirm = screen.getByRole("button", { name: /Confirmar e Entrar/ });

    fireEvent.change(screen.getByLabelText("Código de 6 dígitos"), { target: { value: "123456" } });
    fireEvent.click(confirm);

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/charges", { replace: true }));

    expect(confirmEmailCode).toHaveBeenCalledWith({ email: "ana@example.com", code: "123456" });

    // Clearing it here would flash the button back mid-navigation.
    expect(confirm).toBeDisabled();
  });

  it("shows the same actionable error for any rejected code", async () => {
    writePendingLogin({ email: "ana@example.com", sentAt: Date.now(), nextPath: "/" });
    vi.mocked(confirmEmailCode).mockRejectedValue(
      new ApiError(401, "Código inválido ou expirado. Peça um novo código e tente novamente."),
    );

    await open();
    fireEvent.change(screen.getByLabelText("Código de 6 dígitos"), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: /Confirmar e Entrar/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Código inválido ou expirado. Peça um novo código e tente novamente.",
    );
  });
});
