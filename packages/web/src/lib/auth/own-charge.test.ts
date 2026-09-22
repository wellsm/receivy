import { cookies } from "next/headers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ownChargeIdByToken } from "./own-charge";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

function fetchMock(response: Response) {
  const mock = vi.fn().mockResolvedValue(response);

  vi.stubGlobal("fetch", mock);

  return mock;
}

beforeEach(() => {
  vi.resetAllMocks();
  process.env.EZ4_API_URL = "https://api.receivy.example/";
});

afterEach(() => {
  delete process.env.EZ4_API_URL;
  vi.unstubAllGlobals();
});

describe("ownChargeIdByToken", () => {
  it("answers the charge id the API resolves for the signed-in participant", async () => {
    vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: "access-token" }) } as never);

    const mock = fetchMock(Response.json({ id: "charge-1" }));

    await expect(ownChargeIdByToken("pub.token")).resolves.toBe("charge-1");
    expect(mock.mock.calls[0]?.[0]?.toString()).toBe("https://api.receivy.example/charges/by-link/pub.token");
    expect((mock.mock.calls[0]?.[1]?.headers as Record<string, string>).authorization).toBe("Bearer access-token");
  });

  it("never asks the API without a session cookie", async () => {
    vi.mocked(cookies).mockResolvedValue({ get: () => undefined } as never);

    const mock = fetchMock(Response.json({ id: "charge-1" }));

    await expect(ownChargeIdByToken("pub.token")).resolves.toBeNull();
    expect(mock).not.toHaveBeenCalled();
  });

  it("answers null when the API refuses (stranger, dead link) or is unreachable", async () => {
    vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: "access-token" }) } as never);
    fetchMock(new Response(null, { status: 404 }));

    await expect(ownChargeIdByToken("pub.token")).resolves.toBeNull();

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));

    await expect(ownChargeIdByToken("pub.token")).resolves.toBeNull();
  });
});
