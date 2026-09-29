import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onSessionExpired } from "@/lib/api/client";
import { clearSession, storeSession } from "@/lib/auth/session";
import { createAppRouter } from "@/router";
import { requested, stubApi } from "@/test/stub-api";

const charge = {
  creditorFirstName: "Lucas",
  description: "Churrasco",
  amount: { amountCents: 12_000, currency: "BRL" },
  dueDate: "2026-10-10",
  state: "pending",
  uploadsEnabled: true,
  payment: { provider: "pix", value: "lucas@pix.test" },
  paymentLink: null,
  receiptUrl: null,
};

const ownCharge = {
  id: "c1",
  direction: "payable",
  description: "Aluguel do mês",
  amount: { amountCents: 2500, currency: "BRL" },
  dueDate: "2026-09-10",
  state: "pending",
  billingId: "b1",
  recurrence: "once",
  installment: null,
  installmentCount: null,
  counterpartName: "Lucas",
  proofState: null,
  recipient: { userId: "u2", name: "Lucas", email: null },
  debtorId: "u1",
  payment: { provider: "pix", kind: "email", value: "pix@example.com", label: "Principal" },
  paymentLink: null,
  receiptUrl: null,
  sharingState: "ready",
  proof: null,
  cancelledAt: null,
  paidAt: null,
  createdAt: "2026-09-01",
};

function renderAt(path: string) {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [path] }) });

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
});

describe("pay route", () => {
  it("sends a signed-in participant back from the checkout to their own charge", async () => {
    const fetchMock = stubApi({
      "GET /public/charges/tok": () => Response.json(charge),
      "GET /charges/by-link/tok": () => Response.json({ id: "c1" }),
      "GET /auth/me": () => Response.json({ user: { id: "u1", name: "Ana", status: "active" } }),
      "GET /charges/c1": () => Response.json(ownCharge),
    });

    storeSession({ accessToken: "a", refreshToken: "r", user: { id: "u1" } } as never);

    const router = renderAt("/pay/tok?returned=1");

    expect(await screen.findByText("Aluguel do mês")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/charges/c1");
    expect(router.state.location.search).toEqual({ returned: "1" });
    expect(router.state.location.href).toBe("/charges/c1?returned=1");
    expect(requested(fetchMock)).toContain("GET /charges/by-link/tok");
    expect(screen.queryByText("Algo deu errado")).toBeNull();
  });

  it("keeps a payer with a dead session on the public page instead of sending them to the login", async () => {
    const expired = vi.fn();

    onSessionExpired(expired);
    stubApi({
      "GET /public/charges/tok": () => Response.json(charge),
      "GET /charges/by-link/tok": () => new Response(null, { status: 401 }),
      "POST /auth/refresh": () => new Response(null, { status: 401 }),
    });
    storeSession({ accessToken: "a", refreshToken: "r", user: { id: "u1" } } as never);

    const router = renderAt("/pay/tok?returned=1");

    expect(await screen.findByRole("heading", { name: "Churrasco" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/pay/tok");
    expect(expired).not.toHaveBeenCalled();
    expect(screen.queryByText("Algo deu errado")).toBeNull();
  });

  it("renders the public screen without a session and never asks which charge is theirs", async () => {
    const fetchMock = stubApi({ "GET /public/charges/tok": () => Response.json(charge) });

    const router = renderAt("/pay/tok?returned=1");

    expect(await screen.findByRole("heading", { name: "Churrasco" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/pay/tok");
    expect(requested(fetchMock).some((call) => call.includes("by-link"))).toBe(false);
    expect(screen.queryByText("Algo deu errado")).toBeNull();
  });

  it("keeps a signed-in visitor on the public screen when the charge is not theirs", async () => {
    stubApi({ "GET /public/charges/tok": () => Response.json(charge) });
    storeSession({ accessToken: "a", refreshToken: "r", user: { id: "u1" } } as never);

    const router = renderAt("/pay/tok?returned=1");

    expect(await screen.findByRole("heading", { name: "Churrasco" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/pay/tok");
    expect(screen.queryByText("Algo deu errado")).toBeNull();
  });

  it("shows the unavailable state for a dead token", async () => {
    stubApi({});

    renderAt("/pay/dead");

    expect(await screen.findByRole("heading", { name: "Link indisponível" })).toBeInTheDocument();
    expect(screen.queryByText("Algo deu errado")).toBeNull();
  });

  it("posts the provider return with the ids from the url as strings", async () => {
    const fetchMock = stubApi({ "POST /public/charges/tok/provider-return": () => Response.json(charge) });

    renderAt("/pay/tok?order_nsu=123&transaction_nsu=456&slug=shop");

    expect(await screen.findByRole("heading", { name: "Churrasco" })).toBeInTheDocument();

    const posts = fetchMock.mock.calls.filter(([url, init]) => url.endsWith("/public/charges/tok/provider-return") && init?.method === "POST");

    expect(posts).toHaveLength(1);
    expect(JSON.parse(String(posts[0]?.[1]?.body))).toEqual({ orderNsu: "123", transactionNsu: "456", slug: "shop" });
    expect(screen.queryByText("Algo deu errado")).toBeNull();
  });

  it("does not post the provider return again when history brings the visitor back to the url", async () => {
    const fetchMock = stubApi({ "POST /public/charges/tok/provider-return": () => Response.json(charge) });

    const router = renderAt("/pay/tok?order_nsu=123&transaction_nsu=456&slug=shop");

    await screen.findByRole("heading", { name: "Churrasco" });
    await act(async () => {
      await router.navigate({ to: "/privacy" });
    });
    expect(await screen.findByRole("heading", { name: "Privacidade" })).toBeInTheDocument();

    await act(async () => {
      router.history.back();
    });

    expect(await screen.findByRole("heading", { name: "Churrasco" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/pay/tok");
    expect(requested(fetchMock).filter((call) => call === "POST /public/charges/tok/provider-return")).toHaveLength(1);
    expect(screen.queryByText("Algo deu errado")).toBeNull();
  });

  it("marks the page as not indexable", async () => {
    stubApi({ "GET /public/charges/tok": () => Response.json(charge) });

    renderAt("/pay/tok");

    await screen.findByRole("heading", { name: "Churrasco" });
    await waitFor(() => expect(document.title).toBe("Cobrança | Receivy"));

    expect(document.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("noindex, nofollow");
  });
});
