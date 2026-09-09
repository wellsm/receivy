import { addCalendarDays, calendarDate, EMPTY_BILLING_DRAFT, type BillingDetail } from "@receivy/common";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { saveDraft } from "@/lib/billing-draft";
import { BillingForm } from "./billing-form";

const routerMock = { push: vi.fn(), replace: vi.fn(), back: vi.fn() };

vi.mock("@/lib/auth/browser-fetch", () => ({ browserFetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  window.sessionStorage.clear();
});

const TIMEZONE = "America/Sao_Paulo";
const today = () => calendarDate(new Date(), TIMEZONE);

const ana = { id: "p1", name: "Ana", email: null, phone: null, archivedAt: null, createdAt: "2026-01-01", hasAccount: false, lastBilledAt: `${addCalendarDays(today(), -1)}T10:00:00.000Z` };
const bruno = { id: "p2", name: "Bruno", email: null, phone: null, archivedAt: null, createdAt: "2026-01-01", hasAccount: false, lastBilledAt: null };
const method = { id: "pix-1", label: "Nubank", pixKey: "ana@example.com", pixKeyType: "email", isDefault: true, archivedAt: null };

type Sent = { path: string; init: RequestInit };

function api(handler: (path: string, init: RequestInit) => Response | undefined = () => undefined) {
  const sent: Sent[] = [];

  vi.mocked(browserFetch).mockImplementation(async (path, init = {}) => {
    sent.push({ path, init });

    const custom = handler(path, init);

    if (custom) {
      return custom;
    }

    if (path.startsWith("/api/people?search=")) {
      return Response.json({ people: [bruno], nextCursor: null });
    }

    if (path.startsWith("/api/people")) {
      return Response.json({ people: [ana], nextCursor: null });
    }

    if (path.includes("payment-methods")) {
      return Response.json({ paymentMethods: [method] });
    }

    if (path.includes("auth/me")) {
      return Response.json({ user: { timezone: TIMEZONE } });
    }

    throw new Error(`unexpected ${path}`);
  });

  return sent;
}

function renderForm(billing: BillingDetail | null = null) {
  const onSaved = vi.fn();

  render(<BillingForm billing={billing} onSaved={onSaved} onBack={vi.fn()} />);

  return { user: userEvent.setup(), onSaved };
}

it("lists the recent contacts in the carousel with initial, name and last billing hint", async () => {
  const sent = api();
  renderForm();

  const contact = await screen.findByRole("button", { name: /Ana/ });

  expect(contact).toHaveTextContent("A");
  expect(contact).toHaveTextContent("Ontem");
  expect(contact).toHaveAttribute("aria-pressed", "false");
  expect(sent.some(entry => entry.path === "/api/people?sort=recent")).toBe(true);
});

it("toggles the selection of a contact in the carousel", async () => {
  api();
  const { user } = renderForm();

  const contact = await screen.findByRole("button", { name: /Ana/ });
  await user.click(contact);
  expect(contact).toHaveAttribute("aria-pressed", "true");

  await user.click(contact);
  expect(contact).toHaveAttribute("aria-pressed", "false");
});

it("opens the contact panel and searches the whole agenda", async () => {
  const sent = api();
  const { user } = renderForm();

  await user.click(await screen.findByRole("button", { name: "Ver todos" }));

  const panel = screen.getByRole("dialog", { name: "Contatos" });
  await user.type(within(panel).getByLabelText("Buscar contatos"), "ma");

  expect(await within(panel).findByRole("checkbox", { name: "Bruno" })).toBeInTheDocument();
  expect(sent.some(entry => entry.path === "/api/people?search=ma")).toBe(true);

  await user.click(within(panel).getByRole("checkbox", { name: "Bruno" }));
  await user.click(within(panel).getByRole("button", { name: "Concluir" }));

  expect(screen.queryByRole("dialog", { name: "Contatos" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Bruno/ })).toHaveAttribute("aria-pressed", "true");
});

it("fills the description from a category chip while it is empty", async () => {
  api();
  const { user } = renderForm();

  await user.click(await screen.findByRole("button", { name: "Alimentação" }));

  expect(screen.getByLabelText("Descrição")).toHaveValue("Alimentação");
  expect(screen.getByRole("button", { name: "Alimentação" })).toHaveAttribute("aria-pressed", "true");
});

it("shows the installment field and renames the amount for a parcelado billing", async () => {
  api();
  const { user } = renderForm();

  await user.click(await screen.findByRole("radio", { name: "Parcelado" }));

  expect(screen.getByLabelText("Parcelas")).toBeInTheDocument();
  expect(screen.getByLabelText("Valor por parcela")).toBeInTheDocument();

  await user.click(screen.getByRole("radio", { name: "Sem fim" }));

  expect(screen.getByLabelText("Valor por ocorrência")).toBeInTheDocument();
});

it("computes the live amount for each share row", async () => {
  api();
  const { user } = renderForm();

  await user.click(await screen.findByRole("button", { name: /Ana/ }));
  await user.type(screen.getByLabelText("Valor"), "100,00");
  await user.click(screen.getByRole("radio", { name: "Cotas" }));

  await user.clear(screen.getByLabelText("Cotas de Ana"));
  await user.type(screen.getByLabelText("Cotas de Ana"), "2");
  await user.clear(screen.getByLabelText("Cotas de Eu"));
  await user.type(screen.getByLabelText("Cotas de Eu"), "2");

  expect(screen.getAllByText("2 cotas · R$ 50,00")).toHaveLength(2);
});

it("warns about the missing remainder on a fixed split", async () => {
  api();
  const { user } = renderForm();

  await user.click(await screen.findByRole("button", { name: /Ana/ }));
  await user.type(screen.getByLabelText("Valor"), "100,00");
  await user.click(screen.getByRole("radio", { name: "Valor fixo" }));
  await user.type(screen.getByLabelText("Valor de Ana"), "40,00");

  expect(screen.getByText("Faltam R$ 60,00")).toBeInTheDocument();
});

it("sets the due date from the quick buttons and summarises the billing in the footer", async () => {
  api();
  const { user } = renderForm();

  await user.click(await screen.findByRole("button", { name: /Ana/ }));
  await user.type(screen.getByLabelText("Valor"), "100,00");
  await user.click(screen.getByRole("button", { name: "Amanhã" }));

  expect(screen.getByLabelText("Vencimento")).toHaveValue(addCalendarDays(today(), 1));
  expect(screen.getByText("2 pessoas · R$ 50,00 cada · vence amanhã")).toBeInTheDocument();
});

it("saves the draft and navigates when the user creates a new contact", async () => {
  api();
  const { user } = renderForm();

  await user.type(await screen.findByLabelText("Valor"), "70,00");
  await user.click(screen.getByRole("button", { name: "Novo contato" }));

  expect(routerMock.push).toHaveBeenCalledWith("/people?returnTo=/charges/new");
  expect(JSON.parse(window.sessionStorage.getItem("receivy.billingDraft") ?? "{}")).toMatchObject({
    returnTo: "/charges/new",
    draft: { amount: "70,00" },
  });
});

it("saves the draft and navigates when the user registers a Pix key", async () => {
  api();
  const { user } = renderForm();

  await user.type(await screen.findByLabelText("Valor"), "70,00");
  await user.click(screen.getByRole("button", { name: "Cadastrar chave" }));

  expect(routerMock.push).toHaveBeenCalledWith("/settings/pix?returnTo=/charges/new");
  expect(window.sessionStorage.getItem("receivy.billingDraft")).toContain("70,00");
});

it("restores the stored draft when the form mounts", async () => {
  api();
  saveDraft({ ...EMPTY_BILLING_DRAFT(TIMEZONE, today()), selected: ["p1"], amount: "80,00", pix: "pix-1" }, "/charges/new");
  renderForm();

  expect(await screen.findByLabelText("Valor")).toHaveValue("80,00");
  expect(screen.getByRole("button", { name: /Ana/ })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: /Nubank/ })).toHaveAttribute("aria-pressed", "true");
  expect(window.sessionStorage.getItem("receivy.billingDraft")).toBeNull();
});

