import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "./proxy";

describe("public charge proxy headers", () => {
  it("allows signed-link pages without a session and supplies a strict nonce CSP", () => {
    const response = proxy(new NextRequest("https://receivy.example/pay/capability"));
    expect(response.status).toBe(200);
    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("script-src 'nonce-");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });
});
