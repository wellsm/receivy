import { describe, expect, it, vi } from "vitest";

import {
  canAttemptEmailCode,
  createEmailCodeHash,
  generateEmailCode,
  verifyEmailCodeHash,
} from "./code";

const secret = "test-only-secret-with-at-least-32-bytes";

describe("email login code security", () => {
  it("generates exactly six digits from a cryptographic integer source", () => {
    const randomInt = vi.fn().mockReturnValue(42);

    expect(generateEmailCode(randomInt)).toBe("000042");
    expect(randomInt).toHaveBeenCalledWith(0, 1_000_000);
  });

  it("binds the HMAC to the normalized email and compares it safely", () => {
    const codeHash = createEmailCodeHash({
      code: "123456",
      normalizedEmail: "ana@example.com",
      secret,
    });

    expect(
      verifyEmailCodeHash({
        code: "123456",
        codeHash,
        normalizedEmail: "ana@example.com",
        secret,
      }),
    ).toBe(true);
    expect(
      verifyEmailCodeHash({
        code: "123456",
        codeHash,
        normalizedEmail: "bia@example.com",
        secret,
      }),
    ).toBe(false);
    expect(
      verifyEmailCodeHash({
        code: "654321",
        codeHash,
        normalizedEmail: "ana@example.com",
        secret,
      }),
    ).toBe(false);
  });

  it("rejects consumed, expired, or exhausted records", () => {
    const now = new Date("2026-09-04T18:00:00.000Z");
    const active = {
      attempts: 4,
      consumedAt: null,
      expiresAt: new Date("2026-09-04T18:01:00.000Z"),
    };

    expect(canAttemptEmailCode(active, now)).toBe(true);
    expect(canAttemptEmailCode({ ...active, attempts: 5 }, now)).toBe(false);
    expect(
      canAttemptEmailCode(
        { ...active, expiresAt: new Date("2026-09-04T18:00:00.000Z") },
        now,
      ),
    ).toBe(false);
    expect(
      canAttemptEmailCode(
        { ...active, consumedAt: new Date("2026-09-04T17:59:00.000Z") },
        now,
      ),
    ).toBe(false);
  });
});
