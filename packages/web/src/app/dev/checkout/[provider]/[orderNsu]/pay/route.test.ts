import { afterEach, describe, expect, it, vi } from "vitest";
import { authApiFetch } from "@/lib/auth/api";
import { notFound, redirect } from "next/navigation";

vi.mock("@/lib/auth/api", () => ({ authApiFetch: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));

import { GET } from "./route";

function fakePayRequest(query: string) {
  return new Request(`https://receivy.example/dev/checkout/pagseguro/order-1/pay${query}`);
}

const params = Promise.resolve({ provider: "pagseguro", orderNsu: "order-1" });

describe("GET dev/checkout/[provider]/[orderNsu]/pay", () => {
  afterEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
  });

  it("404s in production without ever calling the API", async () => {
    vi.stubEnv("NODE_ENV", "production");

    await expect(GET(fakePayRequest("?redirect=https://receivy.example/pay/tok"), { params })).rejects.toThrow("NOT_FOUND");

    expect(notFound).toHaveBeenCalledOnce();
    expect(authApiFetch).not.toHaveBeenCalled();
  });

  it("404s without a redirect target", async () => {
    await expect(GET(fakePayRequest(""), { params })).rejects.toThrow("NOT_FOUND");

    expect(notFound).toHaveBeenCalledOnce();
    expect(authApiFetch).not.toHaveBeenCalled();
  });

  it("404s when the API's fake pay call fails, instead of pretending the payment went through", async () => {
    vi.mocked(authApiFetch).mockResolvedValue(new Response(null, { status: 404 }));

    await expect(GET(fakePayRequest("?redirect=https://receivy.example/pay/tok"), { params })).rejects.toThrow("NOT_FOUND");

    expect(notFound).toHaveBeenCalledOnce();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("pays through the API for the given provider and order, then returns with a single returned=1", async () => {
    vi.mocked(authApiFetch).mockResolvedValue(new Response(null, { status: 200 }));

    const redirectTarget = `https://receivy.example/pay/tok?returned=1`;

    await expect(GET(fakePayRequest(`?redirect=${encodeURIComponent(redirectTarget)}`), { params })).rejects.toThrow("REDIRECT:");

    expect(authApiFetch).toHaveBeenCalledWith("dev/checkout/pagseguro/order-1/pay", { method: "POST" });
    expect(redirect).toHaveBeenCalledWith("https://receivy.example/pay/tok?returned=1");
  });
});
