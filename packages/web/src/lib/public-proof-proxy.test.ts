import { beforeEach, expect, it, vi } from "vitest";
import { publicProofProxy } from "./public-proof-proxy";
import { proofUploadOrigin } from "./proof-origin";
const upstream = vi.hoisted(() => vi.fn());
vi.mock("./auth/api", () => ({ authApiFetch: upstream }));
beforeEach(() => upstream.mockReset());
it("forbids public history/review/download escapes and cross-origin writes", async () => {
  for (const path of ["", "proofs", "proof/../../auth/me", "proof/download", "proof/review", "uploads"]) {
    expect((await publicProofProxy(new Request("http://localhost:3000/api/public-proof/token", { method: "POST", headers: { origin: "http://localhost:3000" } }), "token", path)).status).toBe(404);
  }
  expect((await publicProofProxy(new Request("http://localhost:3000/api/public-proof/token", { method: "PATCH", headers: { origin: "http://localhost:3000" } }), "token", "proof")).status).toBe(404);
  expect((await publicProofProxy(new Request("http://localhost:3000/api/public-proof/token", { method: "POST", headers: { origin: "https://evil.test" } }), "token", "proof")).status).toBe(403);
  expect(upstream).not.toHaveBeenCalled();
});
it("forwards only the payer's own proof slot, without browser cookies or spoofed IP", async () => {
  upstream.mockResolvedValue(Response.json({ uploadUrl: "https://upload.test/put" }));
  const response = await publicProofProxy(new Request("http://localhost:3000/api/public-proof/token", { method: "POST", headers: { origin: "http://localhost:3000", cookie: "session=secret", "x-forwarded-for": "evil" }, body: "{}" }), "token", "proof");
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(upstream).toHaveBeenCalledWith("public/charges/token/proof", { method: "POST", body: "{}" });
  upstream.mockResolvedValue(Response.json({ state: "uploading", reason: null, file: null }));
  expect((await publicProofProxy(new Request("http://localhost:3000/api/public-proof/token"), "token", "proof")).status).toBe(200);
  expect(upstream).toHaveBeenLastCalledWith("public/charges/token/proof", { method: "GET" });
});
it("forwards a payment declaration for the payer's own link", async () => {
  upstream.mockResolvedValue(Response.json({ state: "pending", kind: "declaration", reason: null, file: null }));
  const response = await publicProofProxy(new Request("http://localhost:3000/api/public-proof/token/proof/declaration", { method: "POST", headers: { origin: "http://localhost:3000" }, body: "" }), "token", "proof/declaration");
  expect(response.status).toBe(200);
  expect(upstream).toHaveBeenCalledWith("public/charges/token/proof/declaration", { method: "POST", body: "" });
  expect((await publicProofProxy(new Request("http://localhost:3000/api/public-proof/token", { method: "GET" }), "token", "proof/declaration")).status).toBe(404);
});
it("only permits a configured exact upload origin in CSP", () => {
  expect(proofUploadOrigin("https://private.s3.sa-east-1.amazonaws.com")).toBe("https://private.s3.sa-east-1.amazonaws.com");
  for (const value of [undefined, "*", "https:", "https://user:pass@evil.test", "https://good.test/path", "http://evil.test", "https://good.test; script-src *"]) expect(proofUploadOrigin(value)).toBeNull();
});
