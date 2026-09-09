import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { BillingsScreen } from "./billings-screen";

const router = { push: vi.fn(), replace: vi.fn() };
const writeText = vi.fn(async () => {});

vi.mock("@/lib/auth/browser-fetch", () => ({ browserFetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("./billing-form", () => ({
  BillingForm: ({ onBack }: { onBack: () => void }) => (
    <div>
      <p>Formulário de cobrança</p>
      <button type="button" onClick={onBack}>
        Sair do formulário
      </button>
    </div>
  ),
}));

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

function summary(overrides: Overrides = {}) {
  return {
    id: "b1",
    type: "once",
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

function detail(overrides: Overrides = {}) {
  return {
    ...summary(overrides),
    updatedAt: "2026-09-01T00:00:00Z",
    timezone: "America/Sao_Paulo",
    reminders: [],
    split: { mode: "equal", parts: [{ kind: "owner" }] },
    allocations: [],
    charges: [],
    previews: [],
    nextMaterialization: null,
    invite: null,
    ...overrides,
  };
}

function shiftDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

type Handler = (path: string, init?: RequestInit) => Response | undefined;

function mockApi(handler: Handler): string[] {
  const calls: string[] = [];

  vi.mocked(browserFetch).mockImplementation(async (path, init) => {
    calls.push(`${init?.method ?? "GET"} ${path}`);
    return handler(path, init) ?? Response.json({ billings: [], nextCursor: null });
  });

  return calls;
}

function listOnly(billings: unknown[], nextCursor: string | null = null): string[] {
  return mockApi((path) => (path.startsWith("/api/financial/billings?") ? Response.json({ billings, nextCursor }) : undefined));
}

it("renders one card per billing with badges, relative due date, amount and next due date", async () => {
  listOnly([summary(), summary({ id: "b2", description: "Aluguel", nextDueDate: shiftDays(-1), category: "housing", participantCount: 1 })]);

  render(<BillingsScreen />);

  const card = await screen.findByRole("article", { name: "Cobrança Churrasco" });
  expect(within(card).getByText("Única")).toBeInTheDocument();
  expect(within(card).getByText("3 pessoas")).toBeInTheDocument();
  expect(within(card).getByText("R$ 120,00")).toBeInTheDocument();
  expect(within(card).getByText("Vencimento 20/out")).toBeInTheDocument();

  const overdue = screen.getByRole("article", { name: "Cobrança Aluguel" });
  const overdueLabel = within(overdue).getByText("Atrasado 1 dia");
  expect(overdueLabel).toHaveClass("is-overdue");
});

it("reveals the search field and sends the term after the debounce", async () => {
  vi.useFakeTimers();
  const calls = listOnly([summary()]);

  render(<BillingsScreen />);

  // userEvent's async wrapper deadlocks under vitest fake timers, so this one drives the DOM directly.
  fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
  fireEvent.change(screen.getByLabelText("Buscar por título ou descrição"), { target: { value: "churr" } });
  expect(calls.filter((call) => call.includes("search="))).toEqual([]);

  await act(async () => {
    vi.advanceTimersByTime(300);
  });

  const searched = calls.filter((call) => call.includes("search="));
  expect(searched).toHaveLength(1);
  expect(searched[0]).toContain("search=churr");
  expect(searched[0]).toContain("state=active");
});

it("applies state, type and category filters to the query", async () => {
  const calls = listOnly([summary()]);

  render(<BillingsScreen />);
  await screen.findByRole("article", { name: "Cobrança Churrasco" });

  const user = setup();
  await user.click(screen.getByRole("button", { name: "Filtros" }));

  const panel = screen.getByRole("group", { name: "Filtros" });
  await user.click(within(within(panel).getByRole("group", { name: "Estado" })).getByRole("button", { name: "Encerradas" }));
  await user.click(within(within(panel).getByRole("group", { name: "Tipo" })).getByRole("button", { name: "Parcelada" }));
  await user.click(within(within(panel).getByRole("group", { name: "Categoria" })).getByRole("button", { name: "Alimentação" }));

  const last = calls.at(-1) ?? "";
  expect(last).toContain("state=ended");
  expect(last).toContain("type=until");
  expect(last).toContain("category=food");
  expect(screen.getByRole("button", { name: "Remover filtro Encerradas" })).toBeInTheDocument();
});

it("shares the public link of the only pending charge", async () => {
  const calls = mockApi((path, init) => {
    if (path === "/api/financial/charges/c9/public-link" && init?.method === "POST") {
      return Response.json({ token: "tk", expiresAt: "2026-10-08T00:00:00Z" });
    }
    if (path.startsWith("/api/financial/billings?")) return Response.json({ billings: [summary({ shareChargeId: "c9" })], nextCursor: null });
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
    if (path.startsWith("/api/financial/billings?")) return Response.json({ billings: [summary({ shareChargeId: "c9" })], nextCursor: null });
    return undefined;
  });

  render(<BillingsScreen />);
  const user = setup();
  await user.click(await screen.findByRole("button", { name: "Compartilhar" }));

  expect(router.push).toHaveBeenCalledWith("/charges/c9");
});

it("opens the billing detail when there is no single charge to share", async () => {
  mockApi((path) => {
    if (path === "/api/financial/billings/b1") return Response.json(detail());
    if (path.startsWith("/api/financial/billings?")) return Response.json({ billings: [summary()], nextCursor: null });
    return undefined;
  });

  render(<BillingsScreen />);
  const user = setup();
  await user.click(await screen.findByRole("button", { name: "Compartilhar" }));

  expect(await screen.findByRole("heading", { name: "Cobranças geradas" })).toBeInTheDocument();
});

it("opens the detail from the card body and the inline form from Editar", async () => {
  mockApi((path) => {
    if (path === "/api/financial/billings/b1") return Response.json(detail());
    if (path.startsWith("/api/financial/billings?")) return Response.json({ billings: [summary()], nextCursor: null });
    return undefined;
  });

  render(<BillingsScreen />);
  const user = setup();
  await user.click(await screen.findByRole("button", { name: "Abrir Churrasco" }));
  expect(await screen.findByRole("heading", { name: "Churrasco" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Todas as cobranças" }));
  await user.click(await screen.findByRole("button", { name: "Editar" }));
  expect(await screen.findByText("Formulário de cobrança")).toBeInTheDocument();
});

it("creates, copies and revokes the billing invite from the detail", async () => {
  const calls = mockApi((path, init) => {
    if (path === "/api/financial/billings/b1/invite" && init?.method === "POST") {
      return Response.json({ url: "http://localhost:3000/join/abc", expiresAt: "2026-10-08T12:00:00Z" });
    }
    if (path === "/api/financial/billings/b1/invite" && init?.method === "DELETE") return new Response(null, { status: 204 });
    if (path === "/api/financial/billings/b1") return Response.json(detail());
    if (path.startsWith("/api/financial/billings?")) return Response.json({ billings: [summary()], nextCursor: null });
    return undefined;
  });

  render(<BillingsScreen />);
  const user = setup();
  await user.click(await screen.findByRole("button", { name: "Abrir Churrasco" }));
  await user.click(await screen.findByRole("button", { name: "Convidar" }));

  expect(calls).toContain("POST /api/financial/billings/b1/invite");
  expect(writeText).toHaveBeenCalledWith("http://localhost:3000/join/abc");
  expect(await screen.findByRole("status")).toHaveTextContent("Link copiado");
  expect(screen.getByText(/Convite ativo até 08\/10/)).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Revogar" }));
  expect(calls).toContain("DELETE /api/financial/billings/b1/invite");
  expect(screen.queryByText(/Convite ativo até/)).not.toBeInTheDocument();
});

it("shows the invite already active on the detail without issuing a new one", async () => {
  const calls = mockApi((path) => {
    if (path === "/api/financial/billings/b1") {
      return Response.json(detail({ invite: { url: "http://localhost:3000/join/abc", expiresAt: "2026-10-08T12:00:00Z" } }));
    }
    if (path.startsWith("/api/financial/billings?")) return Response.json({ billings: [summary()], nextCursor: null });
    return undefined;
  });

  render(<BillingsScreen />);
  const user = setup();
  await user.click(await screen.findByRole("button", { name: "Abrir Churrasco" }));

  expect(await screen.findByText(/Convite ativo até 08\/10/)).toBeInTheDocument();
  expect(calls.filter((call) => call.includes("/invite"))).toEqual([]);

  await user.click(screen.getByRole("button", { name: "Copiar" }));
  expect(writeText).toHaveBeenCalledWith("http://localhost:3000/join/abc");
});

it("ends a billing only after confirmation", async () => {
  const patches: unknown[] = [];
  mockApi((path, init) => {
    if (init?.method === "PATCH") {
      patches.push(JSON.parse(String(init.body)));
      return Response.json(detail({ state: "ended" }));
    }
    if (path === "/api/financial/billings/b1") return Response.json(detail());
    if (path.startsWith("/api/financial/billings?")) return Response.json({ billings: [summary()], nextCursor: null });
    return undefined;
  });

  render(<BillingsScreen />);
  const user = setup();
  await user.click(await screen.findByRole("button", { name: "Abrir Churrasco" }));
  await user.click(await screen.findByRole("button", { name: "Encerrar" }));
  expect(patches).toEqual([]);

  await user.click(screen.getByRole("button", { name: "Confirmar encerramento" }));
  expect(patches).toEqual([{ state: "ended" }]);
  expect(await screen.findByText("Encerrada")).toBeInTheDocument();
});

it("shows the empty state with a way to create the first billing", async () => {
  listOnly([]);

  render(<BillingsScreen />);

  expect(await screen.findByText("Nenhuma cobrança ainda")).toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: "Nova cobrança" }).length).toBeGreaterThan(0);
});

it("loads the next page when asked", async () => {
  const calls = mockApi((path) => {
    if (path.includes("cursor=c2")) return Response.json({ billings: [summary({ id: "b2", description: "Aluguel" })], nextCursor: null });
    if (path.startsWith("/api/financial/billings?")) return Response.json({ billings: [summary()], nextCursor: "c2" });
    return undefined;
  });

  render(<BillingsScreen />);
  const user = setup();
  await user.click(await screen.findByRole("button", { name: "Carregar mais" }));

  expect(await screen.findByRole("article", { name: "Cobrança Aluguel" })).toBeInTheDocument();
  expect(screen.getByRole("article", { name: "Cobrança Churrasco" })).toBeInTheDocument();
  expect(calls.some((call) => call.includes("cursor=c2"))).toBe(true);
});
