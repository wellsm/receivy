import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppRouter } from "@/router";
import { requested, stubApi } from "@/test/stub-api";

function open(code: string) {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [`/p/${code}`] }) });

  render(<RouterProvider router={router} />);

  return router;
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("short payment link", () => {
  it("resolves the code and opens the pay page with its signed token", async () => {
    const fetchMock = stubApi({
      "GET /public/short/K7m2xQ9aB": () => Response.json({ token: "public-id.123.sig", expiresAt: "2026-12-01T00:00:00Z" }),
      "GET /public/charges/public-id.123.sig": () => Response.json({ state: "paid", creditorFirstName: "Lucas", description: "x", amount: { amountCents: 1, currency: "BRL" }, dueDate: "2026-10-10", uploadsEnabled: false }),
    });

    const router = open("K7m2xQ9aB");

    await waitFor(() => expect(router.state.location.pathname).toBe("/pay/public-id.123.sig"));

    expect(requested(fetchMock)).toContain("GET /public/short/K7m2xQ9aB");
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ headers: expect.any(Headers) }));
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("authorization")).toBeNull();
    expect(screen.queryByText("Algo deu errado")).toBeNull();
  });

  it("sends an unknown, revoked or expired code to the pay page's unavailable state", async () => {
    stubApi({});

    const router = open("zzzzzzzzz");

    expect(await screen.findByRole("heading", { name: "Link indisponível" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/pay/zzzzzzzzz");
    expect(screen.queryByText("Algo deu errado")).toBeNull();
  });

  it("does the same when the API cannot be reached", async () => {
    vi.stubEnv("VITE_API_URL", "https://api.test");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));

    const router = open("K7m2xQ9aB");

    expect(await screen.findByRole("heading", { name: "Link indisponível" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/pay/K7m2xQ9aB");
    expect(screen.queryByText("Algo deu errado")).toBeNull();
  });
});
