import { afterEach, describe, expect, it, vi } from "vitest";
import { authApiFetch } from "@/lib/auth/api";
import ShortLinkPage from "./page";

const redirect = vi.fn((path: string) => {
  throw new Error(`NEXT_REDIRECT ${path}`);
});

vi.mock("next/navigation", () => ({ redirect: (path: string) => redirect(path) }));
vi.mock("@/lib/auth/api", () => ({ authApiFetch: vi.fn() }));

afterEach(() => vi.resetAllMocks());

async function open(code: string) {
  await expect(ShortLinkPage({ params: Promise.resolve({ code }) })).rejects.toThrow("NEXT_REDIRECT");
}

describe("short payment link", () => {
  it("resolves the code server-side and opens the pay page with its signed token", async () => {
    vi.mocked(authApiFetch).mockResolvedValue(Response.json({ token: "public-id.123.sig", expiresAt: "2026-12-01T00:00:00Z" }));

    await open("K7m2xQ9aB");

    expect(authApiFetch).toHaveBeenCalledWith("public/short/K7m2xQ9aB", { method: "GET" });
    expect(redirect).toHaveBeenCalledWith("/pay/public-id.123.sig");
  });

  it("sends an unknown, revoked or expired code to the pay page's unavailable state", async () => {
    vi.mocked(authApiFetch).mockResolvedValue(new Response(null, { status: 404 }));

    await open("zzzzzzzzz");

    expect(redirect).toHaveBeenCalledWith("/pay/zzzzzzzzz");
  });

  it("does the same when the API cannot be reached", async () => {
    vi.mocked(authApiFetch).mockRejectedValue(new Error("down"));

    await open("K7m2xQ9aB");

    expect(redirect).toHaveBeenCalledWith("/pay/K7m2xQ9aB");
  });
});
