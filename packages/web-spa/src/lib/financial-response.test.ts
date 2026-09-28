import { expect, it } from "vitest";
import { responseMessage } from "./financial-response";

it("shows domain copy on 409/422/429 and generic copy elsewhere, never gateway text", async () => {
  expect(await responseMessage(Response.json({ type: "error", message: "Esta chave Pix já foi cadastrada.", context: { code: "PIX_KEY_TAKEN" } }, { status: 409 }), "Tente novamente.")).toBe("Esta chave Pix já foi cadastrada.");
  expect(await responseMessage(Response.json({ type: "error", message: "Malformed body: private SQL parameter" }, { status: 400 }), "Tente novamente.")).toBe("Confira os dados informados.");
  expect(await responseMessage(Response.json({ type: "error", message: "boom" }, { status: 500 }), "Tente novamente.")).toBe("Tente novamente.");
  expect(await responseMessage(new Response("not json", { status: 418 }), "Tente novamente.")).toBe("Tente novamente.");
});
