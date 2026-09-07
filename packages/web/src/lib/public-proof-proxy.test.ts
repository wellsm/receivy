import { beforeEach, expect, it, vi } from "vitest";
import { publicProofProxy } from "./public-proof-proxy";
import { proofUploadOrigin } from "./proof-origin";
const upstream = vi.hoisted(() => vi.fn());
vi.mock("./auth/api", () => ({ authApiFetch: upstream }));
beforeEach(() => upstream.mockReset());
it("forbids public history/review/download escapes and cross-origin writes", async () => {
  for (const path of ["", "proofs", "uploads/../../auth/me", "id/download", "id/review"]) {
    expect((await publicProofProxy(new Request("http://localhost:3000/api/public-proof/token", { method: "POST", headers: { origin: "http://localhost:3000" } }), "token", path)).status).toBe(404);
  }
  expect((await publicProofProxy(new Request("http://localhost:3000/api/public-proof/token", { method: "POST", headers: { origin: "https://evil.test" } }), "token", "uploads")).status).toBe(403);
  expect(upstream).not.toHaveBeenCalled();
});
it("forwards only capability upload operations, without browser cookies or spoofed IP", async () => {
  upstream.mockResolvedValue(Response.json({ id: "intent" }));
  const response = await publicProofProxy(new Request("http://localhost:3000/api/public-proof/token", { method: "POST", headers: { origin: "http://localhost:3000", cookie: "session=secret", "x-forwarded-for": "evil" }, body: "{}" }), "token", "uploads");
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(upstream).toHaveBeenCalledWith("public/charges/token/proofs/uploads", { method: "POST", body: "{}" });
});
it("only permits a configured exact upload origin in CSP", () => {
  expect(proofUploadOrigin("https://private.s3.sa-east-1.amazonaws.com")).toBe("https://private.s3.sa-east-1.amazonaws.com");
  for (const value of [undefined, "*", "https:", "https://user:pass@evil.test", "https://good.test/path", "http://evil.test", "https://good.test; script-src *"]) expect(proofUploadOrigin(value)).toBeNull();
});
