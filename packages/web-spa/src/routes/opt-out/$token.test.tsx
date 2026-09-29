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

  it("shows the invalid-link state for a token the API does not know", async () => {
    stubApi({});

    open("bad");

    expect(await screen.findByText("Este link não é válido ou expirou. Abra o link de um e-mail mais recente.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Voltar a receber" })).toBeNull();
    expect(screen.queryByText("Algo deu errado")).toBeNull();
  });

  it.each([
    ["the API answers 500", () => stubApi({ "POST /public/notices/opt-out/tok": () => new Response(null, { status: 500 }) })],
    [
      "the network fails",
      () => {
        vi.stubEnv("VITE_API_URL", "https://api.test");
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
      },
    ],
  ])("offers a retry instead of the root error when %s", async (_name, arrange) => {
    arrange();

    open("tok");

    expect(await screen.findByText("Não foi possível carregar esta página agora. Tente de novo em instantes.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeInTheDocument();
    expect(screen.queryByText("Algo deu errado")).toBeNull();
  });

  it("runs the opt-out again when the person retries", async () => {
    let answer = 503;

    stubApi({ "POST /public/notices/opt-out/tok": () => new Response(answer === 200 ? "{}" : null, { status: answer }) });

    open("tok");

    await userEvent.click(await screen.findByRole("button", { name: "Tentar de novo" }));

    answer = 200;

    await userEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));

    expect(await screen.findByText(/não recebe mais e-mails/)).toBeInTheDocument();
    expect(screen.queryByText("Algo deu errado")).toBeNull();
  });
});
