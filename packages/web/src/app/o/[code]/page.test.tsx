import { afterEach, describe, expect, it, vi } from "vitest";
import { authApiFetch } from "@/lib/auth/api";
import OptOutShortLinkPage from "./page";

const redirect = vi.fn((path: string) => {
  throw new Error(`NEXT_REDIRECT ${path}`);
});

vi.mock("next/navigation", () => ({ redirect: (path: string) => redirect(path) }));
vi.mock("@/lib/auth/api", () => ({ authApiFetch: vi.fn() }));

afterEach(() => vi.resetAllMocks());

async function open(code: string) {
  await expect(OptOutShortLinkPage({ params: Promise.resolve({ code }) })).rejects.toThrow("NEXT_REDIRECT");
}

describe("short opt-out link", () => {
  it("resolves the code server-side and opens the opt-out page with the account's token", async () => {
    vi.mocked(authApiFetch).mockResolvedValue(Response.json({ token: "user-id.sig" }));

    await open("K7m2xQ");

    expect(authApiFetch).toHaveBeenCalledWith("public/opt-out/short/K7m2xQ", { method: "GET" });
    expect(redirect).toHaveBeenCalledWith("/opt-out/user-id.sig");
  });

  it("sends an unknown code to the opt-out page's invalid state", async () => {
    vi.mocked(authApiFetch).mockResolvedValue(new Response(null, { status: 404 }));

    await open("zzzzzz");

    expect(redirect).toHaveBeenCalledWith("/opt-out/zzzzzz");
  });

  it("does the same when the API cannot be reached", async () => {
    vi.mocked(authApiFetch).mockRejectedValue(new Error("down"));

    await open("K7m2xQ");

    expect(redirect).toHaveBeenCalledWith("/opt-out/K7m2xQ");
  });
});
