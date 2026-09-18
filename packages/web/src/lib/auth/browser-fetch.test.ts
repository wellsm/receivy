import { afterEach, describe, expect, it, vi } from "vitest";
import { browserFetch } from "./browser-fetch";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browserFetch", () => {
  it("retries with the pair a sibling window rotated when the refresh reports a conflict", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ items: [] }, { status: 200 }));

    vi.stubGlobal("fetch", fetchMock);

    const response = await browserFetch("/api/financial/timeline");

    expect(response.status).toBe(200);
    expect(fetchMock.mock.calls.map(([target]) => target)).toEqual([
      "/api/financial/timeline",
      "/api/auth/refresh",
      "/api/financial/timeline",
    ]);
  });

  it("stops after a second conflict instead of retrying forever", async () => {
    const fetchMock = vi.fn().mockImplementation((target: string) =>
      Promise.resolve(new Response(null, { status: target === "/api/auth/refresh" ? 409 : 401 })),
    );

    vi.stubGlobal("fetch", fetchMock);

    const response = await browserFetch("/api/financial/timeline");

    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});
