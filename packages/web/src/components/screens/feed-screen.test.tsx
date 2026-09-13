import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { FeedScreen } from "@/components/screens/feed-screen";

/** The feed opens on the default filters: every status but cancelled. */
const BASE = "/api/financial/timeline?status=pending%2Coverdue%2Cpaid";

async function pick(user: ReturnType<typeof userEvent.setup>, group: string, option: string) {
  await user.click(screen.getByRole("combobox", { name: group }));
  await user.click(screen.getByRole("option", { name: option }));
  await user.keyboard("{Escape}");
}

vi.mock("@/lib/auth/browser-fetch", () => ({ browserFetch: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const summary = {
  receivable: { amountCents: 0, currency: "BRL" },
  payable: { amountCents: 0, currency: "BRL" },
  overdue: { amountCents: 0, currency: "BRL" },
  pending: { amountCents: 0, currency: "BRL" },
  proofsToReview: 0,
  receivableCount: 0,
  payableCount: 0,
} as const;

type ChargeOverrides = {
  id?: string;
  description?: string;
  amount?: { amountCents: number; currency: "BRL" };
  dueDate?: string;
  state?: "pending" | "paid" | "cancelled";
  proofState?: "pending" | "accepted" | "rejected" | null;
  counterpartReachable?: boolean;
};

function charge(overrides: ChargeOverrides = {}, direction: "receivable" | "payable" = "payable") {
  return {
    kind: "charge" as const,
    direction,
    charge: {
      id: "c1",
      description: "Mercado",
      amount: { amountCents: 100, currency: "BRL" as const },
      dueDate: "2026-09-10",
      state: "pending" as const,
      billingId: "b1",
      billingType: "once" as const,
      installment: null,
      installmentCount: null,
      counterpartName: "Maria",
      proofState: null,
      ...overrides,
    },
  };
}

const deferred = () => {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe("FeedScreen", () => {
  it("renders persisted totals and pending counts", async () => {
    vi.mocked(browserFetch).mockResolvedValue(
      Response.json({
        summary: {
          receivable: { amountCents: Number.MAX_SAFE_INTEGER, currency: "BRL" },
          payable: { amountCents: 2500, currency: "BRL" },
          overdue: { amountCents: 0, currency: "BRL" },
          pending: { amountCents: 2500, currency: "BRL" },
          proofsToReview: 0,
          receivableCount: 3,
          payableCount: 1,
        },
        items: [],
        nextCursor: null,
      }),
    );
    render(<FeedScreen />);
    expect(await screen.findByText("R$ 90.071.992.547.409,91")).toBeInTheDocument();
    expect(screen.getByText("R$ 25,00")).toBeInTheDocument();
    expect(screen.getByText("3 pendências")).toBeInTheDocument();
    expect(screen.getByText("1 pendência")).toBeInTheDocument();
  });

  it("shows the domain copy of a 422 and never gateway text", async () => {
    vi.mocked(browserFetch).mockResolvedValue(
      Response.json({ type: "error", message: "O total financeiro deve estar entre limites seguros.", context: { code: "TIMELINE_OVERFLOW" } }, { status: 422 }),
    );
    render(<FeedScreen />);
    expect(await screen.findByRole("alert")).toHaveTextContent("O total financeiro deve estar entre limites seguros.");
  });

  it("keeps the newest filter when overlapping requests resolve in reverse order", async () => {
    const receivable = deferred();
    const payable = deferred();
    vi.mocked(browserFetch).mockImplementation(async (path) => {
      if (path === BASE) return Response.json({ summary, items: [], nextCursor: null });
      if (path === "/api/financial/timeline?direction=receivable&status=pending%2Coverdue%2Cpaid") return receivable.promise;
      return payable.promise;
    });
    render(<FeedScreen />);
    const user = userEvent.setup();
    await screen.findByText("Sua timeline começa aqui");
    await pick(user, "Direção", "A receber");
    await pick(user, "Direção", "A pagar");
    payable.resolve(Response.json({ summary, items: [charge({ id: "new", description: "Resposta nova" })], nextCursor: null }));
    expect(await screen.findByText(/Resposta nova/)).toBeInTheDocument();
    await act(async () => {
      receivable.resolve(Response.json({ summary, items: [charge({ id: "old", description: "Resposta antiga" })], nextCursor: null }));
      await Promise.resolve();
    });
    expect(screen.queryByText(/Resposta antiga/)).not.toBeInTheDocument();
  });

  it("does not append pagination from an obsolete filter generation", async () => {
    const oldPage = deferred();
    const newFilter = deferred();
    vi.mocked(browserFetch).mockImplementation(async (path) => {
      if (path === BASE)
        return Response.json({ summary, items: [charge({ id: "base", description: "Página inicial" })], nextCursor: "old-cursor" });
      if (path === `${BASE}&cursor=old-cursor`) return oldPage.promise;
      return newFilter.promise;
    });
    render(<FeedScreen />);
    const user = userEvent.setup();
    await screen.findByText(/Página inicial/);
    await user.click(screen.getByRole("button", { name: "Carregar mais" }));
    await pick(user, "Direção", "A pagar");
    newFilter.resolve(Response.json({ summary, items: [charge({ id: "filtered", description: "Filtro atual" })], nextCursor: null }));
    expect(await screen.findByText(/Filtro atual/)).toBeInTheDocument();
    await act(async () => {
      oldPage.resolve(Response.json({ summary, items: [charge({ id: "stale-page", description: "Página obsoleta" })], nextCursor: null }));
      await Promise.resolve();
    });
    expect(screen.queryByText(/Página obsoleta/)).not.toBeInTheDocument();
  });

  it("invalidates the old cursor when switching filters fails", async () => {
    vi.mocked(browserFetch).mockImplementation(async (path) => {
      if (path === BASE)
        return Response.json({ summary, items: [charge({ id: "a", description: "Item do filtro A" })], nextCursor: "cursor-a" });
      if (path === "/api/financial/timeline?direction=payable&status=pending%2Coverdue%2Cpaid")
        return Response.json({ type: "error", message: "Internal server error" }, { status: 503 });
      return Response.json({ summary, items: [charge({ id: "mixed", description: "Item misturado" })], nextCursor: null });
    });
    render(<FeedScreen />);
    const user = userEvent.setup();
    await screen.findByText(/Item do filtro A/);
    await pick(user, "Direção", "A pagar");
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível carregar seu feed.");
    expect(screen.queryByRole("button", { name: "Carregar mais" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Item do filtro A/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Item misturado/)).not.toBeInTheDocument();
    expect(screen.queryByText("Sua timeline começa aqui")).not.toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(2);
    expect(browserFetch).toHaveBeenCalledTimes(2);
  });

  it("groups items by due date with a heading per day and shows status badges", async () => {
    vi.mocked(browserFetch).mockResolvedValue(
      Response.json({
        summary,
        items: [
          charge({ id: "overdue", description: "Aluguel", dueDate: "2000-01-01" }),
          charge({ id: "proof", description: "Internet", dueDate: "2099-06-20", proofState: "pending" }, "receivable"),
        ],
        nextCursor: null,
      }),
    );
    render(<FeedScreen />);
    expect(await screen.findByText("1 de janeiro de 2000")).toBeInTheDocument();
    expect(screen.getByText("20 de junho de 2099")).toBeInTheDocument();
    expect(screen.getByText("Atrasado")).toBeInTheDocument();
    expect(screen.getByText("Comprovante enviado")).toBeInTheDocument();
  });

  it("sends a reminder and shows the confirmation inline", async () => {
    vi.mocked(browserFetch).mockImplementation(async (path, init) => {
      if (path === BASE) {
        return Response.json({
          summary,
          items: [charge({ id: "charge-1", description: "Aluguel" }, "receivable")],
          nextCursor: null,
        });
      }
      if (path === "/api/financial/charges/charge-1/reminders" && (init as RequestInit | undefined)?.method === "POST") {
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected ${String(path)}`);
    });
    render(<FeedScreen />);
    const user = userEvent.setup();
    const remindButton = await screen.findByRole("button", { name: "Lembrar" });
    await user.click(remindButton);
    const dialog = await screen.findByRole("dialog", { name: "Enviar lembrete?" });
    expect(dialog).toHaveTextContent("Avisa Maria por notificação no app ou por e-mail");
    expect(browserFetch).not.toHaveBeenCalledWith("/api/financial/charges/charge-1/reminders", expect.anything());
    await user.click(within(dialog).getByRole("button", { name: "Enviar lembrete" }));
    expect(await screen.findByText("Lembrete enviado")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("offers Ver cobrança instead of Lembrar when the debtor cannot be reached", async () => {
    vi.mocked(browserFetch).mockResolvedValue(
      Response.json({
        summary,
        items: [charge({ id: "charge-2", description: "Aluguel", counterpartReachable: false }, "receivable")],
        nextCursor: null,
      }),
    );
    render(<FeedScreen />);
    const link = await screen.findByRole("link", { name: "Ver cobrança" });
    expect(link).toHaveAttribute("href", "/charges/charge-2");
    expect(screen.queryByRole("button", { name: "Lembrar" })).not.toBeInTheDocument();
  });

  it("links a payable charge with no proof to Pagar", async () => {
    vi.mocked(browserFetch).mockResolvedValue(
      Response.json({
        summary,
        items: [charge({ id: "charge-9", description: "Conta de luz" })],
        nextCursor: null,
      }),
    );
    render(<FeedScreen />);
    const link = await screen.findByRole("link", { name: "Pagar" });
    expect(link).toHaveAttribute("href", "/charges/charge-9");
  });
});
