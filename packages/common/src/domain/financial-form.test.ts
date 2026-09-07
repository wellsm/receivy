import { describe, expect, it } from "vitest";
import { calendarDate, parseBRLCents } from "./financial-form";

describe("parseBRLCents", () => {
  it.each([
    ["1.234,56", 123_456],
    ["1234,5", 123_450],
    ["0,01", 1],
    [" 25 ", 2_500],
  ])("parses %s without floating-point arithmetic", (input, expected) => {
    expect(parseBRLCents(input)).toBe(expected);
  });

  it.each(["1.2,34", "12,345", "R$ 10,00", "10.00", "1,2,3", "-1,00", ""])(
    "rejects malformed BRL input %s rather than partially parsing it",
    input => {
      expect(() => parseBRLCents(input)).toThrow("Informe um valor em reais");
    },
  );

  it("rejects values outside the API safe-integer contract", () => {
    expect(() => parseBRLCents("90.071.992.547.409,92")).toThrow(
      "O valor ultrapassa o limite permitido.",
    );
  });
});

describe("calendarDate", () => {
  it("uses the requested civil timezone instead of UTC date truncation", () => {
    expect(calendarDate(new Date("2026-09-07T01:00:00Z"), "America/Sao_Paulo")).toBe("2026-09-06");
  });
});
