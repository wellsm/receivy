import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAppRouter } from "@/router";
import { requested, stubApi } from "@/test/stub-api";

const assign = vi.fn();
const PAY = "/dev/checkout/pagseguro/order-1/pay";
const TARGET = `${window.location.origin}/pay/tok`;

function open(query: string) {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [`${PAY}${query}`] }) });

  render(<RouterProvider router={router} />);

  return router;
}

async function settle() {
  expect(await screen.findByText("Página não encontrada")).toBeInTheDocument();
  expect(screen.queryByText("Algo deu errado")).toBeNull();
  expect(assign).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.stubGlobal("location", { origin: window.location.origin, assign });
});

afterEach(() => {
  cleanup();
  assign.mockReset();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("dev checkout pay route", () => {
  it("404s in production without ever calling the API", async () => {
    const fetchMock = stubApi({ "POST /dev/checkout/pagseguro/order-1/pay": () => new Response(null, { status: 200 }) });

    vi.stubEnv("DEV", false);
    open(`?redirect=${encodeURIComponent(TARGET)}`);

    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("404s without a redirect target", async () => {
    const fetchMock = stubApi({ "POST /dev/checkout/pagseguro/order-1/pay": () => new Response(null, { status: 200 }) });

    open("");

    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("404s for a redirect to another origin, without paying", async () => {
    const fetchMock = stubApi({ "POST /dev/checkout/pagseguro/order-1/pay": () => new Response(null, { status: 200 }) });

    open(`?redirect=${encodeURIComponent("https://evil.example/pay/tok")}`);

    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("404s when the API's fake pay call fails, instead of pretending the payment went through", async () => {
    stubApi({});

    open(`?redirect=${encodeURIComponent(TARGET)}`);

    await settle();
  });

  it("pays through the API for the given provider and order, then returns with a single returned=1", async () => {
    const fetchMock = stubApi({ "POST /dev/checkout/pagseguro/order-1/pay": () => new Response(null, { status: 200 }) });

    open(`?redirect=${encodeURIComponent(`${TARGET}?returned=1`)}`);

    expect(await screen.findByText("Voltando para a cobrança…")).toBeInTheDocument();
    await waitFor(() => expect(assign).toHaveBeenCalledOnce());

    expect(requested(fetchMock)).toEqual(["POST /dev/checkout/pagseguro/order-1/pay"]);
    expect(assign).toHaveBeenCalledWith(`${TARGET}?returned=1`);
    expect(screen.queryByText("Algo deu errado")).toBeNull();
  });

  it("adds returned=1 when the target had none", async () => {
    stubApi({ "POST /dev/checkout/pagseguro/order-1/pay": () => new Response(null, { status: 200 }) });

    open(`?redirect=${encodeURIComponent(TARGET)}`);

    expect(await screen.findByText("Voltando para a cobrança…")).toBeInTheDocument();
    await waitFor(() => expect(assign).toHaveBeenCalledWith(`${TARGET}?returned=1`));
    expect(screen.queryByText("Algo deu errado")).toBeNull();
  });
});
