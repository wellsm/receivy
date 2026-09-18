import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { BillingsScreen } from "@/components/screens/billings-screen";

const router = { push: vi.fn(), replace: vi.fn() };
const writeText = vi.fn(async () => {});

vi.mock("@/lib/auth/browser-fetch", () => ({ browserFetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

/** userEvent installs its own clipboard stub on setup, so ours has to land afterwards. */
function setup(options: Parameters<typeof userEvent.setup>[0] = {}) {
  const user = userEvent.setup(options);

  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

  return user;
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.useRealTimers();
});

type Overrides = Record<string, unknown>;

const ana = { id: "c1", userId: "u1", name: "Ana", avatar: null };

function summary(overrides: Overrides = {}) {
  return {
    id: "b1",
    recurrence: "once",
    type: "receivable",
    contact: null,
    counterpart: null,
    description: "Churrasco",
    total: { amountCents: 12000, currency: "BRL" },
    startDate: "2026-09-01",
    state: "active",
    nextDueDate: "2026-10-20",
    createdAt: "2026-09-01T00:00:00Z",
    category: "food",
    participantCount: 3,
    chargeCount: 3,
    paidCount: 0,
    proofsPending: 0,
    shareChargeId: null,
    ...overrides,
  };
}

function shiftDays(days: number): string {
  const date = new Date();

  date.setDate(date.getDate() + days);

  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

type Handler = (path: string, init?: RequestInit) => Response | undefined;

function isList(path: string): boolean {
  return path === "/api/financial/billings" || path.startsWith("/api/financial/billings?");
}

function mockApi(handler: Handler): string[] {
  const calls: string[] = [];

  vi.mocked(browserFetch).mockImplementation(async (path, init) => {
    calls.push(`${init?.method ?? "GET"} ${path}`);

    return handler(path, init) ?? Response.json({ billings: [], nextCursor: null });
  });

  return calls;
}

function listOnly(billings: unknown[], nextCursor: string | null = null): string[] {
  return mockApi((path) => (isList(path) ? Response.json({ billings, nextCursor }) : undefined));
}

it("renders one card per billing with badges, relative due date, amount and next due date", async () => {
  listOnly([summary(), summary({ id: "b2", description: "Aluguel", nextDueDate: shiftDays(-1), category: "housing", participantCount: 1 })]);

  render(<BillingsScreen />);

  const card = await screen.findByRole("article", { name: "Cobrança Churrasco" });

  expect(within(card).getByText("Única")).toBeInTheDocument();
  expect(within(card).getByText("3 pessoas")).toBeInTheDocument();
  expect(within(card).getByText("R$ 120,00")).toBeInTheDocument();
  expect(within(card).getByText("Vencimento 20/out")).toBeInTheDocument();
  expect(within(card).queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();

  const overdue = screen.getByRole("article", { name: "Cobrança Aluguel" });
  const overdueLabel = within(overdue).getByText("Atrasado 1 dia");

  expect(overdueLabel).toHaveClass("text-danger");
});

it("sends the search term after the debounce without a state filter", async () => {
  vi.useFakeTimers();

  const calls = listOnly([summary()]);

  render(<BillingsScreen />);

  // userEvent's async wrapper deadlocks under vitest fake timers, so this one drives the DOM directly.
  fireEvent.change(screen.getByLabelText("Buscar por título ou descrição"), { target: { value: "churr" } });
  expect(calls.filter((call) => call.includes("search="))).toEqual([]);

  await act(async () => {
    vi.advanceTimersByTime(300);
  });

  const searched = calls.filter((call) => call.includes("search="));

  expect(searched).toHaveLength(1);
  expect(searched[0]).toContain("search=churr");
  expect(searched[0]).not.toContain("state=");
});

it("shows only active billings by default and switches state without asking the API again", async () => {
  const calls = listOnly([
    summary(),
    summary({ id: "b2", description: "Netflix", state: "ended", paidCount: 3 }),
    summary({ id: "b3", description: "Academia", recurrence: "indefinite", state: "paused" }),
  ]);

  render(<BillingsScreen />);

  const user = setup();

  expect(await screen.findByRole("article", { name: "Cobrança Churrasco" })).toBeInTheDocument();
  expect(screen.queryByRole("article", { name: "Cobrança Netflix" })).not.toBeInTheDocument();
  expect(screen.getByRole("radio", { name: "Ativas" })).toHaveAttribute("aria-checked", "true");

  await user.click(screen.getByRole("radio", { name: "Encerradas" }));

  expect(screen.getByRole("article", { name: "Cobrança Netflix" })).toBeInTheDocument();
  expect(screen.queryByRole("article", { name: "Cobrança Churrasco" })).not.toBeInTheDocument();

  await user.click(screen.getByRole("radio", { name: "Pausadas" }));

  expect(screen.getByRole("article", { name: "Cobrança Academia" })).toBeInTheDocument();
  expect(calls.filter((call) => call.startsWith("GET /api/financial/billings"))).toHaveLength(1);
});

it("explains an empty state filter instead of hiding everything silently", async () => {
  listOnly([summary()]);

  render(<BillingsScreen />);

  const user = setup();

  await screen.findByRole("article", { name: "Cobrança Churrasco" });
  await user.click(screen.getByRole("radio", { name: "Encerradas" }));

  expect(screen.getByText("Nenhuma conta encerrada.")).toBeInTheDocument();
  expect(screen.queryByText("Nenhuma conta ainda")).not.toBeInTheDocument();
});

it("shares the public link of the only pending charge", async () => {
  const calls = mockApi((path, init) => {
    if (path === "/api/financial/charges/c9/public-link" && init?.method === "POST") {
      return Response.json({ token: "tk", expiresAt: "2026-10-08T00:00:00Z" });
    }
    if (isList(path)) {
      return Response.json({ billings: [summary({ shareChargeId: "c9" })], nextCursor: null });
    }

    return undefined;
  });

  render(<BillingsScreen />);

  const user = setup();

  await user.click(await screen.findByRole("button", { name: "Compartilhar" }));

  expect(calls).toContain("POST /api/financial/charges/c9/public-link");
  expect(writeText).toHaveBeenCalledWith("http://localhost:3000/pay/tk");
  expect(await screen.findByRole("status")).toHaveTextContent("Link copiado");
});

it("opens the charge when the public link cannot be published", async () => {
  mockApi((path, init) => {
    if (path === "/api/financial/charges/c9/public-link" && init?.method === "POST") {
      return Response.json({ message: "Cadastre uma chave Pix." }, { status: 422 });
    }
    if (isList(path)) {
      return Response.json({ billings: [summary({ shareChargeId: "c9" })], nextCursor: null });
    }

    return undefined;
  });

  render(<BillingsScreen />);

  const user = setup();

  await user.click(await screen.findByRole("button", { name: "Compartilhar" }));

  expect(router.push).toHaveBeenCalledWith("/charges/c9");
});

it("opens the billing detail route when there is no single charge to share, and from the card itself", async () => {
  listOnly([summary()]);

  render(<BillingsScreen />);

  const user = setup();

  await user.click(await screen.findByRole("button", { name: "Compartilhar" }));

  expect(router.push).toHaveBeenCalledWith("/billings/b1");

  await user.click(screen.getByRole("button", { name: "Abrir Churrasco" }));

  expect(router.push).toHaveBeenCalledTimes(2);
  expect(router.push).toHaveBeenLastCalledWith("/billings/b1");
});

it("asks the API for one direction when the filter changes", async () => {
  const calls = listOnly([summary()]);

  render(<BillingsScreen />);

  const user = setup();

  await screen.findByRole("article", { name: "Cobrança Churrasco" });

  expect(screen.getByRole("radio", { name: "Todas" })).toHaveAttribute("aria-checked", "true");
  expect(calls[0]).not.toContain("type=");

  await user.click(screen.getByRole("radio", { name: "A pagar" }));

  await vi.waitFor(() => expect(calls.some((call) => call.includes("type=payable"))).toBe(true));

  await user.click(screen.getByRole("radio", { name: "A receber" }));

  await vi.waitFor(() => expect(calls.some((call) => call.includes("type=receivable"))).toBe(true));
});

it("opens a conta a pagar from its card action instead of sharing a link", async () => {
  const calls = listOnly([summary({ type: "payable", contact: ana, counterpart: ana, shareChargeId: "c9" })]);

  render(<BillingsScreen />);

  const user = setup();

  const card = await screen.findByRole("article", { name: "Cobrança Churrasco" });

  expect(within(card).getByText("A pagar")).toBeInTheDocument();
  expect(within(card).getByText("Ana")).toBeInTheDocument();
  expect(within(card).queryByRole("button", { name: "Compartilhar" })).not.toBeInTheDocument();

  await user.click(within(card).getByRole("button", { name: "Ver conta" }));

  expect(router.push).toHaveBeenCalledWith("/billings/b1");
  expect(calls.some((call) => call.includes("public-link"))).toBe(false);
});

it("shows the empty state and keeps the sticky button to create a billing", async () => {
  listOnly([]);

  render(<BillingsScreen />);

  expect(await screen.findByText("Nenhuma conta ainda")).toBeInTheDocument();

  const links = screen.getAllByRole("link", { name: "Nova conta" });

  expect(links.length).toBeGreaterThan(1);
  expect(links.at(-1)).toHaveAttribute("href", "/billings/new");
  expect(links.at(-1)).toHaveTextContent("Cadastrar Nova Conta");
});

it("loads the next page when asked", async () => {
  const calls = mockApi((path) => {
    if (path.includes("cursor=c2")) {
      return Response.json({ billings: [summary({ id: "b2", description: "Aluguel" })], nextCursor: null });
    }
    if (isList(path)) {
      return Response.json({ billings: [summary()], nextCursor: "c2" });
    }

    return undefined;
  });

  render(<BillingsScreen />);

  const user = setup();

  await user.click(await screen.findByRole("button", { name: "Carregar mais" }));

  expect(await screen.findByRole("article", { name: "Cobrança Aluguel" })).toBeInTheDocument();
  expect(screen.getByRole("article", { name: "Cobrança Churrasco" })).toBeInTheDocument();
  expect(calls.some((call) => call.includes("cursor=c2"))).toBe(true);
});
