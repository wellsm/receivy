import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppRouter } from "@/router";
import { stubApi } from "@/test/stub-api";

const TARGET = "http://localhost:3000/pay/tok?returned=1";

function open(path: string) {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [path] }) });

  render(<RouterProvider router={router} />);

  return router;
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("dev checkout page", () => {
  it("sends the PagBank button to the local pay step, carrying the redirect", async () => {
    const fetchMock = stubApi({});

    open(`/dev/checkout/pagseguro/order-1?redirect=${encodeURIComponent(TARGET)}`);

    expect(await screen.findByRole("heading", { name: "Checkout de mentira" })).toBeInTheDocument();
    expect(screen.getByText("Pedido order-1. Nada é cobrado: o botão volta para a cobrança como o PagBank voltaria.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Simular pagamento" })).toHaveAttribute("href", `/dev/checkout/pagseguro/order-1/pay?redirect=${encodeURIComponent(TARGET)}`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the InfinitePay button to the charge with the provider ids", async () => {
    stubApi({});

    open(`/dev/checkout/infinitepay/order-12345678?redirect=${encodeURIComponent(TARGET)}`);

    expect(await screen.findByText("Pedido order-12345678. Nada é cobrado: o botão volta para a cobrança como a InfinitePay voltaria.")).toBeInTheDocument();

    const href = new URL(screen.getByRole("link", { name: "Simular pagamento" }).getAttribute("href") ?? "");

    expect(`${href.origin}${href.pathname}`).toBe("http://localhost:3000/pay/tok");
    expect(href.searchParams.get("returned")).toBe("1");
    expect(href.searchParams.get("order_nsu")).toBe("order-12345678");
    expect(href.searchParams.get("transaction_nsu")).toMatch(/^fake-\d+$/);
    expect(href.searchParams.get("slug")).toBe("fake-order-12");
    expect(href.searchParams.get("receipt_url")).toBe("https://example.invalid/recibo");
  });

  it("explains that the page needs a redirect", async () => {
    stubApi({});

    open("/dev/checkout/pagseguro/order-1");

    expect(await screen.findByText("Sem redirect: abra este link a partir da cobrança.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Simular pagamento" })).toBeNull();
  });

  it("does not exist outside development", async () => {
    stubApi({});
    vi.stubEnv("DEV", false);

    open(`/dev/checkout/pagseguro/order-1?redirect=${encodeURIComponent(TARGET)}`);

    expect(await screen.findByText("Página não encontrada")).toBeInTheDocument();
    expect(screen.queryByText("Checkout de mentira")).toBeNull();
    expect(screen.queryByText("Algo deu errado")).toBeNull();
  });
});
