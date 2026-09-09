import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PENDING_LOGIN_KEY } from "@/lib/auth/pending-login";
import { EmailLoginForm } from "./email-login-form";

const push = vi.fn();
const router = { push };

vi.mock("next/navigation", () => ({ useRouter: () => router }));

const ALL = { google: true, apple: true };
const NONE = { google: false, apple: false };

function fetchMock() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.includes("email/code")) {
      return new Response(null, { status: 204 });
    }

    return new Response(null, { status: 404 });
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  push.mockReset();
  sessionStorage.clear();
});

describe("EmailLoginForm", () => {
  it("uses only an e-mail field and never asks for a password", async () => {
    vi.stubGlobal("fetch", fetchMock());
    render(<EmailLoginForm nextPath="/" providers={ALL} />);

    expect(await screen.findByLabelText("Seu e-mail")).toBeInTheDocument();
    expect(screen.queryByLabelText(/senha/i)).not.toBeInTheDocument();
  });

  it("stores the pending login and navigates to the code screen on success", async () => {
    vi.stubGlobal("fetch", fetchMock());
    const user = userEvent.setup();
    render(<EmailLoginForm nextPath="/charges" providers={ALL} />);

    await user.type(screen.getByLabelText("Seu e-mail"), "ana@example.com");
    await user.click(screen.getByRole("button", { name: "Continuar com E-mail" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/login/code"));

    const pending = JSON.parse(sessionStorage.getItem(PENDING_LOGIN_KEY) ?? "null");
    expect(pending.email).toBe("ana@example.com");
    expect(pending.nextPath).toBe("/charges");
    expect(typeof pending.sentAt).toBe("number");
  });

  it("hides provider buttons and the e-mail divider when both providers are disabled, without fetching", async () => {
    const fetchSpy = fetchMock();
    vi.stubGlobal("fetch", fetchSpy);
    render(<EmailLoginForm nextPath="/" providers={NONE} />);

    expect(screen.getByRole("button", { name: /Continuar com E-mail/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Continuar com Google/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Continuar com Apple/ })).toBeNull();
    expect(screen.queryByText("ou continue com seu e-mail")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("shows only the providers resolved on the server", async () => {
    vi.stubGlobal("fetch", fetchMock());
    render(<EmailLoginForm nextPath="/" providers={{ google: true, apple: false }} />);

    expect(screen.getByRole("button", { name: /Continuar com Google/ })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /Continuar com Apple/ })).toBeNull();
    expect(screen.getByText("ou continue com seu e-mail")).toBeInTheDocument();
  });

  it("shows the oauth error alert inside the card", async () => {
    vi.stubGlobal("fetch", fetchMock());
    render(<EmailLoginForm nextPath="/" providers={ALL} oauthError />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível concluir o login. Tente novamente ou use seu e-mail.",
    );
  });
});
