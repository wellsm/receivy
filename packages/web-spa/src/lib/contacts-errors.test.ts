import { ApiError, NetworkError } from "@/lib/api/errors";
import { CONTACT_CONFLICT_MESSAGE, contactErrorMessage } from "./contacts-errors";

describe("contactErrorMessage", () => {
  it("explains a 400", () => {
    expect(contactErrorMessage(new ApiError(400, "x"))).toBe("Confira o nome e o e-mail informados.");
  });

  it("explains a 404", () => {
    expect(contactErrorMessage(new ApiError(404, "x"))).toBe("Contato não encontrado.");
  });

  it("explains a 409", () => {
    expect(contactErrorMessage(new ApiError(409, "x"))).toBe(CONTACT_CONFLICT_MESSAGE);
  });

  it("falls back to the default for another status", () => {
    expect(contactErrorMessage(new ApiError(500, "x"))).toBe("Não foi possível acessar seus contatos.");
  });

  it("reports a network failure as unavailable", () => {
    expect(contactErrorMessage(new NetworkError())).toBe("Serviço indisponível. Tente novamente.");
  });

  it("falls back to the default for a value that is not an ApiError", () => {
    expect(contactErrorMessage(new TypeError("Failed to fetch"))).toBe("Não foi possível acessar seus contatos.");
  });
});
