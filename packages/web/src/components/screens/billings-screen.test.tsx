import { PlanTier, SubscriptionStatus, type PlanSummary } from "@receivy/common";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BillingsScreen } from "@/components/screens/billings-screen";
import { renderWithRouter } from "@/test/render";

const navigate = vi.fn();
const writeText = vi.fn(async () => {});

vi.mock("@/lib/navigate", () => ({ useAppNavigate: () => navigate }));

const API = "https://api.test";

/** userEvent installs its own clipboard stub on setup, so ours has to land afterwards. */
function setup(options: Parameters<typeof userEvent.setup>[0] = {}) {
  const user = userEvent.setup(options);

  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

  return user;
}

beforeEach(() => {
  vi.stubEnv("VITE_API_URL", API);
});

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

type Handler = (url: string, init?: RequestInit) => Response | undefined;

function isList(url: string): boolean {
  return url === `${API}/billings` || url.startsWith(`${API}/billings?`);
}

/** A recorded call (`GET https://api.test/...`) that listed billings. */
function isListCall(call: string): boolean {
  return isList(call.replace(/^[A-Z]+ /, ""));
}

/** Well under the 80% threshold, so no test that ignores the plan ever trips the usage pill. */
const defaultPlan: PlanSummary = { plan: PlanTier.Free, status: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, usage: { indefinite: { used: 0, limit: 5 } }, checkoutLinks: false, card: null };

function mockApi(handler: Handler): string[] {
  const calls: string[] = [];

  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);

    const custom = handler(url, init);

    if (custom) {
      return custom;
    }

    if (url === `${API}/plan`) {
      return Response.json(defaultPlan);
    }

    return Response.json({ billings: [], nextCursor: null });
  });

  vi.stubGlobal("fetch", fetchMock);

  return calls;
}

const COUNTS = { active: 7, paused: 1, ended: 4, monthCharges: 23 };

function listOnly(billings: unknown[], nextCursor: string | null = null): string[] {
  return mockApi((url) => (isList(url) ? Response.json({ billings, nextCursor, counts: COUNTS }) : undefined));
}

it("renders one card per billing with badges, relative due date, amount and next due date", async () => {
  listOnly([summary(), summary({ id: "b2", description: "Aluguel", nextDueDate: shiftDays(-1), category: "housing", participantCount: 1 })]);

  renderWithRouter(<BillingsScreen />);

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
  const calls = listOnly([summary()]);

  renderWithRouter(<BillingsScreen />);

  // The router resolves the initial route on real timers; fake timers only take over once it has settled.
  const search = await screen.findByLabelText("Buscar por título ou descrição");

  vi.useFakeTimers();

  // userEvent's async wrapper deadlocks under vitest fake timers, so this one drives the DOM directly.
  fireEvent.change(search, { target: { value: "churr" } });
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

  renderWithRouter(<BillingsScreen />);

  const user = setup();

  expect(await screen.findByRole("article", { name: "Cobrança Churrasco" })).toBeInTheDocument();
  expect(screen.queryByRole("article", { name: "Cobrança Netflix" })).not.toBeInTheDocument();
  expect(screen.getByRole("radio", { name: "Ativas" })).toHaveAttribute("aria-checked", "true");

  await user.click(screen.getByRole("radio", { name: "Encerradas" }));

  expect(screen.getByRole("article", { name: "Cobrança Netflix" })).toBeInTheDocument();
  expect(screen.queryByRole("article", { name: "Cobrança Churrasco" })).not.toBeInTheDocument();

  await user.click(screen.getByRole("radio", { name: "Pausadas" }));

  expect(screen.getByRole("article", { name: "Cobrança Academia" })).toBeInTheDocument();
  expect(calls.filter((call) => call.startsWith(`GET ${API}/billings`))).toHaveLength(1);
});

it("explains an empty state filter instead of hiding everything silently", async () => {
  listOnly([summary()]);

  renderWithRouter(<BillingsScreen />);

  const user = setup();

  await screen.findByRole("article", { name: "Cobrança Churrasco" });
  await user.click(screen.getByRole("radio", { name: "Encerradas" }));

  expect(screen.getByText("Nenhuma conta encerrada.")).toBeInTheDocument();
  expect(screen.queryByText("Nenhuma conta ainda")).not.toBeInTheDocument();
});

