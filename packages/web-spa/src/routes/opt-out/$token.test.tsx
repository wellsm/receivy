import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import userEvent from "@testing-library/user-event";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppRouter } from "@/router";
import { requested, stubApi } from "@/test/stub-api";

function open(token: string) {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [`/opt-out/${token}`] }) });

  render(<RouterProvider router={router} />);

  return router;
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  document.head.querySelectorAll("meta[name=robots]").forEach((meta) => meta.remove());
});

describe("opt-out route", () => {
  it("opts the person out on load and offers to opt back in", async () => {
    const fetchMock = stubApi({
      "POST /public/notices/opt-out/tok": () => Response.json({}),
      "DELETE /public/notices/opt-out/tok": () => Response.json({}),
    });

    open("tok");

    expect(await screen.findByRole("heading", { name: "Avisos por e-mail" })).toBeInTheDocument();
    expect(screen.getByText(/não recebe mais e-mails/)).toBeInTheDocument();
    expect(requested(fetchMock)).toEqual(["POST /public/notices/opt-out/tok"]);
    expect(document.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("noindex, nofollow");

    await userEvent.click(screen.getByRole("button", { name: "Voltar a receber" }));

    expect(await screen.findByText("Você voltou a receber e-mails de cobrança.")).toBeInTheDocument();
    expect(requested(fetchMock)).toContain("DELETE /public/notices/opt-out/tok");
    expect(screen.queryByText("Algo deu errado")).toBeNull();
  });

  it("shows the not found page for a token the API does not know", async () => {
    stubApi({});

    open("bad");

    expect(await screen.findByText("Página não encontrada")).toBeInTheDocument();
    expect(screen.queryByText("Algo deu errado")).toBeNull();
  });
});