it("creates the billing in one step, with category, shares and an idempotency key", async () => {
  const sent = api((_path, init) => (init.method === "POST" ? Response.json({ id: "b1", charges: [{ id: "c1" }] }, { status: 201 }) : undefined));
  const { user, onSaved } = renderForm();

  await user.click(await screen.findByRole("button", { name: /Ana/ }));
  await user.type(screen.getByLabelText("Valor"), "100,00");
  await user.click(screen.getByRole("button", { name: "Alimentação" }));
  await user.click(screen.getByRole("radio", { name: "Cotas" }));

  expect(screen.queryByRole("button", { name: /Revisar/ })).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Criar cobrança" }));

  const post = sent.find(entry => entry.init.method === "POST");
  expect(post?.path).toBe("/api/financial/billings");
  expect(JSON.parse(String(post?.init.body))).toMatchObject({
    type: "once",
    totalCents: 10_000,
    category: "food",
    description: "Alimentação",
    timezone: TIMEZONE,
    split: { mode: "shares", parts: [{ kind: "person", personId: "p1", shares: 1 }, { kind: "owner", shares: 1 }] },
  });
  expect((post?.init.headers as Record<string, string>)["idempotency-key"]).toMatch(/\w/);
  expect(onSaved).toHaveBeenCalledWith({ id: "b1", charges: [{ id: "c1" }] });
});

