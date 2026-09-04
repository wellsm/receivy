import { describe, expect, it } from "vitest";
import { hasTrustedOrigin } from "./origin";

describe("hasTrustedOrigin", () => {
  it("accepts the exact request origin", () => {
    const request = new Request("https://receivy.example/api/auth/email/code", {
      headers: { origin: "https://receivy.example" },
    });
    expect(hasTrustedOrigin(request)).toBe(true);
  });

  it("rejects missing, cross-origin and lookalike origins", () => {
    expect(hasTrustedOrigin(new Request("https://receivy.example/api/auth/logout"))).toBe(false);
    for (const origin of ["https://evil.example", "https://receivy.example.evil.test"]) {
      const request = new Request("https://receivy.example/api/auth/logout", {
        headers: { origin },
      });
      expect(hasTrustedOrigin(request)).toBe(false);
    }
  });
});
