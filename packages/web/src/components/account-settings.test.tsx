import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ACCOUNT_DELETED, ACCOUNT_DELETION_UNCONFIRMED } from "@receivy/common";
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
  expect(await screen.findByText(status === 200 ? ACCOUNT_DELETED : ACCOUNT_DELETION_UNCONFIRMED)).toBeInTheDocument();
  expect(requests).toEqual(["/api/financial/account"]);
});
it.each(["reject", "non-ok"])("keeps logout unconfirmed and retryable when DELETE is offline and logout is %s", async logoutFailure => {
  let logoutWorks = false;
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    if (init?.method === "DELETE") throw new Error("offline");
    if (path.endsWith("logout")) {
      if (logoutWorks) return new Response(null, { status: 204 });
      if (logoutFailure === "reject") throw new Error("offline");
      return new Response(null, { status: 503 });
    }
    return Response.json(path.endsWith("sessions") ? { sessions: [] } : { user });
  }));
  render(<AccountSettings />);
  fireEvent.change(await screen.findByLabelText("Digite EXCLUIR para confirmar"), { target: { value: "EXCLUIR" } });
  fireEvent.click(screen.getByRole("button", { name: "Excluir conta definitivamente" }));
  expect(await screen.findByText("Não foi possível confirmar a exclusão nem encerrar a sessão. Conecte-se e tente novamente.")).toBeInTheDocument();
  expect(screen.queryByText("Sessão encerrada; não foi possível confirmar a exclusão.")).not.toBeInTheDocument();
  const retry = screen.getByRole("button", { name: "Tentar encerrar a sessão novamente" });
  logoutWorks = true;
  fireEvent.click(retry);
  expect(await screen.findByText("Sessão encerrada; não foi possível confirmar a exclusão.")).toBeInTheDocument();
});

it("preserves confirmed deletion while retrying failed browser sign-out", async () => {
  let logoutWorks = false;
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    if (init?.method === "DELETE") return Response.json({ deleted: true });
    if (path.endsWith("logout")) return new Response(null, { status: logoutWorks ? 204 : 503 });
    return Response.json(path.endsWith("sessions") ? { sessions: [] } : { user });
  }));
  render(<AccountSettings />);
  fireEvent.change(await screen.findByLabelText("Digite EXCLUIR para confirmar"), { target: { value: "EXCLUIR" } });
  fireEvent.click(screen.getByRole("button", { name: "Excluir conta definitivamente" }));
  expect(await screen.findByText(ACCOUNT_DELETED + " Não foi possível encerrar a sessão deste navegador. Tente novamente.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Excluir conta definitivamente" })).not.toBeInTheDocument();
  logoutWorks = true;
  fireEvent.click(screen.getByRole("button", { name: "Tentar encerrar a sessão novamente" }));
  expect(await screen.findByText(ACCOUNT_DELETED)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Tentar encerrar a sessão novamente" })).not.toBeInTheDocument();
});

it("keeps current-session revocation distinct from failed browser sign-out", async () => {
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    if (path.endsWith("logout")) return new Response(null, { status: 503 });
    return Response.json(path.endsWith("sessions") ? { sessions: [{ id: "current", deviceName: "Navegador", current: true, lastSeenAt: "2026-09-07T12:00:00Z" }] } : { user });
  }));
  render(<AccountSettings />);
  fireEvent.click(await screen.findByRole("button", { name: "Encerrar Navegador" }));
  expect(await screen.findByText("Sessão revogada, mas não foi possível encerrar a sessão deste navegador. Tente novamente.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Tentar encerrar a sessão novamente" })).toBeInTheDocument();
  expect(screen.queryByText("Sessão encerrada.")).not.toBeInTheDocument();
});

it("preserves name-only onboarding with device timezone and fixed launch values", async () => {
  const onComplete = vi.fn();
  const requests: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_path: string, init?: RequestInit) => {
    if (init?.method === "PATCH") requests.push(JSON.parse(init.body as string));
    return Response.json({ user: { ...user, name: null } });
  }));
  render(<AccountSettings onboarding onComplete={onComplete} />);
  const name = await screen.findByRole("textbox", { name: "Nome" });
  expect(screen.getAllByRole("textbox")).toHaveLength(1);
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  fireEvent.change(name, { target: { value: "Ana" } });
  fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
  expect(await screen.findByText("Perfil salvo.")).toBeInTheDocument();
  expect(requests).toEqual([{ name: "Ana", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, locale: "pt-BR", country: "BR" }]);
  expect(onComplete).toHaveBeenCalledOnce();
});
