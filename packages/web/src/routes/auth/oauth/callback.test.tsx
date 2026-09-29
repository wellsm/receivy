import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { completeOauth } from "@/lib/auth/flows";
import { clearSession, storeSession } from "@/lib/auth/session";
import { createAppRouter } from "@/router";

vi.mock("@/lib/auth/flows", () => ({
  oauthProviders: vi.fn().mockResolvedValue({ google: true, apple: false }),
  currentUser: vi.fn().mockResolvedValue({ id: "u1", name: "Ana" }),
  completeOauth: vi.fn(),
}));

vi.mock("@/components/screens/login-screen", () => ({ LoginScreen: () => <div>login</div> }));

function renderAt(path: string) {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [path] }) });

  render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );

  return router;
}

describe("oauth callback route", () => {
  beforeEach(() => {
    clearSession();
  });

  it("exchanges the code once under StrictMode and goes to /feed", async () => {
    // The real completeOauth stores the session before resolving.
    vi.mocked(completeOauth).mockImplementation(async () => {
      const user = { id: "u1", name: "Ana" };

      storeSession({ accessToken: "a", refreshToken: "r", user } as never);

      return user as never;
    });

    const router = renderAt("/auth/oauth/callback?code=abc");

    await waitFor(() => expect(router.state.location.pathname).toBe("/feed"));

    expect(completeOauth).toHaveBeenCalledTimes(1);
    expect(completeOauth).toHaveBeenCalledWith("abc");
  });

  it("shows the failure and a retry link when there is no verifier", async () => {
    vi.mocked(completeOauth).mockResolvedValue(null);

    renderAt("/auth/oauth/callback?code=abc");

    expect(await screen.findByText("Não foi possível entrar")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Tentar de novo" })).toHaveAttribute("href", "/login?error=oauth");
  });

  it("shows the failure without calling the exchange when the URL has no code", async () => {
    vi.mocked(completeOauth).mockClear();

    renderAt("/auth/oauth/callback");

    expect(await screen.findByText("Não foi possível entrar")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Tentar de novo" })).toHaveAttribute("href", "/login?error=oauth");
    expect(completeOauth).not.toHaveBeenCalled();
  });

  it("shows the failure when the exchange rejects", async () => {
    vi.mocked(completeOauth).mockRejectedValue(new Error("boom"));

    renderAt("/auth/oauth/callback?code=abc");

    expect(await screen.findByText("Não foi possível entrar")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Tentar de novo" })).toBeInTheDocument();
  });
});
