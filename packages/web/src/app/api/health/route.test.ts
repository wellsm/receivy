import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

describe("GET /api/health", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns a safe unavailable response when the EZ4 URL is missing", async () => {
    vi.stubEnv("EZ4_API_URL", "");

    const response = await GET();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");

    await expect(response.json()).resolves.toEqual({ status: "unavailable" });
  });

  it("proxies the EZ4 health contract without caching it", async () => {
    vi.stubEnv("EZ4_API_URL", "http://localhost:3735/local-receivy-api");

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ status: "ok", service: "receivy-api" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    vi.stubGlobal("fetch", fetchMock);

    const response = await GET();

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("http://localhost:3735/local-receivy-api/health"),
      { cache: "no-store" },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");

    await expect(response.json()).resolves.toEqual({
      status: "ok",
      service: "receivy-api",
    });
  });
});
