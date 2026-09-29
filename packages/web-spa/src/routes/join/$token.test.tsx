import { BillingCategory, BillingRecurrence } from "@receivy/common";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentUser } from "@/lib/auth/flows";
import { onSessionExpired } from "@/lib/api/client";
import { clearSession, storeSession } from "@/lib/auth/session";
import { createAppRouter } from "@/router";
import { stubApi } from "@/test/stub-api";

vi.mock("@/lib/auth/flows", () => ({ currentUser: vi.fn(), oauthProviders: vi.fn() }));
vi.mock("@/components/screens/onboarding-screen", () => ({
  OnboardingScreen: ({ nextPath }: { nextPath: string }) => <div data-testid="onboarding-screen">{nextPath}</div>,
}));

const view = {
  creditorFirstName: "Lucas",
  description: "Churrasco",
  amount: { amountCents: 12_000, currency: "BRL" },
  recurrence: BillingRecurrence.Once,
  participantCount: 3,
  category: BillingCategory.Food,
  expired: false,
};

function open(token: string) {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [`/join/${token}`] }) });

  render(<RouterProvider router={router} />);

  return router;
}

beforeEach(() => {
  clearSession();
});

afterEach(() => {
  cleanup();
  onSessionExpired(null);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.mocked(currentUser).mockReset();
});

describe("join route", () => {
  it("renders the invite for a visitor without a session, pointing at the login", async () => {
    stubApi({ "GET /public/invites/tok-1": () => Response.json(view) });

    open("tok-1");

    expect(await screen.findByText("Churrasco")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Entrar para participar" })).toHaveAttribute("href", "/login?next=%2Fjoin%2Ftok-1");
    expect(screen.queryByRole("button", { name: "Participar" })).not.toBeInTheDocument();
    expect(screen.queryByText("Algo deu errado")).toBeNull();
  });

  it("offers to join to a signed-in visitor", async () => {
    stubApi({ "GET /public/invites/tok-1": () => Response.json(view) });
    storeSession({ accessToken: "a", refreshToken: "r", user: { id: "u1" } } as never);
    vi.mocked(currentUser).mockResolvedValue({ id: "u1", name: "Ana", status: "active" } as never);

    open("tok-1");

    expect(await screen.findByRole("button", { name: "Participar" })).toBeInTheDocument();
    expect(screen.queryByText("Algo deu errado")).toBeNull();
  });

  it("shows the unavailable state when the invite is missing", async () => {
    stubApi({});

    open("gone");

    expect(await screen.findByRole("heading", { name: "Convite indisponível" })).toBeInTheDocument();
    expect(screen.getByText("Convite expirado. Peça um novo link.")).toBeInTheDocument();
    expect(screen.queryByText("Algo deu errado")).toBeNull();
  });

  it("shows the invite to a visitor whose session is dead instead of sending them to the login", async () => {
    const expired = vi.fn();
    const actual = await vi.importActual<typeof import("@/lib/auth/flows")>("@/lib/auth/flows");

    vi.mocked(currentUser).mockImplementation(actual.currentUser);
    onSessionExpired(expired);
    stubApi({
      "GET /public/invites/tok-1": () => Response.json(view),
      "GET /auth/me": () => new Response(null, { status: 401 }),
      "POST /auth/refresh": () => new Response(null, { status: 401 }),
    });
    storeSession({ accessToken: "a", refreshToken: "r", user: { id: "u1" } } as never);

    const router = open("tok-1");

    expect(await screen.findByText("Churrasco")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/join/tok-1");
    expect(screen.getByRole("link", { name: "Entrar para participar" })).toBeInTheDocument();
    expect(expired).not.toHaveBeenCalled();
    expect(screen.queryByText("Algo deu errado")).toBeNull();
  });

  it("finishes onboarding first and comes back to the invite", async () => {
    stubApi({ "GET /public/invites/tok-1": () => Response.json(view) });
    storeSession({ accessToken: "a", refreshToken: "r", user: { id: "u1", name: null, status: "pending" } } as never);
    vi.mocked(currentUser).mockResolvedValue({ id: "u1", name: null, status: "pending" } as never);

    const router = open("tok-1");

    await waitFor(() => expect(router.state.location.pathname).toBe("/onboarding"));

    expect(router.state.location.search).toEqual({ next: "/join/tok-1" });
    expect(await screen.findByTestId("onboarding-screen")).toHaveTextContent("/join/tok-1");
    expect(screen.queryByText("Algo deu errado")).toBeNull();
  });
  it("keeps an encoded token encoded on the way to onboarding and in the invite request", async () => {
    const fetchMock = stubApi({ "GET /public/invites/a%2Fb": () => Response.json(view) });

    storeSession({ accessToken: "a", refreshToken: "r", user: { id: "u1", name: null, status: "pending" } } as never);
    vi.mocked(currentUser).mockResolvedValue({ id: "u1", name: null, status: "pending" } as never);

    const router = open("a%2Fb");

    expect(await screen.findByTestId("onboarding-screen")).toHaveTextContent("/join/a%2Fb");
    expect(router.state.location.search).toEqual({ next: "/join/a%2Fb" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.test/public/invites/a%2Fb");
  });
  it("keeps an encoded token encoded in the login link", async () => {
    stubApi({ "GET /public/invites/a%2Fb": () => Response.json(view) });

    open("a%2Fb");

    expect(await screen.findByRole("link", { name: "Entrar para participar" })).toHaveAttribute("href", "/login?next=%2Fjoin%2Fa%252Fb");
  });
});
