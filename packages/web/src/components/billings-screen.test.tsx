import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { BillingsScreen } from "./billings-screen";

vi.mock("@/lib/auth/browser-fetch", () => ({ browserFetch: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

const summary = { id: "b1", type: "indefinite", description: "Internet", total: { amountCents: 10000, currency: "BRL" }, startDate: "2026-09-07", state: "active", nextDueDate: "2026-09-30", createdAt: "2026-09-01T00:00:00Z" };
const detail = { ...summary, updatedAt: summary.createdAt, timezone: "America/Sao_Paulo", reminders: [], split: { mode: "equal", parts: [{ kind: "owner" }] }, allocations: [], charges: [], previews: [{ billingId: "b1", description: "Internet", amount: { amountCents: 5000, currency: "BRL" }, occurrenceDate: "2026-09-30" }], nextMaterialization: "2026-09-30" };

it("lists one row per billing and ends only after confirmation", async () => {
  const patches: unknown[] = [];
  vi.mocked(browserFetch).mockImplementation(async (path, init) => {
    if (init?.method === "PATCH") { patches.push(JSON.parse(String(init.body))); return Response.json({ ...detail, state: "ended", previews: [] }); }
    if (path.endsWith("/billings/b1")) return Response.json(detail);
    return Response.json({ billings: [summary], nextCursor: null });
  });
  render(<BillingsScreen />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Abrir Internet" }));
  expect(await screen.findByText(/Ainda não são cobranças/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Encerrar" }));
  expect(patches).toHaveLength(0);
  await user.click(screen.getByRole("button", { name: "Confirmar encerramento" }));
  expect(patches).toEqual([{ state: "ended" }]);
  expect(await screen.findByText(/Encerrada/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
});
