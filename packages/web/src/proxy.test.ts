import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "@/lib/auth/cookies";
import { proxy } from "./proxy";

function request(path: string, cookies: Record<string, string> = {}) {
  const headers = new Headers();
  const cookie = Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join("; ");
  if (cookie) headers.set("cookie", cookie);
  return new NextRequest(`https://receivy.example${path}`, { headers });
}

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("public charge proxy headers", () => {
  it("allows signed-link pages without a session and supplies a strict nonce CSP", async () => {
    const response = await proxy(request("/pay/capability"));
    expect(response.status).toBe(200);
    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("script-src 'nonce-");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });
});

describe("session gate", () => {
  it("sends anonymous visitors of the onboarding screen to login with a return path", async () => {
    const response = await proxy(request("/onboarding"));
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location") ?? "").searchParams.get("next")).toBe("/onboarding");
  });

  it("lets a valid access cookie through without touching the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await proxy(request("/", { [ACCESS_COOKIE]: "access" }));
    expect(response.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes an expired access cookie before the server render and rotates both cookies", async () => {
    vi.stubEnv("EZ4_API_URL", "https://api.receivy.example/");
    const fetchMock = vi.fn(async (_url: URL, init?: RequestInit) => {
      expect(JSON.parse(init?.body as string)).toEqual({ refreshToken: "old-refresh" });
      return Response.json({ accessToken: "new-access", refreshToken: "new-refresh", expiresIn: 900 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await proxy(request("/people", { [REFRESH_COOKIE]: "old-refresh" }));

    expect(response.status).toBe(200);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://api.receivy.example/auth/refresh");
    expect(response.cookies.get(ACCESS_COOKIE)?.value).toBe("new-access");
    expect(response.cookies.get(REFRESH_COOKIE)?.value).toBe("new-refresh");
    expect(response.cookies.get(ACCESS_COOKIE)?.httpOnly).toBe(true);
  });

  it("signs the browser out when the refresh token is rejected", async () => {
    vi.stubEnv("EZ4_API_URL", "https://api.receivy.example/");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 401 })));

    const response = await proxy(request("/settings", { [REFRESH_COOKIE]: "revoked" }));

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/login");
    expect(response.cookies.get(ACCESS_COOKIE)?.value).toBe("");
    expect(response.cookies.get(REFRESH_COOKIE)?.value).toBe("");
  });

  it("keeps the session when the API is unreachable so the client can retry", async () => {
    vi.stubEnv("EZ4_API_URL", "https://api.receivy.example/");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));

    const response = await proxy(request("/", { [REFRESH_COOKIE]: "keep" }));

    expect(response.status).toBe(200);
    expect(response.cookies.get(REFRESH_COOKIE)).toBeUndefined();
  });
});
