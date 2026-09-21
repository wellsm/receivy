import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { OptOutPanel } from "./opt-out-panel";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("confirms the opt-out and lets the person opt back in", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ optedOut: false }), { status: 200 }));

  render(<OptOutPanel token="abc.def" optedOut />);

  expect(screen.getByText("Você não recebe mais e-mails de cobrança. Quem te cobra ainda pode te mandar o link direto.")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Voltar a receber" }));

  expect(fetchSpy).toHaveBeenCalledWith("/api/public/opt-out/abc.def", expect.objectContaining({ method: "DELETE" }));
  expect(await screen.findByText("Você voltou a receber e-mails de cobrança.")).toBeTruthy();
});
