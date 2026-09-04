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

  it("formats BRL from integer cents", () => {
    expect(formatMoney(makeMoney(123_456), "pt-BR")).toBe("R$ 1.234,56");
  });
});
