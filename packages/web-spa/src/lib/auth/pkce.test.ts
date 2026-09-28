import { describe, expect, it } from "vitest";
import { challengeFor, createPkcePair, popOauthVerifier, saveOauthVerifier } from "./pkce";

describe("createPkcePair", () => {
  it("generates a 43-char base64url verifier and its S256 challenge", async () => {
    const { verifier, challenge } = await createPkcePair();

    expect(verifier).toHaveLength(43);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).toBe(await challengeFor(verifier));
  });

  it("never repeats a verifier across calls", async () => {
    const first = await createPkcePair();
    const second = await createPkcePair();

    expect(first.verifier).not.toBe(second.verifier);
  });
});

describe("challengeFor", () => {
  it("matches the RFC 7636 appendix B test vector", async () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";

    await expect(challengeFor(verifier)).resolves.toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});

describe("oauth verifier storage", () => {
  it("pops the saved verifier once, then answers null", () => {
    saveOauthVerifier("verifier-1");

    expect(popOauthVerifier()).toBe("verifier-1");
    expect(popOauthVerifier()).toBeNull();
  });

  it("answers null when nothing was saved", () => {
    expect(popOauthVerifier()).toBeNull();
  });
});
