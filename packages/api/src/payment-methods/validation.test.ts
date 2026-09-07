import { describe, expect, it } from "vitest";
import { normalizePixKey } from "./validation";

describe("Pix key validation", () => {
  it.each([
    ["cpf", "529.982.247-25", "52998224725"],
    ["cnpj", "04.252.011/0001-10", "04252011000110"],
    ["email", "  PAGADOR@Example.COM ", "pagador@example.com"],
    ["phone", "+55 (11) 99876-5432", "+5511998765432"],
    ["random", "123E4567-E89B-12D3-A456-426614174000", "123e4567-e89b-12d3-a456-426614174000"],
  ] as const)("normalizes a valid %s key", (type, value, expected) => {
    expect(normalizePixKey(type, value)).toBe(expected);
  });

  it.each([
    ["cpf", "529.982.247-24"],
    ["cnpj", "04.252.011/0001-11"],
    ["email", "not-an-email"],
    ["phone", "5511"],
    ["random", "not-a-uuid"],
  ] as const)("rejects an invalid %s key", (type, value) => {
    expect(() => normalizePixKey(type, value)).toThrow("Chave Pix inválida.");
  });
});
