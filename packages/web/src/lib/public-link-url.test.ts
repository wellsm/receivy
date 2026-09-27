import { describe, expect, it } from "vitest";
import { publicLinkUrl } from "./public-link-url";

describe("publicLinkUrl", () => {
  it("shares the short /p link when the link has a code", () => {
    expect(publicLinkUrl("https://receivy.app", { token: "pid.1.sig", shortCode: "K7m2xQ9aB" })).toBe("https://receivy.app/p/K7m2xQ9aB");
  });

  it("falls back to the signed /pay link without one", () => {
    expect(publicLinkUrl("https://receivy.app", { token: "pid.1.sig" })).toBe("https://receivy.app/pay/pid.1.sig");
  });
});
