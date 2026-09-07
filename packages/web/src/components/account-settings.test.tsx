import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AccountSettings } from "./account-settings";
const user = { id: "user", email: "fixture@example.com", name: "Ana", avatarUrl: null, locale: "pt-BR", timezone: "America/Sao_Paulo", country: "BR", currency: "BRL" };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it.each([200, 401])("requires destructive confirmation and never claims deletion on 401 (%s)", async status => {
  const requests: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    if (init?.method === "DELETE") { requests.push(path); return Response.json({ deleted: status === 200 }, { status }); }
    if (path.endsWith("logout")) return new Response(null, { status: 204 });
    return Response.json(path.endsWith("sessions") ? { sessions: [] } : { user });
  }));
  render(<AccountSettings />);
  const button = await screen.findByRole("button", { name: "Excluir conta definitivamente" });
  expect(button).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Digite EXCLUIR para confirmar"), { target: { value: "EXCLUIR" } });
  fireEvent.click(button);
  expect(await screen.findByText(status === 200 ? "Conta excluída. A remoção de arquivos será concluída em segundo plano." : "Sessão encerrada; não foi possível confirmar a exclusão.")).toBeInTheDocument();
  expect(requests).toEqual(["/api/financial/account"]);
});
