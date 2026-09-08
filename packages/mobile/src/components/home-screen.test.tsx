import { act, fireEvent, render, screen } from "@testing-library/react-native";

import { HomeScreen } from "./home-screen";

describe("HomeScreen", () => {
  const summary = { receivable: { amountCents: 0, currency: "BRL" as const }, payable: { amountCents: 0, currency: "BRL" as const }, overdue: { amountCents: 0, currency: "BRL" as const }, pending: { amountCents: 0, currency: "BRL" as const }, proofsToReview: 0 };
  const item = (id: string, description: string, state: "pending" | "paid" | "cancelled", installment = 1) => ({ kind: "charge" as const, direction: "payable" as const, charge: { id, description, amount: { amountCents: 100, currency: "BRL" as const }, dueDate: "2026-09-10", state, billingId: "b1", billingType: "until" as const, installment, installmentCount: 3 } });
  const deferred = () => { let resolve!: (page: { summary: typeof summary; items: ReturnType<typeof item>[]; nextCursor: string | null }) => void; const promise = new Promise<{ summary: typeof summary; items: ReturnType<typeof item>[]; nextCursor: string | null }>(done => { resolve = done; }); return { promise, resolve }; };
  it("shows live timeline totals and opens persisted charges", async () => {
    const client = { timeline: jest.fn().mockResolvedValue({ summary: { receivable: { amountCents: 12345, currency: "BRL" }, payable: { amountCents: 2500, currency: "BRL" }, overdue: { amountCents: 0, currency: "BRL" }, pending: { amountCents: 2500, currency: "BRL" }, proofsToReview: 0 }, items: [{ kind: "charge", direction: "payable", charge: { id: "charge", description: "Aluguel", amount: { amountCents: 2500, currency: "BRL" }, dueDate: "2026-09-10", state: "pending", billingId: "b1", billingType: "indefinite", installment: null, installmentCount: null } }], nextCursor: null }) };
    const openCharge = jest.fn();
    await render(<HomeScreen client={client} onOpenCharge={openCharge} />);

    expect(
      screen.getByText("O que entra. O que sai. No mesmo lugar."),
    ).toBeOnTheScreen();
    expect(await screen.findByText(/123,45/)).toBeOnTheScreen();
    expect(screen.getByText("Aluguel")).toBeOnTheScreen();
    expect(
      screen.getByRole("button", { name: "Nova cobrança" }),
    ).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: "Abrir cobrança Aluguel" }));
    expect(openCharge).toHaveBeenCalledWith("charge");
  });

  it("pages through mixed charge states and exposes date filters with installment markers", async () => {
    const timeline = jest.fn().mockResolvedValueOnce({ summary, items: [item("pending", "Internet", "pending", 1), item("paid", "Energia", "paid", 2)], nextCursor: "page-2" }).mockResolvedValueOnce({ summary, items: [item("cancelled", "Telefone", "cancelled", 3)], nextCursor: null }).mockResolvedValue({ summary, items: [], nextCursor: null });
    await render(<HomeScreen client={{ timeline }} />);
    expect(await screen.findByText("Pendente · parcela 1/3")).toBeOnTheScreen();
    expect(screen.getByText("Pago · parcela 2/3")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Carregar mais" }));
    expect(await screen.findByText("Cancelado · parcela 3/3")).toBeOnTheScreen();
    expect(timeline).toHaveBeenNthCalledWith(2, "cursor=page-2");
    await fireEvent.press(screen.getByRole("button", { name: "Hoje" }));
    expect(timeline.mock.calls.at(-1)?.[0]).toMatch(/^from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/);
    expect(screen.getByRole("button", { name: "Esta semana" })).toBeOnTheScreen();
  });

  it("keeps the latest filter when responses resolve in reverse order", async () => {
    const receivable = deferred(); const payable = deferred();
    const timeline = jest.fn().mockResolvedValueOnce({ summary, items: [], nextCursor: null }).mockImplementation((query: string) => query === "direction=receivable" ? receivable.promise : payable.promise);
    await render(<HomeScreen client={{ timeline }} />);
    await screen.findByText("Sua timeline começa aqui");
    await fireEvent.press(screen.getByRole("button", { name: "A receber" }));
    await fireEvent.press(screen.getByRole("button", { name: "A pagar" }));
    await act(async () => { payable.resolve({ summary, items: [item("new", "Resposta nova", "pending")], nextCursor: null }); await Promise.resolve(); });
    expect(await screen.findByText("Resposta nova")).toBeOnTheScreen();
    await act(async () => { receivable.resolve({ summary, items: [item("old", "Resposta antiga", "pending")], nextCursor: null }); await Promise.resolve(); });
    expect(screen.queryByText("Resposta antiga")).toBeNull();
  });

  it("does not append an old page after the filter generation changes", async () => {
    const oldPage = deferred(); const filtered = deferred();
    const timeline = jest.fn().mockResolvedValueOnce({ summary, items: [item("base", "Página inicial", "pending")], nextCursor: "old-cursor" }).mockImplementation((query: string) => query === "cursor=old-cursor" ? oldPage.promise : filtered.promise);
    await render(<HomeScreen client={{ timeline }} />);
    await screen.findByText("Página inicial");
    await fireEvent.press(screen.getByRole("button", { name: "Carregar mais" }));
    await fireEvent.press(screen.getByRole("button", { name: "A pagar" }));
    await act(async () => { filtered.resolve({ summary, items: [item("filtered", "Filtro atual", "pending")], nextCursor: null }); await Promise.resolve(); });
    expect(await screen.findByText("Filtro atual")).toBeOnTheScreen();
    await act(async () => { oldPage.resolve({ summary, items: [item("stale", "Página obsoleta", "pending")], nextCursor: null }); await Promise.resolve(); });
    expect(screen.queryByText("Página obsoleta")).toBeNull();
  });

  it("invalidates the old cursor when a filter switch fails", async () => {
    const timeline = jest.fn().mockResolvedValueOnce({ summary, items: [item("a", "Item do filtro A", "pending")], nextCursor: "cursor-a" }).mockRejectedValueOnce(new Error("Filtro indisponível.")).mockResolvedValueOnce({ summary, items: [item("mixed", "Item misturado", "pending")], nextCursor: null });
    await render(<HomeScreen client={{ timeline }} />);
    await screen.findByText("Item do filtro A");
    await fireEvent.press(screen.getByRole("button", { name: "A pagar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Filtro indisponível.");
    expect(screen.queryByRole("button", { name: "Carregar mais" })).toBeNull();
    expect(screen.queryByText("Item do filtro A")).toBeNull();
    expect(screen.queryByText("Item misturado")).toBeNull();
    expect(screen.queryByText("Sua timeline começa aqui")).toBeNull();
    expect(screen.getAllByText("—")).toHaveLength(2);
    expect(timeline).toHaveBeenCalledTimes(2);
  });
});
