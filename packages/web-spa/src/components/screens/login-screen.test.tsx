import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginScreen } from "@/components/screens/login-screen";
import { ApiError } from "@/lib/api/errors";
import { requestEmailCode, startOauth } from "@/lib/auth/flows";
import { PENDING_LOGIN_KEY } from "@/lib/auth/pending-login";
import { renderWithRouter } from "@/test/render";

const navigate = vi.fn();

vi.mock("@/lib/navigate", () => ({ useAppNavigate: () => navigate }));
vi.mock("@/lib/auth/flows", () => ({
  requestEmailCode: vi.fn(),
  startOauth: vi.fn(),
}));

const ALL = { google: true, apple: true };
const NONE = { google: false, apple: false };

async function open(ui: ReactElement) {
  const result = renderWithRouter(ui);

  await screen.findByLabelText("Seu e-mail");

  return result;
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  navigate.mockReset();
  sessionStorage.clear();
});

describe("LoginScreen", () => {
  it("uses only an e-mail field and never asks for a password", async () => {
    await open(<LoginScreen nextPath="/" providers={ALL} />);

    expect(await screen.findByLabelText("Seu e-mail")).toBeInTheDocument();
    expect(screen.queryByLabelText(/senha/i)).not.toBeInTheDocument();
  });

  it("stores the pending login and navigates to the code screen on success", async () => {
    vi.mocked(requestEmailCode).mockResolvedValue(undefined);

    const user = userEvent.setup();

    await open(<LoginScreen nextPath="/charges" providers={ALL} />);

    await user.type(screen.getByLabelText("Seu e-mail"), "ana@example.com");
    await user.click(screen.getByRole("button", { name: "Continuar com E-mail" }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/login/code"));

    expect(requestEmailCode).toHaveBeenCalledWith("ana@example.com");

    const pending = JSON.parse(sessionStorage.getItem(PENDING_LOGIN_KEY) ?? "null");

    expect(pending.email).toBe("ana@example.com");
    expect(pending.nextPath).toBe("/charges");
    expect(typeof pending.sentAt).toBe("number");
  });

  it("keeps the e-mail button busy after a successful send, so the spinner survives the route change", async () => {
    vi.mocked(requestEmailCode).mockResolvedValue(undefined);

    const user = userEvent.setup();

    await open(<LoginScreen nextPath="/charges" providers={ALL} />);

    const button = screen.getByRole("button", { name: "Continuar com E-mail" });

    await user.type(screen.getByLabelText("Seu e-mail"), "ana@example.com");
    await user.click(button);

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/login/code"));

    // Clearing it here would flash the button back while the old screen is still on top.
    expect(button).toBeDisabled();
  });

  it("hides provider buttons and the e-mail divider when both providers are disabled, without fetching", async () => {
    await open(<LoginScreen nextPath="/" providers={NONE} />);

    expect(screen.getByRole("button", { name: /Continuar com E-mail/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Continuar com Google/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Continuar com Apple/ })).toBeNull();
    expect(screen.queryByText("ou continue com seu e-mail")).toBeNull();
    expect(requestEmailCode).not.toHaveBeenCalled();
    expect(startOauth).not.toHaveBeenCalled();
  });

  it("shows only the providers resolved on the server", async () => {
    await open(<LoginScreen nextPath="/" providers={{ google: true, apple: false }} />);

    expect(screen.getByRole("button", { name: /Continuar com Google/ })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /Continuar com Apple/ })).toBeNull();
    expect(screen.getByText("ou continue com seu e-mail")).toBeInTheDocument();
  });

  it("shows the oauth error alert inside the card", async () => {
    await open(<LoginScreen nextPath="/" providers={ALL} oauthError />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível concluir o login. Tente novamente ou use seu e-mail.",
    );
  });

  it("shows the Next sentence, pointing at the e-mail, when the social login cannot start", async () => {
    vi.mocked(startOauth).mockRejectedValue(new ApiError(503, "Não foi possível iniciar o login. Tente novamente."));

    const user = userEvent.setup();

    await open(<LoginScreen nextPath="/" providers={ALL} />);
    await user.click(screen.getByRole("button", { name: /Continuar com Google/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível concluir o login. Tente novamente ou use seu e-mail.");
    expect(screen.queryByText("Não foi possível iniciar o login. Tente novamente.")).toBeNull();
    expect(screen.getByRole("button", { name: /Continuar com Google/ })).toBeEnabled();
  });

  it("shows the Next sentence when the e-mail code cannot be sent", async () => {
    vi.mocked(requestEmailCode).mockRejectedValue(new ApiError(503, "Não foi possível enviar o código agora."));

    const user = userEvent.setup();

    await open(<LoginScreen nextPath="/" providers={ALL} />);
    await user.type(screen.getByLabelText("Seu e-mail"), "ana@example.com");
    await user.click(screen.getByRole("button", { name: "Continuar com E-mail" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível enviar o código agora.");
    expect(navigate).not.toHaveBeenCalled();
  });
});
