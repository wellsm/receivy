import { describe, expect, it } from "vitest";
import { backLabelFor } from "./navigation";

describe("backLabelFor", () => {
  it("names every destination a back link can return to", () => {
    expect(backLabelFor("/")).toBe("Feed");
    expect(backLabelFor("/billings")).toBe("Cobranças");
    expect(backLabelFor("/charges/new")).toBe("Nova cobrança");
    expect(backLabelFor("/people")).toBe("Contatos");
    expect(backLabelFor("/settings")).toBe("Perfil");
    expect(backLabelFor("/settings/pix")).toBe("Chaves Pix");
  });

  it("ignores the query string, the hash and a trailing slash", () => {
    expect(backLabelFor("/charges/new?returnTo=%2Fpeople")).toBe("Nova cobrança");
    expect(backLabelFor("/settings#pix")).toBe("Perfil");
    expect(backLabelFor("/billings/")).toBe("Cobranças");
  });

  it("falls back to a neutral label for an unknown path", () => {
    expect(backLabelFor("/charges/abc")).toBe("Voltar");
    expect(backLabelFor("")).toBe("Voltar");
  });
});
