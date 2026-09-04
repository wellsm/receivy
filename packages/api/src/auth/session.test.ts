import { describe, expect, it, vi } from "vitest";

import {
  generateRefreshToken,
  hashRefreshToken,
  issueAccessToken,
  verifyAccessToken,
} from "./session";

const secret = "test-only-jwt-secret-with-at-least-32-bytes";

describe("session token security", () => {
  it("issues a short-lived access token with minimal claims", () => {
    const token = issueAccessToken({
      familyId: "22222222-2222-4222-8222-222222222222",
      nowSeconds: 1_788_545_600,
      secret,
      userId: "11111111-1111-4111-8111-111111111111",
    });

    expect(
      verifyAccessToken({
        nowSeconds: 1_788_546_499,
        secret,
        token,
      }),
    ).toEqual({
      familyId: "22222222-2222-4222-8222-222222222222",
      userId: "11111111-1111-4111-8111-111111111111",
    });
    expect(() =>
      verifyAccessToken({ nowSeconds: 1_788_546_500, secret, token }),
    ).toThrow("Invalid session token");
  });

  it("rejects a token whose signed payload was changed", () => {
    const token = issueAccessToken({
      familyId: "22222222-2222-4222-8222-222222222222",
      nowSeconds: 1_788_545_600,
      secret,
      userId: "11111111-1111-4111-8111-111111111111",
    });
    const [header, payload, signature] = token.split(".");
    const tamperedPayload = Buffer.from(
      JSON.stringify({ sub: "attacker", exp: 9_999_999_999 }),
    ).toString("base64url");

    expect(() =>
      verifyAccessToken({
        nowSeconds: 1_788_545_601,
        secret,
        token: `${header}.${tamperedPayload}.${signature}`,
      }),
    ).toThrow("Invalid session token");
    expect(payload).toBeDefined();
  });

  it("generates an opaque refresh token and stores only its hash", () => {
    const randomBytes = vi.fn().mockReturnValue(Buffer.alloc(32, 7));
    const token = generateRefreshToken(randomBytes);

    expect(randomBytes).toHaveBeenCalledWith(32);
    expect(token).toHaveLength(43);
    expect(hashRefreshToken(token)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashRefreshToken(token)).not.toBe(token);
  });
});
