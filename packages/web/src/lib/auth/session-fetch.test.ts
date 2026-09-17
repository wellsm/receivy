import { cookies } from "next/headers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionApiFetch } from "./session-fetch";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

function fetchMock(response = Response.json([{ id: "charge-1" }])) {
  const mock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", mock);
  return mock;
}

function headersOf(mock: ReturnType<typeof fetchMock>): Record<string, string> {
  return mock.mock.calls[0]?.[1]?.headers as Record<string, string>;
}

beforeEach(() => {
  vi.resetAllMocks();
  process.env.EZ4_API_URL = "https://api.receivy.example/";
});

afterEach(() => {
  delete process.env.EZ4_API_URL;
  vi.unstubAllGlobals();
});

describe("sessionApiFetch", () => {
  it("carries the access cookie as a bearer token and parses the payload", async () => {
    vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: "access-token" }) } as never);
    const mock = fetchMock();

    const charges = await sessionApiFetch<{ id: string }[]>("charges?month=2026-09");

    expect(mock.mock.calls[0]?.[0]?.toString()).toBe("https://api.receivy.example/charges?month=2026-09");
    expect(headersOf(mock).authorization).toBe("Bearer access-token");
    expect(charges).toEqual([{ id: "charge-1" }]);
  });

  it("sends no authorization when the access cookie is gone, so the API answers instead of the page guessing", async () => {
    vi.mocked(cookies).mockResolvedValue({ get: () => undefined } as never);
    const mock = fetchMock();

    await sessionApiFetch("charges?month=2026-09");

    expect(headersOf(mock)).not.toHaveProperty("authorization");
  });

  it("answers null on a rejected request instead of throwing at the render", async () => {
    vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: "expired-token" }) } as never);
    fetchMock(new Response(null, { status: 401 }));

    await expect(sessionApiFetch("charges?month=2026-09")).resolves.toBeNull();
  });

  it("keeps the headers the caller passed", async () => {
    vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: "access-token" }) } as never);
    const mock = fetchMock();

    await sessionApiFetch("charges", { headers: { "idempotency-key": "key-1" } });

    expect(headersOf(mock)["idempotency-key"]).toBe("key-1");
    expect(headersOf(mock).authorization).toBe("Bearer access-token");
  });
});
