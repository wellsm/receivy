import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { RecurrencesScreen } from "./recurrences-screen";
vi.mock("@/lib/auth/browser-fetch", () => ({ browserFetch: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it("creates an exact recurring split and freezes retry payload after a lost response", async () => {
  const posts: RequestInit[] = [];
  vi.mocked(browserFetch).mockImplementation(async (path, init = {}) => {
    if (path.startsWith("/api/people")) return Response.json({ people: [{ id: "p1", name: "Ana" }], nextCursor: null });
    if (path.includes("payment-methods")) return Response.json({ paymentMethods: [] });
    if (path.includes("auth/me")) return Response.json({ user: { timezone: "America/Sao_Paulo" } });
    if (init.method === "POST") { posts.push(init); return posts.length === 1 ? Response.json({ message: "Resposta perdida" }, { status: 503 }) : Response.json({ id: "r1", ...JSON.parse(String(init.body)), state: "active", previews: [], nextMaterialization: "2026-10-28" }); }
    return Response.json({ recurrences: [] });
  });
  render(<RecurrencesScreen />); const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Nova recorrência" }));
  await user.click(await screen.findByRole("checkbox", { name: "Ana" }));
  await user.type(screen.getByLabelText("Valor total"), "100,01");
  await user.type(screen.getByLabelText("Descrição"), "Internet");
  await user.click(screen.getByRole("button", { name: "Revisar recorrência" }));
  expect(screen.getByText(/50,01/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Salvar recorrência" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Resposta perdida");
  expect(screen.getByLabelText("Descrição")).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Tentar salvar novamente" }));
  expect(posts[1]?.body).toBe(posts[0]?.body); expect(posts[1]?.headers).toEqual(posts[0]?.headers);
  expect(JSON.parse(String(posts[0]?.body))).toMatchObject({ totalCents: 10001, frequency: "monthly", timezone: "America/Sao_Paulo" });
  expect(await screen.findByText("Simulação de 90 dias")).toBeInTheDocument();
});
it("requires confirmation to end and never offers payment on a virtual preview", async () => {
  const rule = { id: "r1", description: "Internet", totalCents: 10000, frequency: "monthly", day: 31, startDate: "2026-09-07", timezone: "America/Sao_Paulo", state: "active", split: { mode: "equal", parts: [{ kind: "owner" }] }, reminders: [], previews: [{ recurrenceId: "r1", description: "Internet", amount: { amountCents: 5000, currency: "BRL" }, occurrenceDate: "2026-09-30" }], nextMaterialization: "2026-09-30" };
  vi.mocked(browserFetch).mockImplementation(async (_path, init) => init?.method === "POST" ? Response.json({ ...rule, state: "ended", previews: [] }) : Response.json({ recurrences: [rule] }));
  render(<RecurrencesScreen />); const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Abrir Internet" }));
  expect(screen.getByText(/Ainda não é cobrança/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /pagar|comprovante/i })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Encerrar" }));
  await user.click(screen.getByRole("button", { name: "Confirmar encerramento" }));
  expect(await screen.findByText(/Encerrada/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
});
it("retains an editable draft after a definitive rejection and round-trips annual percentage settings", async () => {
  const rule = { id: "r1", description: "Anuidade", totalCents: 10001, frequency: "yearly", month: 2, day: 29, startDate: "2026-01-01", timezone: "America/Sao_Paulo", state: "paused", split: { mode: "percentage", parts: [{ kind: "person", personId: "p1", basisPoints: 3333 }, { kind: "owner", basisPoints: 6667 }] }, reminders: [{ offsetDays: -5, enabled: true, channel: "auto" }], previews: [], nextMaterialization: null };
  let saved: unknown;
  vi.mocked(browserFetch).mockImplementation(async (path, init) => {
    if (path.startsWith("/api/people")) return Response.json({ people: [{ id: "p1", name: "Ana" }], nextCursor: null });
    if (path.includes("payment-methods")) return Response.json({ paymentMethods: [] });
    if (init?.method === "PATCH") { saved = JSON.parse(String(init.body)); return Response.json({ message: "Contato indisponível" }, { status: 404 }); }
    return Response.json({ recurrences: [rule] });
  });
  render(<RecurrencesScreen />); const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Abrir Anuidade" }));
  await user.click(screen.getByRole("button", { name: "Editar" }));
  await user.click(await screen.findByRole("checkbox", { name: "Ana" }));
  await user.click(screen.getByRole("checkbox", { name: "Ana" }));
  await user.click(screen.getByRole("button", { name: "Revisar recorrência" }));
  await user.click(screen.getByRole("button", { name: "Salvar recorrência" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Contato indisponível");
  expect(screen.getByLabelText("Descrição")).toBeEnabled();
  expect(saved).toMatchObject({ totalCents: 10001, frequency: "yearly", month: 2, day: 29, startDate: "2026-01-01", split: rule.split, reminders: rule.reminders });
});
