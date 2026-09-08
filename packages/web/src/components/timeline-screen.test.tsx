import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { TimelineScreen } from "./timeline-screen";

vi.mock("@/lib/auth/browser-fetch", () => ({ browserFetch: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("TimelineScreen", () => {
  const summary = { receivable: { amountCents: 0, currency: "BRL" }, payable: { amountCents: 0, currency: "BRL" }, overdue: { amountCents: 0, currency: "BRL" }, pending: { amountCents: 0, currency: "BRL" }, proofsToReview: 0 } as const;
  const charge = (id: string, description: string) => ({ kind: "charge" as const, direction: "payable" as const, charge: { id, description, amount: { amountCents: 100, currency: "BRL" as const }, dueDate: "2026-09-10", state: "pending" as const, billingId: "b1", billingType: "once" as const, installment: null, installmentCount: null } });
  const deferred = () => { let resolve!: (response: Response) => void; const promise = new Promise<Response>(done => { resolve = done; }); return { promise, resolve }; };
  it("renders persisted totals and explicit charge directions", async () => {
    vi.mocked(browserFetch).mockResolvedValue(Response.json({
      summary: {
        receivable: { amountCents: Number.MAX_SAFE_INTEGER, currency: "BRL" },
        payable: { amountCents: 2500, currency: "BRL" },
        overdue: { amountCents: 0, currency: "BRL" },
        pending: { amountCents: 2500, currency: "BRL" }, proofsToReview: 0,
      },
      items: [{ kind: "charge", direction: "payable", charge: {
        id: "charge-1", description: "Aluguel", amount: { amountCents: 2500, currency: "BRL" },
        dueDate: "2026-09-10", state: "pending", billingId: "b1", billingType: "indefinite", installment: 1, installmentCount: 1,
      }}], nextCursor: null,
    }));
    render(<TimelineScreen />);
    expect(await screen.findByText((_, element) => element?.textContent === "R$ 90.071.992.547.409,91")).toBeInTheDocument();
    expect(screen.getAllByText("A pagar").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /Abrir cobrança Aluguel/ })).toHaveAttribute("href", "/charges/charge-1");
  });

  it("maps the API error code to client copy and never displays backend text", async () => {
    vi.mocked(browserFetch).mockResolvedValue(Response.json({ code: "INVALID_REQUEST", message: "O total financeiro deve estar entre limites seguros." }, { status: 422 }));
    render(<TimelineScreen />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Confira os dados informados.");
    expect(alert).not.toHaveTextContent("O total financeiro");
  });

  it("keeps the newest filter when overlapping requests resolve in reverse order", async () => {
    const receivable = deferred(); const payable = deferred();
    vi.mocked(browserFetch).mockImplementation(async path => {
      if (path === "/api/financial/timeline") return Response.json({ summary, items: [], nextCursor: null });
      if (path === "/api/financial/timeline?direction=receivable") return receivable.promise;
      return payable.promise;
    });
    render(<TimelineScreen />); const user = userEvent.setup();
    await screen.findByText("Sua timeline começa aqui");
    await user.click(screen.getByRole("button", { name: "A receber" }));
    await user.click(screen.getByRole("button", { name: "A pagar" }));
    payable.resolve(Response.json({ summary, items: [charge("new", "Resposta nova")], nextCursor: null }));
    expect(await screen.findByText("Resposta nova")).toBeInTheDocument();
    await act(async () => { receivable.resolve(Response.json({ summary, items: [charge("old", "Resposta antiga")], nextCursor: null })); await Promise.resolve(); });
    expect(screen.queryByText("Resposta antiga")).not.toBeInTheDocument();
  });

  it("does not append pagination from an obsolete filter generation", async () => {
    const oldPage = deferred(); const newFilter = deferred();
    vi.mocked(browserFetch).mockImplementation(async path => {
      if (path === "/api/financial/timeline") return Response.json({ summary, items: [charge("base", "Página inicial")], nextCursor: "old-cursor" });
      if (path === "/api/financial/timeline?cursor=old-cursor") return oldPage.promise;
      return newFilter.promise;
    });
    render(<TimelineScreen />); const user = userEvent.setup();
    await screen.findByText("Página inicial");
    await user.click(screen.getByRole("button", { name: "Carregar mais" }));
    await user.click(screen.getByRole("button", { name: "A pagar" }));
    newFilter.resolve(Response.json({ summary, items: [charge("filtered", "Filtro atual")], nextCursor: null }));
    expect(await screen.findByText("Filtro atual")).toBeInTheDocument();
    await act(async () => { oldPage.resolve(Response.json({ summary, items: [charge("stale-page", "Página obsoleta")], nextCursor: null })); await Promise.resolve(); });
    expect(screen.queryByText("Página obsoleta")).not.toBeInTheDocument();
  });

  it("invalidates the old cursor when switching filters fails", async () => {
    vi.mocked(browserFetch).mockImplementation(async path => {
      if (path === "/api/financial/timeline") return Response.json({ summary, items: [charge("a", "Item do filtro A")], nextCursor: "cursor-a" });
      if (path === "/api/financial/timeline?direction=payable") return Response.json({ code: "INTERNAL_ERROR", message: "Filtro indisponível." }, { status: 503 });
      return Response.json({ summary, items: [charge("mixed", "Item misturado")], nextCursor: null });
    });
    render(<TimelineScreen />); const user = userEvent.setup();
    await screen.findByText("Item do filtro A");
    await user.click(screen.getByRole("button", { name: "A pagar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Serviço temporariamente indisponível. Tente novamente.");
    expect(screen.queryByRole("button", { name: "Carregar mais" })).not.toBeInTheDocument();
    expect(screen.queryByText("Item do filtro A")).not.toBeInTheDocument();
    expect(screen.queryByText("Item misturado")).not.toBeInTheDocument();
    expect(screen.queryByText("Sua timeline começa aqui")).not.toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(2);
    expect(browserFetch).toHaveBeenCalledTimes(2);
  });
});
