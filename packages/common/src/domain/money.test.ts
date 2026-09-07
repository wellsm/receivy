import { describe, expect, it } from "vitest";
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
});
