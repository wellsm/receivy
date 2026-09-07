import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatMoney, makeMoney } from "./money";

describe("money", () => {
  it("rejects fractional cents", () => {
    expect(() => makeMoney(10.5)).toThrow(
      "amountCents must be a non-negative integer",
    );
  });

  it("rejects negative amounts", () => {
    expect(() => makeMoney(-1)).toThrow(
      "amountCents must be a non-negative integer",
    );
  });

  it("rejects unsafe integer cents", () => {
    expect(() => makeMoney(Number.MAX_SAFE_INTEGER + 1)).toThrow(
      "amountCents must be a non-negative safe integer",
    );
  });

  it("formats BRL from integer cents", () => {
    expect(formatMoney(makeMoney(123_456), "pt-BR")).toBe("R$ 1.234,56");
  });

  it("preserves every cent at the safe-integer boundary", () => {
    expect(formatMoney(makeMoney(Number.MAX_SAFE_INTEGER), "pt-BR")).toBe(
      "R$ 90.071.992.547.409,91",
    );
  });

  it("formats signed ledger balances smaller than one real", () => {
    expect(formatMoney({ amountCents: -1, currency: "BRL" }, "pt-BR")).toBe(
      "-R$ 0,01",
    );
  });
  describe("without Intl.NumberFormat.prototype.formatToParts (Hermes)", () => {
    const prototype = Intl.NumberFormat.prototype as { formatToParts?: unknown };
    let original: unknown;
    beforeEach(() => { original = prototype.formatToParts; delete prototype.formatToParts; });
    afterEach(() => { prototype.formatToParts = original; });

    it.each([
      [123_456, "R$ 1.234,56"],
      [100_00, "R$ 100,00"],
      [7, "R$ 0,07"],
      [Number.MAX_SAFE_INTEGER, "R$ 90.071.992.547.409,91"],
      [-1, "-R$ 0,01"],
      [-123_456, "-R$ 1.234,56"],
    ])("matches the formatToParts output for %s cents", (amountCents, expected) => {
      expect(typeof prototype.formatToParts).toBe("undefined");
      expect(formatMoney({ amountCents, currency: "BRL" }, "pt-BR")).toBe(expected);
    });
  });
});
