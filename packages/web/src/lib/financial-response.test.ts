import { expect, it } from "vitest";
import { responseMessage } from "./financial-response";
it("translates stable error codes and never displays arbitrary backend text", async () => {
  expect(await responseMessage(Response.json({ code: "RATE_LIMITED", message: "private SQL parameter" }), "Tente novamente.")).toBe("Muitas tentativas. Aguarde alguns minutos e tente novamente.");
  expect(await responseMessage(Response.json({ code: "UNKNOWN", message: "private SQL parameter" }), "Tente novamente.")).toBe("Tente novamente.");
});
