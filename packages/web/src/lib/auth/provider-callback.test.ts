import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { relayProviderCallback } from "./provider-callback";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("EZ4_API_URL", "https://api.example/dev-receivy-api");
  vi.stubEnv("WEB_APP_URL", "https://receivy.wellsm.dev");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); fetchMock.mockReset(); });

describe("provider callback bridge", () => {
  it("forwards the Google query untouched and relays the API redirect", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 302, headers: { location: "receivy://auth/callback?code=grant" } }));

    const response = await relayProviderCallback(new Request("http://0.0.0.0:3000/api/auth/google/callback?code=abc&state=xyz"), "google");
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];

    expect(url.toString()).toBe("https://api.example/dev-receivy-api/auth/google/callback?code=abc&state=xyz");
    expect(init.redirect).toBe("manual");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("receivy://auth/callback?code=grant");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("forwards the Apple form post body and content type", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://receivy.wellsm.dev/auth/oauth/callback?code=grant" } }));

    const body = "code=abc&state=xyz&user=%7B%7D";
    const response = await relayProviderCallback(new Request("http://0.0.0.0:3000/api/auth/apple/callback", {
      method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" },
    }), "apple");
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];

    expect(url.toString()).toBe("https://api.example/dev-receivy-api/auth/apple/callback");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(body);
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(response.headers.get("location")).toBe("https://receivy.wellsm.dev/auth/oauth/callback?code=grant");
  });

  it.each([
    ["API error body", new Response(JSON.stringify({ code: "UNAUTHENTICATED", message: "internal detail" }), { status: 401 })],
    ["redirect without location", new Response(null, { status: 302 })],
  ])("never exposes an upstream %s: redirects to the public login with a generic error", async (_label, upstream) => {
    fetchMock.mockResolvedValue(upstream);

    const response = await relayProviderCallback(new Request("http://0.0.0.0:3000/api/auth/google/callback?state=x"), "google");

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://receivy.wellsm.dev/login?error=oauth");
    expect(await response.text()).not.toContain("internal detail");
  });

  it("treats network failures and oversized Apple posts as a generic error without calling the API", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    expect((await relayProviderCallback(new Request("http://0.0.0.0:3000/api/auth/google/callback?state=x"), "google")).headers.get("location"))
      .toBe("https://receivy.wellsm.dev/login?error=oauth");
    fetchMock.mockReset();

    const huge = await relayProviderCallback(new Request("http://0.0.0.0:3000/api/auth/apple/callback", { method: "POST", body: "a".repeat(40_000) }), "apple");

    expect(huge.headers.get("location")).toBe("https://receivy.wellsm.dev/login?error=oauth");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
