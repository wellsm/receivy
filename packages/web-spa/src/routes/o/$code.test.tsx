import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppRouter } from "@/router";
import { requested, stubApi } from "@/test/stub-api";

function open(code: string) {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [`/o/${code}`] }) });

  render(<RouterProvider router={router} />);

  return router;
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("short opt-out link", () => {
  it("resolves the code and opens the opt-out page with the account's token", async () => {
    const fetchMock = stubApi({
      "GET /public/opt-out/short/K7m2xQ": () => Response.json({ token: "user-id.sig" }),
      "POST /public/notices/opt-out/user-id.sig": () => Response.json({}),
    });

    const router = open("K7m2xQ");

    await waitFor(() => expect(router.state.location.pathname).toBe("/opt-out/user-id.sig"));

    expect(await screen.findByRole("heading", { name: "Avisos por e-mail" })).toBeInTheDocument();
    expect(requested(fetchMock)).toContain("GET /public/opt-out/short/K7m2xQ");
    expect(screen.queryByText("Algo deu errado")).toBeNull();
  });

  it("sends an unknown code to the opt-out page's invalid state", async () => {
    stubApi({});

    const router = open("zzzzzz");

    await waitFor(() => expect(router.state.location.pathname).toBe("/opt-out/zzzzzz"));

    expect(await screen.findByText("Este link não é válido ou expirou. Abra o link de um e-mail mais recente.")).toBeInTheDocument();
    expect(screen.queryByText("Algo deu errado")).toBeNull();
  });

  it("does the same when the API cannot be reached", async () => {
    vi.stubEnv("VITE_API_URL", "https://api.test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/public/opt-out/short/")) {
          throw new Error("down");
        }

        return new Response(null, { status: 404 });
      }),
    );

    const router = open("K7m2xQ");

    await waitFor(() => expect(router.state.location.pathname).toBe("/opt-out/K7m2xQ"));

    expect(await screen.findByText("Este link não é válido ou expirou. Abra o link de um e-mail mais recente.")).toBeInTheDocument();
    expect(screen.queryByText("Algo deu errado")).toBeNull();
  });
});
