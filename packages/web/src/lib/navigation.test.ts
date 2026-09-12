import { describe, expect, it } from "vitest";
import { backLabelFor } from "./navigation";

describe("backLabelFor", () => {
  it("names every destination a back link can return to", () => {
    expect(backLabelFor("/")).toBe("Feed");
    expect(backLabelFor("/billings")).toBe("Contas");
    expect(backLabelFor("/billings/new")).toBe("Nova conta");
    expect(backLabelFor("/contacts")).toBe("Contatos");
    expect(backLabelFor("/settings")).toBe("Perfil");
    expect(backLabelFor("/settings/pix")).toBe("Chaves Pix");
    expect(backLabelFor("/billings/b1")).toBe("Conta");
    expect(backLabelFor("/contacts/p1")).toBe("Contato");
  });

  it("ignores the query string, the hash and a trailing slash", () => {
    expect(backLabelFor("/billings/new?returnTo=%2Fcontacts")).toBe("Nova conta");
    expect(backLabelFor("/settings#pix")).toBe("Perfil");
    expect(backLabelFor("/billings/")).toBe("Contas");
    expect(backLabelFor("/charges/abc")).toBe("Cobrança");
  });

  it("falls back to a neutral label for an unknown path", () => {
    expect(backLabelFor("/unknown/abc")).toBe("Voltar");
    expect(backLabelFor("")).toBe("Voltar");
  });
});