it("shares the public link of the only pending charge", async () => {
  const calls = mockApi((url, init) => {
    if (url === `${API}/charges/c9/public-link` && init?.method === "POST") {
      return Response.json({ token: "tk", expiresAt: "2026-10-08T00:00:00Z" });
    }
    if (isList(url)) {
      return Response.json({ billings: [summary({ shareChargeId: "c9" })], nextCursor: null });
    }

    return undefined;
  });

  renderWithRouter(<BillingsScreen />);

  const user = setup();

  await user.click(await screen.findByRole("button", { name: "Compartilhar" }));

  expect(calls).toContain(`POST ${API}/charges/c9/public-link`);
  expect(writeText).toHaveBeenCalledWith("http://localhost:3000/pay/tk");
  expect(await screen.findByRole("status")).toHaveTextContent("Link copiado");
});

it("opens the charge when the public link cannot be published", async () => {
  mockApi((url, init) => {
    if (url === `${API}/charges/c9/public-link` && init?.method === "POST") {
      return Response.json({ message: "Cadastre uma chave Pix." }, { status: 422 });
    }
    if (isList(url)) {
      return Response.json({ billings: [summary({ shareChargeId: "c9" })], nextCursor: null });
    }

    return undefined;
  });

  renderWithRouter(<BillingsScreen />);

  const user = setup();

  await user.click(await screen.findByRole("button", { name: "Compartilhar" }));

  expect(navigate).toHaveBeenCalledWith("/charges/c9");
});

it("opens the billing detail route when there is no single charge to share, and from the card itself", async () => {
  listOnly([summary()]);

  renderWithRouter(<BillingsScreen />);

  const user = setup();

  await user.click(await screen.findByRole("button", { name: "Compartilhar" }));

  expect(navigate).toHaveBeenCalledWith("/billings/b1");

  await user.click(screen.getByRole("button", { name: "Abrir Churrasco" }));

  expect(navigate).toHaveBeenCalledTimes(2);
  expect(navigate).toHaveBeenLastCalledWith("/billings/b1");
});

it("filters one direction on the loaded list without asking the API again", async () => {
  const calls = listOnly([summary(), summary({ id: "b2", description: "Streaming", type: "payable", contact: ana, counterpart: ana })]);

  renderWithRouter(<BillingsScreen />);

  const user = setup();

  await screen.findByRole("article", { name: "Cobrança Churrasco" });

  expect(screen.getByRole("radio", { name: "Todas" })).toHaveAttribute("aria-checked", "true");

  await user.click(screen.getByRole("radio", { name: "A pagar" }));

  expect(screen.getByRole("article", { name: "Cobrança Streaming" })).toBeInTheDocument();
  expect(screen.queryByRole("article", { name: "Cobrança Churrasco" })).not.toBeInTheDocument();
  expect(calls.filter(isListCall).every((call) => !call.includes("type="))).toBe(true);
  expect(calls.filter(isListCall)).toHaveLength(1);
});

