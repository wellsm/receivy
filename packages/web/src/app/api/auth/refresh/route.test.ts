import { cookies } from "next/headers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { authApiFetch } from "@/lib/auth/api";
import { POST } from "./route";

vi.mock("@/lib/auth/api", () => ({ authApiFetch: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

function refreshRequest(): Request {
  return new Request("https://receivy.example/api/auth/refresh", {
    method: "POST",
    headers: { origin: "https://receivy.example" },
  });
}

describe("POST /api/auth/refresh", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: "current-refresh-token" }) } as never);
  });

  it("keeps the cookies a sibling window already rotated when the API reports a stale token", async () => {
    vi.mocked(authApiFetch).mockResolvedValue(
      Response.json({ message: "Sessão renovada em outra janela.", context: { code: "STALE_SESSION" } }, { status: 409 }),
    );

    const response = await POST(refreshRequest());

    expect(response.status).toBe(409);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("clears the cookies when the session is really gone", async () => {
    vi.mocked(authApiFetch).mockResolvedValue(new Response(null, { status: 401 }));

    const response = await POST(refreshRequest());

    expect(response.status).toBe(401);
    expect(response.headers.getSetCookie().join("\n")).toContain("__Host-receivy_refresh=;");
  });
});