it("keeps the payload and the idempotency key across an uncertain retry", async () => {
  let attempts = 0;
  const sent = api((_path, init) => {
    if (init.method !== "POST") {
      return undefined;
    }

    attempts += 1;

    return attempts === 1
      ? Response.json({ code: "INTERNAL_ERROR", message: "lost" }, { status: 503 })
      : Response.json({ id: "b1", charges: [] }, { status: 201 });
  });
  const { user } = renderForm();

  await user.click(await screen.findByRole("button", { name: /Ana/ }));
  await user.type(screen.getByLabelText("Valor"), "100,00");
  await user.type(screen.getByLabelText("Descrição"), "Jantar");
  await user.click(screen.getByRole("button", { name: "Criar cobrança" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Serviço temporariamente indisponível. Tente novamente.");

  await user.click(screen.getByRole("button", { name: "Tentar novamente" }));

  const posts = sent.filter(entry => entry.init.method === "POST");
  expect(posts[1]?.init.body).toBe(posts[0]?.init.body);
  expect(posts[1]?.init.headers).toEqual(posts[0]?.init.headers);
});

it("shows the validation error inline when no contact is selected", async () => {
  api();
  const { user } = renderForm();

  await user.type(await screen.findByLabelText("Valor"), "100,00");
  await user.click(screen.getByRole("button", { name: "Criar cobrança" }));

  expect(screen.getByRole("alert")).toHaveTextContent("Selecione ao menos um contato.");
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
  timezone: TIMEZONE,
  paymentMethodId: "pix-1",
  reminders: [{ offsetDays: -3, enabled: true }],
  split: { mode: "equal", parts: [{ kind: "person", personId: "p1" }] },
  allocations: [],
  charges: [],
  previews: [],
  nextMaterialization: null,
  category: "other",
  invite: null,
};

it("freezes a finite billing and patches only category, Pix and reminders", async () => {
  const sent = api((_path, init) => (init.method === "PATCH" ? Response.json(onceBilling) : undefined));
  const { user } = renderForm(onceBilling);

  expect(await screen.findByRole("button", { name: /Nubank/ })).toBeInTheDocument();
  expect(screen.getByText("Editar cobrança")).toBeInTheDocument();
  expect(screen.getByText("Cobranças já geradas só permitem categoria, Pix e lembretes.")).toBeInTheDocument();
  expect(screen.getByLabelText("Descrição")).toBeDisabled();
  expect(screen.getByLabelText("Valor")).toBeDisabled();
  expect(screen.getByLabelText("Vencimento")).toBeDisabled();
  expect(screen.getByRole("radio", { name: "Parcelado" })).toBeDisabled();

  await user.click(screen.getByRole("button", { name: "Salvar" }));

  const patch = sent.find(entry => entry.init.method === "PATCH");
  expect(patch?.path).toBe("/api/financial/billings/b1");
  expect(JSON.parse(String(patch?.init.body))).toEqual({
    paymentMethodId: "pix-1",
    clearPaymentMethod: false,
    reminders: [{ offsetDays: -3, enabled: true }],
    category: "other",
  });
});
