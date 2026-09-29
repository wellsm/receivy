import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSession, storeSession } from "@/lib/auth/session";
import { loadPublicCharge, ownChargeIdByToken } from "@/lib/public-charge";

const charge = { description: "Churrasco", state: "pending" };
const fetchMock = vi.fn();

function calls(): string[] {
  return fetchMock.mock.calls.map(([url, init]) => `${(init as RequestInit | undefined)?.method ?? "GET"} ${new URL(url as string).pathname}`);
}

beforeEach(() => {
  vi.stubEnv("VITE_API_URL", "https://api.test");
  vi.stubGlobal("fetch", fetchMock);
  clearSession();
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("loadPublicCharge", () => {
  it("posts the provider return when order, transaction and slug come back in the url", async () => {
    fetchMock.mockResolvedValue(Response.json(charge));

    const result = await loadPublicCharge("tok", { order_nsu: "123", transaction_nsu: "t1", slug: "s1" });

    expect(result).toEqual(charge);
    expect(calls()).toEqual(["POST /public/charges/tok/provider-return"]);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ orderNsu: "123", transactionNsu: "t1", slug: "s1" });
  });

  it("falls back to the plain charge when the return is refused", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 422 })).mockResolvedValueOnce(Response.json(charge));

    const result = await loadPublicCharge("tok", { order_nsu: "1", transaction_nsu: "t1", slug: "s1" });

    expect(result).toEqual(charge);
    expect(calls()).toEqual(["POST /public/charges/tok/provider-return", "GET /public/charges/tok"]);
  });

  it("falls back to the plain charge when the API is unreachable for the return", async () => {
    fetchMock.mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce(Response.json(charge));

    expect(await loadPublicCharge("tok", { order_nsu: "1", transaction_nsu: "t1", slug: "s1" })).toEqual(charge);
  });

  it("gets the charge without the provider ids", async () => {
    fetchMock.mockResolvedValue(Response.json(charge));

    expect(await loadPublicCharge("tok", { order_nsu: "1" })).toEqual(charge);
    expect(calls()).toEqual(["GET /public/charges/tok"]);
  });

  it("answers null for a dead token", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));

    expect(await loadPublicCharge("tok", {})).toBeNull();
  });

  it("answers null when the API is unreachable", async () => {
    fetchMock.mockRejectedValue(new Error("down"));

    expect(await loadPublicCharge("tok", {})).toBeNull();
  });

  it("answers null when the fallback fails too", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));

    expect(await loadPublicCharge("tok", { order_nsu: "1", transaction_nsu: "t1", slug: "s1" })).toBeNull();
    expect(calls()).toHaveLength(2);
  });
});

describe("ownChargeIdByToken", () => {
  it("makes no request without a session", async () => {
    expect(await ownChargeIdByToken("tok")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers the charge id for a signed-in participant", async () => {
    storeSession({ accessToken: "a", refreshToken: "r", user: { id: "u1" } } as never);
    fetchMock.mockResolvedValue(Response.json({ id: "c1" }));

    expect(await ownChargeIdByToken("tok")).toBe("c1");
    expect(calls()).toEqual(["GET /charges/by-link/tok"]);
  });

  it("answers null for a stranger", async () => {
    storeSession({ accessToken: "a", refreshToken: "r", user: { id: "u1" } } as never);
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));

    expect(await ownChargeIdByToken("tok")).toBeNull();
  });

  it("answers null when the API is unreachable", async () => {
    storeSession({ accessToken: "a", refreshToken: "r", user: { id: "u1" } } as never);
    fetchMock.mockRejectedValue(new Error("down"));

    expect(await ownChargeIdByToken("tok")).toBeNull();
  });
});
