import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { BillingDetail } from "@receivy/common";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { BillingForm } from "./billing-form";

vi.mock("@/lib/auth/browser-fetch", () => ({ browserFetch: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

function api(onCreate: (body: unknown, init: RequestInit) => Response) {
  vi.mocked(browserFetch).mockImplementation(async (path, init) => {
    if (path.startsWith("/api/people")) return Response.json({ people: [{ id: "p1", name: "Ana" }], nextCursor: null });
    if (path.includes("payment-methods")) return Response.json({ paymentMethods: [] });
    if (path.includes("auth/me")) return Response.json({ user: { timezone: "America/Sao_Paulo" } });
    if (init?.method === "POST") return onCreate(JSON.parse(String(init.body)), init);
    throw new Error(`unexpected ${path}`);
  });
}

async function fill(type: "Uma vez" | "Até uma data" | "Sem fim") {
  const user = userEvent.setup();
  render(<BillingForm billing={null} onSaved={vi.fn()} onBack={vi.fn()} />);
  await user.click(await screen.findByRole("radio", { name: type }));
  await user.click(await screen.findByRole("checkbox", { name: "Ana" }));
  await user.type(screen.getByLabelText("Valor de cada cobrança"), "100,01");
  return user;
}

it("sends a once billing without calendar fields and shows exact cents in the review", async () => {
  const bodies: unknown[] = [];
  api(body => { bodies.push(body); return Response.json({ id: "b1", charges: [{ id: "c1" }] }, { status: 201 }); });
  const user = await fill("Uma vez");
  await user.click(screen.getByRole("button", { name: "Revisar cobrança" }));
  expect(screen.getByText(/50,01/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Criar cobrança" }));
  expect(bodies[0]).toMatchObject({ type: "once", totalCents: 10001, timezone: "America/Sao_Paulo" });
  expect(bodies[0]).not.toHaveProperty("frequency");
});

it("turns 'N vezes' into an end date for until billings", async () => {
  const bodies: unknown[] = [];
  api(body => { bodies.push(body); return Response.json({ id: "b1", charges: [] }, { status: 201 }); });
  const user = await fill("Até uma data");
  await user.clear(screen.getByLabelText("Primeiro vencimento"));
  await user.type(screen.getByLabelText("Primeiro vencimento"), "2026-01-31");
  await user.type(screen.getByLabelText("Quantas vezes"), "3");
  await user.click(screen.getByRole("button", { name: "Revisar cobrança" }));
  await user.click(screen.getByRole("button", { name: "Criar cobrança" }));
  expect(bodies[0]).toMatchObject({ type: "until", frequency: "monthly", startDate: "2026-01-31", endDate: "2026-03-31" });
});

it("freezes the payload and idempotency key across an uncertain retry", async () => {
  const posts: RequestInit[] = [];
  api((_body, init) => {
    posts.push(init);
    return posts.length === 1
      ? Response.json({ code: "INTERNAL_ERROR", message: "lost" }, { status: 503 })
      : Response.json({ id: "b1", charges: [{ id: "c1" }] }, { status: 201 });
  });
  const user = await fill("Sem fim");
  await user.click(screen.getByRole("button", { name: "Revisar cobrança" }));
  await user.click(screen.getByRole("button", { name: "Criar cobrança" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Serviço temporariamente indisponível. Tente novamente.");
  expect(screen.getByLabelText("Descrição")).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Tentar criar novamente" }));
  expect(posts[1]?.body).toBe(posts[0]?.body);
  expect(posts[1]?.headers).toEqual(posts[0]?.headers);
});

const onceBilling: BillingDetail = {
  id: "b1",
  type: "once",
  description: "Jantar",
  total: { amountCents: 9_000, currency: "BRL" },
  startDate: "2026-10-31",
  state: "active",
  nextDueDate: "2026-10-31",
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
  timezone: "America/Sao_Paulo",
  paymentMethodId: "pix-1",
  reminders: [{ offsetDays: -3, enabled: true }],
  split: { mode: "equal", parts: [{ kind: "person", personId: "p1" }] },
  allocations: [],
  charges: [],
  previews: [],
  nextMaterialization: null,
};

it("edits a once billing by sending only reminders and Pix, never the frozen fields", async () => {
  const patches: unknown[] = [];
  vi.mocked(browserFetch).mockImplementation(async (path, init) => {
    if (path.startsWith("/api/people")) return Response.json({ people: [{ id: "p1", name: "Ana" }], nextCursor: null });
    if (path.includes("payment-methods")) return Response.json({ paymentMethods: [] });
    if (init?.method === "PATCH") {
      patches.push(JSON.parse(String(init.body)));
      return Response.json(onceBilling);
    }
    throw new Error(`unexpected ${path}`);
  });
  const user = userEvent.setup();
  render(<BillingForm billing={onceBilling} onSaved={vi.fn()} onBack={vi.fn()} />);
  await user.click(await screen.findByRole("button", { name: "Revisar cobrança" }));
  await user.click(screen.getByRole("button", { name: "Salvar cobrança" }));
  expect(patches).toEqual([{ paymentMethodId: "pix-1", clearPaymentMethod: false, reminders: [{ offsetDays: -3, enabled: true }] }]);
});