it("reads the API counts in the narrow header and on the state tabs", async () => {
  listOnly([summary()]);

  renderWithRouter(<BillingsScreen user={{ name: "Wellington Silva", avatar: null }} />);

  expect(await screen.findByText("7 ativas · 23 cobranças no mês")).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Pausadas (1)" })).toHaveAttribute("aria-selected", "false");
  expect(screen.getByRole("tab", { name: "Ativas (7)" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("link", { name: "Voltar para o Feed" })).toHaveAttribute("href", "/feed");
  expect(screen.getByRole("link", { name: "Perfil" })).toHaveAttribute("href", "/settings");
});

it("filters by frequency and category from the footer sheet", async () => {
  listOnly([summary(), summary({ id: "b2", description: "Youtube", recurrence: "indefinite", category: "subscription" })]);

  renderWithRouter(<BillingsScreen />);

  const user = setup();

  await screen.findByRole("article", { name: "Cobrança Churrasco" });
  await user.click(screen.getByRole("button", { name: "Filtros" }));
  await user.click(screen.getByRole("button", { name: "Frequência Recorrente" }));
  await user.click(screen.getByRole("button", { name: "Categoria Assinatura" }));
  await user.click(screen.getByRole("button", { name: "Aplicar" }));

  expect(screen.getByRole("article", { name: "Cobrança Youtube" })).toBeInTheDocument();
  expect(screen.queryByRole("article", { name: "Cobrança Churrasco" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Filtros, 2 ativos" })).toBeInTheDocument();
});

it("shows the narrow card chips and next due date", async () => {
  listOnly([summary({ recurrence: "until", installmentCount: 12, paidCount: 2, chargeCount: 12, splitMode: "shares" })]);

  renderWithRouter(<BillingsScreen />);

  const card = await screen.findByRole("article", { name: "Cobrança Churrasco" });

  expect(within(card).getByText("Parcelado 3/12")).toBeInTheDocument();
  expect(within(card).getByText("Cotas")).toBeInTheDocument();
  expect(within(card).getByText("Alimentação · a receber")).toBeInTheDocument();
});

it("opens a conta a pagar from its card action instead of sharing a link", async () => {
  const calls = listOnly([summary({ type: "payable", contact: ana, counterpart: ana, shareChargeId: "c9" })]);

  renderWithRouter(<BillingsScreen />);

  const user = setup();

  const card = await screen.findByRole("article", { name: "Cobrança Churrasco" });

  expect(within(card).getByText("A pagar")).toBeInTheDocument();
  expect(within(card).getByText("Ana")).toBeInTheDocument();
  expect(within(card).queryByRole("button", { name: "Compartilhar" })).not.toBeInTheDocument();

  await user.click(within(card).getByRole("button", { name: "Ver conta" }));

  expect(navigate).toHaveBeenCalledWith("/billings/b1");
  expect(calls.some((call) => call.includes("public-link"))).toBe(false);
});

it("shows the empty state and keeps the + of the footer to create a billing", async () => {
  listOnly([]);

  renderWithRouter(<BillingsScreen />);

  expect(await screen.findByText("Nenhuma conta ainda")).toBeInTheDocument();

  const links = screen.getAllByRole("link", { name: "Nova conta" });

  expect(links.length).toBeGreaterThan(1);

  for (const link of links) {
    expect(link).toHaveAttribute("href", "/billings/new");
  }

  expect(screen.getByRole("searchbox", { name: "Buscar conta" })).toBeInTheDocument();
});

it("loads the next page when asked", async () => {
  const calls = mockApi((url) => {
    if (url.includes("cursor=c2")) {
      return Response.json({ billings: [summary({ id: "b2", description: "Aluguel" })], nextCursor: null });
    }
    if (isList(url)) {
      return Response.json({ billings: [summary()], nextCursor: "c2" });
    }

    return undefined;
  });

  renderWithRouter(<BillingsScreen />);

  const user = setup();

  await user.click(await screen.findByRole("button", { name: "Carregar mais" }));

  expect(await screen.findByRole("article", { name: "Cobrança Aluguel" })).toBeInTheDocument();
  expect(screen.getByRole("article", { name: "Cobrança Churrasco" })).toBeInTheDocument();
  expect(calls.some((call) => call.includes("cursor=c2"))).toBe(true);
});

it("shows the usage pill next to Nova conta when close to the plan limit", async () => {
  const basicUsage: PlanSummary = { plan: PlanTier.Basic, status: SubscriptionStatus.Active, currentPeriodEnd: "2026-10-19T12:00:00.000Z", cancelAtPeriodEnd: false, usage: { indefinite: { used: 4, limit: 5 } }, checkoutLinks: true, card: null };

  mockApi((url) => (url === `${API}/plan` ? Response.json(basicUsage) : undefined));

  renderWithRouter(<BillingsScreen />);

  const pill = await screen.findByRole("link", { name: "4 de 5 cobranças indefinidas" });

  expect(pill).toHaveAttribute("href", "/settings/plan");
});

it("hides the usage pill when far from the plan limit", async () => {
  const farFromLimit: PlanSummary = { plan: PlanTier.Free, status: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, usage: { indefinite: { used: 2, limit: 5 } }, checkoutLinks: false, card: null };

  const calls = mockApi((url) => (url === `${API}/plan` ? Response.json(farFromLimit) : undefined));

  renderWithRouter(<BillingsScreen />);

  await screen.findByText("Nenhuma conta ainda");
  await vi.waitFor(() => expect(calls).toContain(`GET ${API}/plan`));

  expect(screen.queryByRole("link", { name: /cobranças indefinidas/ })).not.toBeInTheDocument();
});
