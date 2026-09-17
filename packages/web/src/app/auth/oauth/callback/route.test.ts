import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { authApiFetch } from "@/lib/auth/api";
import { cookies } from "next/headers";

vi.mock("@/lib/auth/api", () => ({ authApiFetch: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

describe("OAuth browser binding", () => {
  beforeEach(() => vi.resetAllMocks());

  it("rejects a callback without the originating browser cookie", async () => {
    vi.mocked(cookies).mockResolvedValue({ get: () => undefined } as never);
    const response = await GET(new Request("https://receivy.example/auth/oauth/callback?code=stolen"));
    expect(authApiFetch).not.toHaveBeenCalled();
    expect(response.headers.get("Location")).toBe("https://receivy.example/login?error=oauth");
  });

  it("exchanges with the secret cookie and keeps API tokens out of the body and URL", async () => {
    vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: "v".repeat(43) }) } as never);
    vi.mocked(authApiFetch).mockResolvedValue(Response.json({
      accessToken: "secret-access", refreshToken: "secret-refresh", expiresIn: 900, user: {},
    }));
    const response = await GET(new Request("https://receivy.example/auth/oauth/callback?code=grant"));
    expect(authApiFetch).toHaveBeenCalledWith("auth/oauth/exchange", expect.objectContaining({
      body: JSON.stringify({ code: "grant", codeVerifier: "v".repeat(43), deviceName: "Web" }),
    }));
    expect(response.headers.get("Location")).toBe("https://receivy.example/feed");
    expect(await response.text()).not.toContain("secret-");
    const cookie = response.cookies.get("__Host-receivy_refresh");
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/" });
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  });
});
