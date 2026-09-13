import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const session = {
  accessToken: "access-token",
  refreshToken: "refresh-token",
  expiresIn: 900,
  user: {
    id: "00000000-0000-4000-8000-000000000001",
    email: "ana@example.com",
    name: null,
    avatar: null,
    locale: "pt-BR",
    timezone: "America/Sao_Paulo",
    country: "BR",
    currency: "BRL",
  },
};

beforeEach(() => {
  process.env.EZ4_API_URL = "https://api.receivy.example/";
});

afterEach(() => {
  delete process.env.EZ4_API_URL;
  vi.unstubAllGlobals();
});

describe("POST /api/auth/email/confirm", () => {
  it("keeps tokens out of JSON and stores them in hardened cookies", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify(session), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ));
    const request = new Request("https://receivy.example/api/auth/email/confirm", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://receivy.example" },
      body: JSON.stringify({ email: "ana@example.com", code: "123456" }),
    });

    const response = await POST(request);
    const text = await response.text();
    const cookies = response.headers.getSetCookie().join("\n");

    expect(response.status).toBe(200);
    expect(text).not.toContain("access-token");
    expect(text).not.toContain("refresh-token");
    expect(cookies).toContain("__Host-receivy_access=access-token");
    expect(cookies).toContain("__Host-receivy_refresh=refresh-token");
    expect(cookies).toContain("HttpOnly");
    expect(cookies).toContain("Secure");
    expect(cookies).toContain("SameSite=lax");
    expect(cookies).toContain("Path=/");
    expect(cookies).not.toContain("Domain=");
  });

  it("returns one generic message for rejected confirmations", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    const request = new Request("https://receivy.example/api/auth/email/confirm", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://receivy.example" },
      body: JSON.stringify({ email: "ana@example.com", code: "000000" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      message: "Código inválido ou expirado. Peça um novo código e tente novamente.",
    });
  });
});
