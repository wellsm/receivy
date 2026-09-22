import { addCalendarDays, BillingCategory, BillingFrequency, BillingKind, BillingState, BillingRecurrence, calendarDate, ChargeState, Direction, EMPTY_BILLING_DRAFT, endOfMonth, endOfMonthOptions, PixKeyType, SharingState, SplitMode, SplitPartKind, type BillingDetail, type BillingPatch, type ChargeDetail, type ReminderRule } from "@receivy/common";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { saveDraft } from "@/lib/billing-draft";
import { BillingFormScreen } from "@/components/forms/billing-form-screen";

const routerMock = { push: vi.fn(), replace: vi.fn(), back: vi.fn() };

vi.mock("@/lib/auth/browser-fetch", () => ({ browserFetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.useRealTimers();
  window.sessionStorage.clear();
});

const TIMEZONE = "America/Sao_Paulo";
const today = () => calendarDate(new Date(), TIMEZONE);

const ana = { id: "c1", userId: "u1", name: "Ana Souza", nickname: "Ana", displayName: "Ana", email: "ana@example.com", phone: null, status: "pending", archivedAt: null, createdAt: "2026-01-01", lastBilledAt: `${addCalendarDays(today(), -1)}T10:00:00.000Z`, activeCharges: 0 };
const bruno = { id: "c2", userId: "u2", name: "Bruno Lima", nickname: null, displayName: "Bruno Lima", email: "bruno@example.com", phone: null, status: "active", archivedAt: null, createdAt: "2026-01-01", lastBilledAt: null, activeCharges: 0 };
/** No e-mail and no phone: a placeholder contact nobody can notify. */
const carla = { id: "c3", userId: "u3", name: "Carla Dias", nickname: null, displayName: "Carla", email: "", phone: null, status: "pending", archivedAt: null, createdAt: "2026-01-01", lastBilledAt: null, activeCharges: 0 };
const method = { id: "pix-1", label: "Nubank", provider: "pix", value: "ana@example.com", kind: "email", isDefault: true, contactId: null, archivedAt: null };
/** Block 9.1: the keys the owner filed under each contact; a conta a pagar only picks among the seated contact's. */
const anaKey = { id: "pix-ana", label: "Nubank da Ana", provider: "pix", value: "ana@example.com", kind: "email", isDefault: true, contactId: "c1", archivedAt: null };
const anaSecondKey = { id: "pix-ana-2", label: "Itaú da Ana", provider: "pix", value: "52998224725", kind: "cpf", isDefault: false, contactId: "c1", archivedAt: null };
const brunoKey = { id: "pix-bruno", label: "Bruno", provider: "pix", value: "bruno@example.com", kind: "email", isDefault: true, contactId: "c2", archivedAt: null };
const CONTACT_KEYS: Record<string, unknown[]> = { c1: [anaKey, anaSecondKey], c2: [brunoKey] };
const PIX_SETUP = "/settings/payment-methods/new?returnTo=%2Fbillings%2Fnew&required=1";

type Sent = { path: string; init: RequestInit };

function api(handler: (path: string, init: RequestInit) => Response | undefined = () => undefined) {
  const sent: Sent[] = [];

  vi.mocked(browserFetch).mockImplementation(async (path, init = {}) => {
    sent.push({ path, init });

    const custom = handler(path, init);

    if (custom) {
      return custom;
    }

    if (path.startsWith("/api/contacts?search=")) {
      return Response.json({ contacts: [bruno], nextCursor: null });
    }

    if (path.startsWith("/api/contacts")) {
      return Response.json({ contacts: [ana], nextCursor: null });
    }

    const contactId = path.match(/payment-methods\?contactId=([^&]+)/)?.[1];

    if (contactId) {
      return Response.json({ paymentMethods: CONTACT_KEYS[contactId] ?? [] });
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

  render(<BillingFormScreen billing={billing} onSaved={onSaved} />);

  return { user: userEvent.setup(), onSaved };
}

/** Scopes a query to the Divisão card, since the footer summary can echo the same money text. */
function splitSection() {
  return within(screen.getByText("Divisão da Conta").closest("fieldset")!);
}

/** Contacts only enter through the agenda dialog: open it, tick Ana, close it. */
async function pickAna(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Adicionar" }));

  const panel = screen.getByRole("dialog", { name: "Contatos" });

  await user.click(await within(panel).findByRole("checkbox", { name: "Ana" }));
  await user.click(within(panel).getByRole("button", { name: "Concluir" }));
}

/** The counterpart seat opens its own dialog: Escolher (or Trocar), tick Ana, close it. */
async function seatAna(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: /Escolher|Trocar/ }));

  const panel = screen.getByRole("dialog", { name: "Contatos" });

  await user.click(await within(panel).findByRole("checkbox", { name: "Ana" }));
  await user.click(within(panel).getByRole("button", { name: "Concluir" }));
}

it("starts with only me on the split and adds contacts through the agenda dialog", async () => {
  const sent = api();
  const { user } = renderForm();

  expect(await screen.findByText("1 pessoa")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Ana/ })).not.toBeInTheDocument();
  expect(sent.some(entry => entry.path === "/api/contacts?sort=recent")).toBe(true);

  await pickAna(user);

  const chip = screen.getByRole("button", { name: "Ana" });

  expect(chip).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByText("2 pessoas")).toBeInTheDocument();

  await user.click(chip);

  expect(screen.queryByRole("button", { name: "Ana" })).not.toBeInTheDocument();
  expect(screen.getByText("1 pessoa")).toBeInTheDocument();
});

it("opens the contact panel and searches the whole agenda", async () => {
  const sent = api();
  const { user } = renderForm();

  await user.click(await screen.findByRole("button", { name: "Adicionar" }));

  const panel = screen.getByRole("dialog", { name: "Contatos" });

  await user.type(within(panel).getByLabelText("Buscar contatos"), "ma");

  expect(await within(panel).findByRole("checkbox", { name: "Bruno Lima" })).toBeInTheDocument();
  expect(sent.some(entry => entry.path === "/api/contacts?search=ma")).toBe(true);

  await user.click(within(panel).getByRole("checkbox", { name: "Bruno Lima" }));
  await user.click(within(panel).getByRole("button", { name: "Concluir" }));

  expect(screen.queryByRole("dialog", { name: "Contatos" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Bruno/ })).toHaveAttribute("aria-pressed", "true");
});

it("fills the title from the category select while it is empty", async () => {
  api();

  const { user } = renderForm();

  await user.click(await screen.findByRole("combobox", { name: "Categoria" }));
  await user.click(screen.getByRole("option", { name: "Alimentação" }));

  expect(screen.getByLabelText("Título")).toHaveValue("Alimentação");
  expect(screen.getByRole("combobox", { name: "Categoria" })).toHaveTextContent("Alimentação");
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
});

it("names the title field Título and drops the old Descrição copy", async () => {
  api();
  renderForm();

  const title = await screen.findByLabelText("Título");

  expect(title).toHaveAttribute("placeholder", "Ex: Aluguel do sítio, Pizzaria...");
  expect(screen.getByText("Título da conta")).toBeInTheDocument();
  expect(screen.queryByLabelText("Descrição")).not.toBeInTheDocument();
  expect(screen.queryByText(/Descrição/)).not.toBeInTheDocument();
});

it("types the amount like a bank keypad and posts the cents", async () => {
  const sent = api((_path, init) => (init.method === "POST" ? Response.json({ id: "b1", charges: [] }, { status: 201 }) : undefined));
  const { user } = renderForm();

  await pickAna(user);

  const amount = screen.getByLabelText("Valor total");

  expect(amount).toHaveValue("0,00");

  await user.type(amount, "1");

  expect(amount).toHaveValue("0,01");

  await user.type(amount, "00");

  expect(amount).toHaveValue("1,00");

  await user.type(amount, "{Backspace}");

  expect(amount).toHaveValue("0,10");

  await user.type(amount, "00");

  expect(amount).toHaveValue("10,00");

  await user.click(screen.getByRole("button", { name: "Criar conta" }));

  const post = sent.find(entry => entry.init.method === "POST");

  expect(JSON.parse(String(post?.init.body))).toMatchObject({ totalCents: 1_000 });
});

it("groups the thousands in the amount", async () => {
  api();

  const { user } = renderForm();

  const amount = await screen.findByLabelText("Valor total");

  await user.type(amount, "123456");

  expect(amount).toHaveValue("1.234,56");
});

it("keeps Criar conta disabled while the amount is still zero", async () => {
  api();
  renderForm();

  expect(await screen.findByRole("button", { name: "Criar conta" })).toBeDisabled();
  expect(screen.getByText("Automático")).toBeInTheDocument();
});

it("shows the installment field and keeps Valor total for a parcelado billing", async () => {
  api();

  const { user } = renderForm();

  await user.click(await screen.findByRole("radio", { name: "Parcelado" }));

  expect(screen.getByLabelText("Parcelas")).toBeInTheDocument();
  expect(screen.getByLabelText("Valor total")).toBeInTheDocument();

  await user.click(screen.getByRole("radio", { name: "Recorrente" }));

  expect(screen.getByLabelText("Valor por ocorrência")).toBeInTheDocument();
});

it("shows the per-installment helper below the typed total, with the rounded-up total once it does not divide evenly", async () => {
  api();

  const { user } = renderForm();

  await user.click(await screen.findByRole("radio", { name: "Parcelado" }));
  await user.clear(screen.getByLabelText("Parcelas"));
  await user.type(screen.getByLabelText("Parcelas"), "3");
  await user.type(screen.getByLabelText("Valor total"), "100,00");

  expect(screen.getByText("3x de R$ 33,34 · total R$ 100,02")).toBeInTheDocument();

  await user.clear(screen.getByLabelText("Valor total"));
  await user.type(screen.getByLabelText("Valor total"), "1.200,00");
  await user.clear(screen.getByLabelText("Parcelas"));
  await user.type(screen.getByLabelText("Parcelas"), "12");

  expect(screen.getByText("12x de R$ 100,00")).toBeInTheDocument();
});

it("posts the rounded-up per-installment amount for a parcelado billing", async () => {
  const sent = api((_path, init) => (init.method === "POST" ? Response.json({ id: "b1", charges: [] }, { status: 201 }) : undefined));
  const { user } = renderForm();

  await pickAna(user);
  await user.click(screen.getByRole("checkbox", { name: "Eu também participo" }));
  await user.click(screen.getByRole("radio", { name: "Parcelado" }));
  await user.clear(screen.getByLabelText("Parcelas"));
  await user.type(screen.getByLabelText("Parcelas"), "3");
  await user.type(screen.getByLabelText("Valor total"), "100,00");

  await user.click(screen.getByRole("button", { name: "Criar conta" }));

  const post = sent.find(entry => entry.init.method === "POST");

  expect(JSON.parse(String(post?.init.body))).toMatchObject({ totalCents: 3334 });
});

it("computes the live amount for each share row", async () => {
  api();

  const { user } = renderForm();

  await pickAna(user);
  await user.type(screen.getByLabelText("Valor total"), "100,00");
  await user.click(screen.getByRole("radio", { name: "Cotas" }));

  await user.clear(screen.getByLabelText("Cotas de Ana"));
  await user.type(screen.getByLabelText("Cotas de Ana"), "2");
  await user.clear(screen.getByLabelText("Cotas de Eu"));
  await user.type(screen.getByLabelText("Cotas de Eu"), "2");

  expect(splitSection().getAllByText("R$ 50,00")).toHaveLength(2);
  expect(screen.getByText("4 cotas no total")).toBeInTheDocument();
});

it("warns about the missing remainder on a fixed split when the owner does not participate", async () => {
  api();

  const { user } = renderForm();

  await pickAna(user);
  await user.type(screen.getByLabelText("Valor total"), "100,00");
  await user.click(screen.getByRole("checkbox", { name: "Eu também participo" }));
  await user.click(screen.getByRole("radio", { name: "Valor fixo" }));
  await user.type(screen.getByLabelText("Valor de Ana"), "40,00");

  expect(screen.getByText("Faltam R$ 60,00")).toBeInTheDocument();
});

it("shows the owner remainder as read-only text on a fixed split", async () => {
  api();

  const { user } = renderForm();

  await pickAna(user);
  await user.type(screen.getByLabelText("Valor total"), "100,00");
  await user.click(screen.getByRole("radio", { name: "Valor fixo" }));
  await user.type(screen.getByLabelText("Valor de Ana"), "60,00");

  expect(screen.getByText("Você fica com R$ 40,00")).toBeInTheDocument();
  expect(screen.queryByLabelText("Valor de Eu")).not.toBeInTheDocument();
  // The read-only remainder row above is the only place the owner's share shows up
  // inside the split card; the footer's own total is a separate, expected R$ 60,00.
  expect(splitSection().queryByText("R$ 60,00")).not.toBeInTheDocument();
  expect(screen.queryByText(/Faltam/)).not.toBeInTheDocument();
});

it("drops the owner remainder and warns when the fixed split exceeds the total", async () => {
  api();

  const { user } = renderForm();

  await pickAna(user);
  await user.type(screen.getByLabelText("Valor total"), "100,00");
  await user.click(screen.getByRole("radio", { name: "Valor fixo" }));
  await user.type(screen.getByLabelText("Valor de Ana"), "160,00");

  expect(screen.getByText("O rateio ultrapassa o total.")).toBeInTheDocument();
  expect(screen.queryByText(/Você fica com/)).not.toBeInTheDocument();
});

it("keeps each mode's split values while the user switches modes", async () => {
  const sent = api((_path, init) => (init.method === "POST" ? Response.json({ id: "b1", charges: [] }, { status: 201 }) : undefined));
  const { user } = renderForm();

  await pickAna(user);
  await user.type(screen.getByLabelText("Valor total"), "100,00");

  await user.click(screen.getByRole("radio", { name: "Valor fixo" }));
  await user.type(screen.getByLabelText("Valor de Ana"), "60,00");

  await user.click(screen.getByRole("radio", { name: "Porcentagem" }));

  expect(screen.getByLabelText("Porcentagem de Ana")).toHaveValue("");

  await user.click(screen.getByRole("radio", { name: "Valor fixo" }));

  expect(screen.getByLabelText("Valor de Ana")).toHaveValue("60,00");

  await user.click(screen.getByRole("radio", { name: "Cotas" }));
  await user.click(screen.getByRole("button", { name: "Criar conta" }));

  const post = sent.find(entry => entry.init.method === "POST");

  expect(JSON.parse(String(post?.init.body)).split).toEqual({
    mode: "shares",
    parts: [{ kind: "user", userId: "u1", shares: 1 }, { kind: "owner", shares: 1 }],
  });
});

it("sets the due date from the date field and brings it back to today with the quick button", async () => {
  api();

  const { user } = renderForm();

  const due = await screen.findByLabelText("Vencimento");

  await user.clear(due);
  await user.type(due, addCalendarDays(today(), 7));

  expect(due).toHaveValue(addCalendarDays(today(), 7));

  await user.click(screen.getByRole("button", { name: "Hoje" }));

  expect(due).toHaveValue(today());
});

it("lands the due date on the last day of the picked month with Final do mês", async () => {
  const sent = api((_path, init) => (init.method === "POST" ? Response.json({ id: "b1", charges: [] }, { status: 201 }) : undefined));
  const { user } = renderForm();

  await pickAna(user);
  await user.type(screen.getByLabelText("Valor total"), "100,00");
  await user.click(screen.getByRole("button", { name: "Final do mês" }));

  expect(screen.queryByLabelText("Vencimento")).not.toBeInTheDocument();

  const next = endOfMonthOptions(today(), 2)[1]!;

  await user.click(screen.getByRole("combobox", { name: "Mês do vencimento" }));
  await user.click(screen.getByRole("option", { name: new RegExp(next.label) }));
  await user.click(screen.getByRole("button", { name: "Criar conta" }));

  const post = sent.find(entry => entry.init.method === "POST");

  expect(JSON.parse(String(post?.init.body))).toMatchObject({ recurrence: "once", startDate: next.value, dueRule: "end_of_month" });
});

it("offers Final do mês only while the billing is once or monthly", async () => {
  api();

  const { user } = renderForm();

  expect(await screen.findByRole("button", { name: "Final do mês" })).toBeInTheDocument();

  await user.click(screen.getByRole("radio", { name: "Recorrente" }));
  await user.selectOptions(screen.getByLabelText("Frequência"), "yearly");

  expect(screen.queryByRole("button", { name: "Final do mês" })).not.toBeInTheDocument();
});

it("saves the draft and navigates when the user creates a new contact", async () => {
  api();

  const { user } = renderForm();

  await user.type(await screen.findByLabelText("Valor total"), "70,00");
  await user.click(screen.getByRole("button", { name: "Adicionar" }));
  await user.click(await screen.findByRole("button", { name: "+ Novo contato" }));

  expect(routerMock.push).toHaveBeenCalledWith("/contacts/new?returnTo=%2Fbillings%2Fnew");
  expect(JSON.parse(window.sessionStorage.getItem("receivy.billingDraft") ?? "{}")).toMatchObject({
    returnTo: "/billings/new",
    draft: { amount: "70,00" },
  });
});

it("saves the draft and navigates when the user registers a Pix key", async () => {
  api();

  const { user } = renderForm();

  await user.type(await screen.findByLabelText("Valor total"), "70,00");
  await user.click(screen.getByRole("button", { name: "Cadastrar chave" }));

  expect(routerMock.push).toHaveBeenCalledWith(PIX_SETUP);
  expect(window.sessionStorage.getItem("receivy.billingDraft")).toContain("70,00");
});

it("returns focus to Adicionar when the contact panel closes", async () => {
  api();

  const { user } = renderForm();

  const opener = await screen.findByRole("button", { name: "Adicionar" });

  await user.click(opener);

  expect(screen.getByLabelText("Buscar contatos")).toHaveFocus();

  await user.click(screen.getByRole("button", { name: "Concluir" }));

  expect(screen.queryByRole("dialog", { name: "Contatos" })).not.toBeInTheDocument();
  expect(document.activeElement).toBe(opener);
});

it("returns focus to Adicionar even when StrictMode runs the panel effects twice", async () => {
  api();

  const user = userEvent.setup();

  render(
    <StrictMode>
      <BillingFormScreen billing={null} onSaved={vi.fn()} />
    </StrictMode>,
  );

  const opener = await screen.findByRole("button", { name: "Adicionar" });

  await user.click(opener);
  await user.click(screen.getByRole("button", { name: "Concluir" }));

  expect(document.activeElement).toBe(opener);
});

it("closes the contact panel with Escape and gives the focus back", async () => {
  api();

  const { user } = renderForm();

  const opener = await screen.findByRole("button", { name: "Adicionar" });

  await user.click(opener);
  await user.keyboard("{Escape}");

  expect(screen.queryByRole("dialog", { name: "Contatos" })).not.toBeInTheDocument();
  expect(document.activeElement).toBe(opener);
});

it("restores the stored draft when the form mounts", async () => {
  api();
  saveDraft({ ...EMPTY_BILLING_DRAFT(TIMEZONE, today()), selected: ["u1"], amount: "80,00", pix: "pix-1" }, "/billings/new");
  renderForm();

  expect(await screen.findByLabelText("Valor total")).toHaveValue("80,00");
  expect(screen.getByRole("button", { name: /Ana/ })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: /E-mail/ })).toHaveTextContent("Meio padrão");
  expect(window.sessionStorage.getItem("receivy.billingDraft")).toBeNull();
});

it("keeps the restored draft when StrictMode runs the mount effect twice", async () => {
  api();
  saveDraft({ ...EMPTY_BILLING_DRAFT(TIMEZONE, today()), selected: ["u1"], amount: "80,00" }, "/billings/new");

  render(
    <StrictMode>
      <BillingFormScreen billing={null} onSaved={vi.fn()} />
    </StrictMode>,
  );

  expect(await screen.findByLabelText("Valor total")).toHaveValue("80,00");
  expect(screen.getByRole("button", { name: /Ana/ })).toHaveAttribute("aria-pressed", "true");
});

it("creates the billing in one step, with category, shares and an idempotency key", async () => {
  const sent = api((_path, init) => (init.method === "POST" ? Response.json({ id: "b1", charges: [{ id: "c1" }] }, { status: 201 }) : undefined));
  const { user, onSaved } = renderForm();

  await pickAna(user);
  await user.type(screen.getByLabelText("Valor total"), "100,00");
  await user.click(screen.getByRole("combobox", { name: "Categoria" }));
  await user.click(screen.getByRole("option", { name: "Alimentação" }));
  await user.click(screen.getByRole("radio", { name: "Cotas" }));

  expect(screen.queryByRole("button", { name: /Revisar/ })).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Criar conta" }));

  const post = sent.find(entry => entry.init.method === "POST");

  expect(post?.path).toBe("/api/financial/billings");
  expect(JSON.parse(String(post?.init.body))).toMatchObject({
    recurrence: "once",
    totalCents: 10_000,
    category: "food",
    description: "Alimentação",
    timezone: TIMEZONE,
    split: { mode: "shares", parts: [{ kind: "user", userId: "u1", shares: 1 }, { kind: "owner", shares: 1 }] },
  });
  expect((post?.init.headers as Record<string, string>)["idempotency-key"]).toMatch(/\w/);
  expect(onSaved).toHaveBeenCalledWith({ id: "b1", charges: [{ id: "c1" }] });
  // Clearing it here would flash the button back to idle while this screen is still on top.
  expect(screen.getByRole("button", { name: "Criar conta" })).toBeDisabled();
});

it("opens the paywall on a plan limit and keeps the draft instead of clearing it", async () => {
  const sent = api((_path, init) =>
    init.method === "POST"
      ? Response.json(
          { message: "Você já tem 5 cobranças indefinidas ativas no plano Grátis.", context: { code: "PLAN_LIMIT_REACHED", fields: { limit: "5", used: "5", plan: "free" } } },
          { status: 402 },
        )
      : undefined,
  );
  const { user, onSaved } = renderForm();

  await pickAna(user);
  await user.type(screen.getByLabelText("Valor total"), "100,00");
  await user.click(screen.getByRole("button", { name: "Criar conta" }));

  expect(await screen.findByRole("dialog", { name: "Plano Básico" })).toBeInTheDocument();
  expect(screen.getByText("Você já tem 5 cobranças indefinidas ativas no plano Grátis.")).toBeInTheDocument();
  expect(screen.getByLabelText("Valor total")).toHaveValue("100,00");
  expect(onSaved).not.toHaveBeenCalled();
  expect(sent.some(entry => entry.init.method === "POST")).toBe(true);
});

it("keeps the payload and the idempotency key across an uncertain retry", async () => {
  let attempts = 0;
  const sent = api((_path, init) => {
    if (init.method !== "POST") {
      return undefined;
    }

    attempts += 1;

    return attempts === 1
      ? Response.json({ type: "error", message: "lost" }, { status: 503 })
      : Response.json({ id: "b1", charges: [] }, { status: 201 });
  });
  const { user } = renderForm();

  await pickAna(user);
  await user.type(screen.getByLabelText("Valor total"), "100,00");
  await user.type(screen.getByLabelText("Título"), "Jantar");
  await user.click(screen.getByRole("button", { name: "Criar conta" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível salvar. Tente novamente.");

  await user.click(screen.getByRole("button", { name: "Tentar novamente" }));

  const posts = sent.filter(entry => entry.init.method === "POST");

  expect(posts[1]?.init.body).toBe(posts[0]?.init.body);
  expect(posts[1]?.init.headers).toEqual(posts[0]?.init.headers);
});

it("shows the validation error inline when no contact is selected", async () => {
  api();

  const { user } = renderForm();

  await user.type(await screen.findByLabelText("Valor total"), "100,00");
  await user.click(screen.getByRole("button", { name: "Criar conta" }));

  expect(screen.getByRole("alert")).toHaveTextContent("Selecione ao menos um contato.");
});

it("sends Não notificar on the participant it was switched for", async () => {
  const sent = api((_path, init) => (init.method === "POST" ? Response.json({ id: "b1", charges: [] }, { status: 201 }) : undefined));
  const { user } = renderForm();

  await pickAna(user);
  await user.type(screen.getByLabelText("Valor total"), "100,00");

  const quiet = screen.getByRole("switch", { name: "Não notificar Ana" });

  expect(quiet).not.toBeChecked();
  expect(screen.getByText("Sem avisos automáticos para esta pessoa. Você ainda pode lembrar manualmente.")).toBeInTheDocument();

  await user.click(quiet);
  await user.click(screen.getByRole("button", { name: "Criar conta" }));

  const post = sent.find(entry => entry.init.method === "POST");

  expect(JSON.parse(String(post?.init.body)).split).toEqual({
    mode: "equal",
    parts: [{ kind: "user", userId: "u1", notify: false }, { kind: "owner" }],
  });
});

it("offers Não notificar only on a conta a receber", async () => {
  api();

  const { user } = renderForm();

  await pickAna(user);

  expect(screen.getByRole("switch", { name: "Não notificar Ana" })).toBeInTheDocument();
  expect(screen.getByText("Sem avisos automáticos para esta pessoa. Você ainda pode lembrar manualmente.")).toBeInTheDocument();

  await user.click(screen.getByRole("radio", { name: "Vou pagar" }));

  expect(screen.queryByRole("switch", { name: "Não notificar Ana" })).not.toBeInTheDocument();
  expect(screen.queryByText("Sem avisos automáticos para esta pessoa. Você ainda pode lembrar manualmente.")).not.toBeInTheDocument();
});

it("renders Não notificar only for a participant who can actually be reached", async () => {
  api((path) => (path.startsWith("/api/contacts") && !path.includes("search") ? Response.json({ contacts: [ana, carla], nextCursor: null }) : undefined));

  const { user } = renderForm();

  await user.click(await screen.findByRole("button", { name: "Adicionar" }));

  const panel = screen.getByRole("dialog", { name: "Contatos" });

  await user.click(await within(panel).findByRole("checkbox", { name: "Ana" }));
  await user.click(within(panel).getByRole("checkbox", { name: "Carla" }));
  await user.click(within(panel).getByRole("button", { name: "Concluir" }));

  expect(screen.getByRole("switch", { name: "Não notificar Ana" })).toBeInTheDocument();
  expect(screen.queryByRole("switch", { name: "Não notificar Carla" })).not.toBeInTheDocument();
  expect(screen.getByText("Sem avisos automáticos para esta pessoa. Você ainda pode lembrar manualmente.")).toBeInTheDocument();
});

it("hides the Não notificar helper entirely when no selected participant can be reached", async () => {
  api((path) => (path.startsWith("/api/contacts") && !path.includes("search") ? Response.json({ contacts: [carla], nextCursor: null }) : undefined));

  const { user } = renderForm();

  await user.click(await screen.findByRole("button", { name: "Adicionar" }));

  const panel = screen.getByRole("dialog", { name: "Contatos" });

  await user.click(await within(panel).findByRole("checkbox", { name: "Carla" }));
  await user.click(within(panel).getByRole("button", { name: "Concluir" }));

  expect(screen.queryByRole("switch", { name: "Não notificar Carla" })).not.toBeInTheDocument();
  expect(screen.queryByText("Sem avisos automáticos para esta pessoa. Você ainda pode lembrar manualmente.")).not.toBeInTheDocument();
});

it("never sends a stale Não notificar for a participant the agenda no longer shows as reachable", async () => {
  const quietBilling: BillingDetail = {
    ...indefiniteBilling,
    id: "b6",
    allocations: [{ kind: SplitPartKind.User, userId: "u3", splitMode: SplitMode.Equal, amount: { amountCents: 9_000, currency: "BRL" }, order: 0, notify: false }],
    split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: "u3" }] },
  };
  const sent = api((path, init) => {
    if (init.method === "PATCH") {
      return Response.json(quietBilling);
    }

    if (path.startsWith("/api/contacts") && !path.includes("search")) {
      return Response.json({ contacts: [carla], nextCursor: null });
    }

    return undefined;
  });
  const { user } = renderForm(quietBilling);

  await screen.findByRole("button", { name: "Salvar conta" });

  expect(screen.queryByRole("switch", { name: /Não notificar/ })).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Salvar conta" }));

  const patch = sent.find(entry => entry.init.method === "PATCH");

  expect(JSON.parse(String(patch?.init.body)).split).toEqual({ mode: "equal", parts: [{ kind: "user", userId: "u3" }] });
});

it("records a registro naming the single contact who paid it, with nobody to split with or pay through", async () => {
  const sent = api((_path, init) => (init.method === "POST" ? Response.json({ id: "b1", charges: [] }, { status: 201 }) : undefined));
  const { user } = renderForm();

  await user.click(await screen.findByRole("switch", { name: "Já recebi" }));

  expect(screen.getByText("Registro já quitado: ninguém recebe aviso. Cada ocorrência fica paga no vencimento.")).toBeInTheDocument();
  expect(screen.queryByText("Participantes")).not.toBeInTheDocument();
  expect(screen.queryByText("Divisão da Conta")).not.toBeInTheDocument();
  expect(screen.queryByText("Receber por")).not.toBeInTheDocument();
  expect(screen.getByText("De quem")).toBeInTheDocument();
  expect(screen.getByText("Escolha quem pagou.")).toBeInTheDocument();

  await seatAna(user);
  await user.type(screen.getByLabelText("Valor total"), "5000,00");
  await user.click(screen.getByRole("button", { name: "Criar conta" }));

  const post = sent.find(entry => entry.init.method === "POST");
  const body = JSON.parse(String(post?.init.body));

  expect(body).not.toHaveProperty("type");
  expect(body).toMatchObject({
    kind: "record",
    totalCents: 500_000,
    split: { mode: "equal", parts: [{ kind: "user", userId: "u1" }] },
  });
  expect(body.counterpartLabel).toBeUndefined();
  expect(body.reminders).toBeUndefined();
  expect(body.paymentMethodId).toBeUndefined();
});

it("refuses a registro a receber that names nobody who paid it", async () => {
  const sent = api((_path, init) => (init.method === "POST" ? Response.json({ id: "b1", charges: [] }, { status: 201 }) : undefined));
  const { user } = renderForm();

  await user.click(await screen.findByRole("switch", { name: "Já recebi" }));
  await user.type(screen.getByLabelText("Valor total"), "5000,00");
  await user.click(screen.getByRole("button", { name: "Criar conta" }));

  expect(screen.getByRole("alert")).toHaveTextContent("Escolha quem pagou.");
  expect(sent.some(entry => entry.init.method === "POST")).toBe(false);
});

it("seats a registro a pagar under Para quem and keeps a recorrente from starting before today", async () => {
  const sent = api((_path, init) => (init.method === "POST" ? Response.json({ id: "b1", charges: [] }, { status: 201 }) : undefined));
  const { user } = renderForm();

  await user.click(await screen.findByRole("switch", { name: "Já recebi" }));
  await user.click(screen.getByRole("radio", { name: "Vou pagar" }));

  expect(screen.getByRole("switch", { name: "Já paguei" })).toBeChecked();
  expect(screen.getByText("Para quem")).toBeInTheDocument();
  expect(screen.queryByText("Chave Pix (opcional)")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Vencimento")).not.toHaveAttribute("min");

  await seatAna(user);
  await user.type(screen.getByLabelText("Valor total"), "5000,00");
  await user.click(screen.getByRole("button", { name: "Criar conta" }));

  expect(JSON.parse(String(sent.find(entry => entry.init.method === "POST")?.init.body))).toMatchObject({
    kind: "record",
    contactId: "c1",
  });
});

it("keeps a recorrente registro from starting before today", async () => {
  api();

  const { user } = renderForm();

  await user.click(await screen.findByRole("switch", { name: "Já recebi" }));
  await user.click(screen.getByRole("radio", { name: "Recorrente" }));

  expect(screen.getByLabelText("Vencimento")).toHaveAttribute("min", today());
});

function withoutPixKeys() {
  return api(path => (path.includes("payment-methods") ? Response.json({ paymentMethods: [] }) : undefined));
}

it("hides the form behind a single call to action when the account has no key", async () => {
  withoutPixKeys();

  const { user } = renderForm();

  expect(await screen.findByText("Cadastre um meio de pagamento")).toBeInTheDocument();
  expect(routerMock.push).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Criar conta" })).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Valor total")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Cadastrar meio de pagamento" }));

  expect(routerMock.push).toHaveBeenCalledWith(PIX_SETUP);
  expect(window.sessionStorage.getItem("receivy.billingDraft")).toContain('"direction":"receivable"');
});

it("keeps the form open for a conta a pagar even without a key", async () => {
  withoutPixKeys();

  const { user } = renderForm();

  await user.click(await screen.findByRole("radio", { name: "Vou pagar" }));

  expect(screen.queryByText("Cadastre um meio de pagamento")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Criar conta" })).toBeInTheDocument();
});

it("opens the form of a registro a receber even without a key", async () => {
  withoutPixKeys();

  const { user } = renderForm();

  expect(await screen.findByText("Cadastre um meio de pagamento")).toBeInTheDocument();

  await user.click(screen.getByRole("switch", { name: "Já recebi" }));

  expect(screen.queryByText("Cadastre um meio de pagamento")).not.toBeInTheDocument();
  expect(screen.getByText("De quem")).toBeInTheDocument();
});

it("never gates the form once a key exists", async () => {
  api();
  renderForm();

  expect(await screen.findByRole("button", { name: /E-mail/ })).toBeInTheDocument();
  expect(screen.queryByText("Cadastre um meio de pagamento")).not.toBeInTheDocument();
  expect(routerMock.push).not.toHaveBeenCalled();
});

it("creates a conta a pagar without participants, naming the contact who receives and one of their keys", async () => {
  const sent = api((_path, init) => (init.method === "POST" ? Response.json({ id: "b1", charges: [] }, { status: 201 }) : undefined));
  const { user } = renderForm();

  await user.click(await screen.findByRole("radio", { name: "Vou pagar" }));

  expect(screen.queryByText("Participantes")).not.toBeInTheDocument();
  expect(screen.queryByText("Divisão da Conta")).not.toBeInTheDocument();
  expect(screen.queryByText("Receber por")).not.toBeInTheDocument();
  expect(screen.getByText("Para quem")).toBeInTheDocument();
  // The key is no longer typed here: it belongs to the contact.
  expect(screen.queryByRole("radiogroup", { name: "Tipo de chave" })).not.toBeInTheDocument();
  expect(screen.queryByLabelText("E-mail Pix")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Apelido da chave (opcional)")).not.toBeInTheDocument();

  await seatAna(user);

  expect(screen.getByRole("button", { name: "Ana" })).toHaveAttribute("aria-pressed", "true");
  // The seated contact's default key comes preselected.
  expect(await screen.findByText("Pagar via Pix")).toBeInTheDocument();
  expect(sent.some(entry => entry.path === "/api/financial/payment-methods?contactId=c1")).toBe(true);

  await vi.waitFor(() => expect(screen.getByRole("button", { name: /E-mail/ })).toHaveTextContent("Meio padrão"));

  await user.type(screen.getByLabelText("Valor total"), "100,00");
  await user.click(screen.getByRole("button", { name: "Criar conta" }));

  const post = sent.find(entry => entry.init.method === "POST");
  const body = JSON.parse(String(post?.init.body));

  expect(body).not.toHaveProperty("type");
  expect(body).toMatchObject({
    totalCents: 10_000,
    contactId: "c1",
    paymentMethodId: "pix-ana",
  });
  expect(body.pix).toBeUndefined();
  expect(body.payeeUserId).toBeUndefined();
});

it("switches the conta a pagar to another key of the same contact", async () => {
  const sent = api((_path, init) => (init.method === "POST" ? Response.json({ id: "b1", charges: [] }, { status: 201 }) : undefined));
  const { user } = renderForm();

  await user.click(await screen.findByRole("radio", { name: "Vou pagar" }));
  await seatAna(user);

  await user.click(await screen.findByRole("button", { name: /E-mail/ }));
  await user.click(within(screen.getByRole("listbox", { name: "Meio de pagamento" })).getByRole("button", { name: /CPF/ }));

  await user.type(screen.getByLabelText("Valor total"), "100,00");
  await user.click(screen.getByRole("button", { name: "Criar conta" }));

  expect(JSON.parse(String(sent.find(entry => entry.init.method === "POST")?.init.body))).toMatchObject({ paymentMethodId: "pix-ana-2" });
});

it("resets the key to the wallet default when the direction flips back from a conta a pagar", async () => {
  const sent = api((_path, init) => (init.method === "POST" ? Response.json({ id: "b1", charges: [] }, { status: 201 }) : undefined));
  const { user } = renderForm();

  await user.click(await screen.findByRole("radio", { name: "Vou pagar" }));
  await seatAna(user);
  // The seated contact's default key lands before the flip.
  await vi.waitFor(() => expect(screen.getByRole("button", { name: /E-mail/ })).toHaveTextContent("Meio padrão"));

  await user.click(await screen.findByRole("radio", { name: "Vou receber" }));
  await pickAna(user);

  await user.type(screen.getByLabelText("Valor total"), "100,00");
  await user.click(screen.getByRole("button", { name: "Criar conta" }));

  const body = JSON.parse(String(sent.find(entry => entry.init.method === "POST")?.init.body));

  // Ana's key travelled from "Vou pagar" must never pay this conta a receber; the wallet default does.
  expect(body.paymentMethodId).toBe("pix-1");
});

it("re-picks the default key when the receiving seat moves to another contact", async () => {
  const sent = api((_path, init) => (init.method === "POST" ? Response.json({ id: "b1", charges: [] }, { status: 201 }) : undefined));
  const { user } = renderForm();

  await user.click(await screen.findByRole("radio", { name: "Vou pagar" }));
  await seatAna(user);

  await vi.waitFor(() => expect(screen.getByRole("button", { name: /E-mail/ })).toHaveTextContent("Meio padrão"));

  await user.click(screen.getByRole("button", { name: /Trocar/ }));

  const panel = screen.getByRole("dialog", { name: "Contatos" });

  await user.type(within(panel).getByLabelText("Buscar contatos"), "ma");
  await user.click(await within(panel).findByRole("checkbox", { name: "Bruno Lima" }));
  await user.click(within(panel).getByRole("button", { name: "Concluir" }));

  await vi.waitFor(() => expect(sent.some(entry => entry.path === "/api/financial/payment-methods?contactId=c2")).toBe(true));

  await user.type(screen.getByLabelText("Valor total"), "100,00");
  await user.click(screen.getByRole("button", { name: "Criar conta" }));

  expect(JSON.parse(String(sent.find(entry => entry.init.method === "POST")?.init.body))).toMatchObject({ contactId: "c2", paymentMethodId: "pix-bruno" });
});

it("points at the contact form when the seated contact has no Pix key yet", async () => {
  const sent = api(path => (path.includes("payment-methods?contactId=") ? Response.json({ paymentMethods: [] }) : undefined));
  const { user } = renderForm();

  await user.click(await screen.findByRole("radio", { name: "Vou pagar" }));
  await seatAna(user);

  expect(await screen.findByText("Este contato ainda não tem chave Pix. Cadastre no contato.")).toBeInTheDocument();

  await user.type(screen.getByLabelText("Valor total"), "100,00");
  await user.click(screen.getByRole("button", { name: "Cadastrar chave" }));

  expect(routerMock.push).toHaveBeenCalledWith("/contacts/c1/edit?returnTo=%2Fbillings%2Fnew");
  expect(window.sessionStorage.getItem("receivy.billingDraft")).toContain("100,00");
  expect(sent.some(entry => entry.init.method === "POST")).toBe(false);
});

it("sends a conta a pagar with no key at all when the contact has none", async () => {
  const sent = api((path, init) => {
    if (path.includes("payment-methods?contactId=")) {
      return Response.json({ paymentMethods: [] });
    }

    return init.method === "POST" ? Response.json({ id: "b1", charges: [] }, { status: 201 }) : undefined;
  });
  const { user } = renderForm();

  await user.click(await screen.findByRole("radio", { name: "Vou pagar" }));
  await seatAna(user);
  await screen.findByText("Este contato ainda não tem chave Pix. Cadastre no contato.");

  await user.type(screen.getByLabelText("Valor total"), "100,00");
  await user.click(screen.getByRole("button", { name: "Criar conta" }));

  const body = JSON.parse(String(sent.find(entry => entry.init.method === "POST")?.init.body));

  expect(body).toMatchObject({ contactId: "c1" });
  expect(body.paymentMethodId).toBeUndefined();
});

it("refuses a conta a pagar whose receiving chip was removed", async () => {
  const sent = api((_path, init) => (init.method === "POST" ? Response.json({ id: "b1", charges: [] }, { status: 201 }) : undefined));

  saveDraft({ ...EMPTY_BILLING_DRAFT(TIMEZONE, today()), direction: Direction.Payable, payee: "c1", amount: "50,00" }, "/billings/new");

  const { user } = renderForm();

  await user.click(await screen.findByRole("button", { name: "Ana" }));

  expect(screen.queryByRole("button", { name: "Ana" })).not.toBeInTheDocument();
  expect(screen.getByText("Escolha quem recebe.")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Criar conta" }));

  expect(screen.getByRole("alert")).toHaveTextContent("Escolha quem recebe.");
  expect(sent.some(entry => entry.init.method === "POST")).toBe(false);
});

it("never gates a conta a pagar on a wallet key", async () => {
  withoutPixKeys();
  saveDraft({ ...EMPTY_BILLING_DRAFT(TIMEZONE, today()), direction: Direction.Payable, amount: "70,00" }, "/billings/new");
  renderForm();

  expect(await screen.findByLabelText("Valor total")).toHaveValue("70,00");
  expect(screen.queryByText("Cadastre uma chave Pix para criar cobranças.")).not.toBeInTheDocument();
  expect(routerMock.push).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Criar conta" })).toBeEnabled();
});

it("never offers a Pix selector on a conta a pagar with no seated contact", async () => {
  api();

  const { user } = renderForm();

  await user.click(await screen.findByRole("radio", { name: "Vou pagar" }));

  expect(screen.queryByText("Pagar via Pix")).not.toBeInTheDocument();
  expect(screen.getByText("Escolha quem recebe.")).toBeInTheDocument();
});

const emailReminder: ReminderRule = { offsetDays: -3, enabled: true, channels: { email: true, whatsapp: false } };

const onceBilling: BillingDetail = {
  id: "b1",
  recurrence: BillingRecurrence.Once,
  type: Direction.Receivable,
  contact: null,
  counterpart: null,
  pix: null,
  description: "Jantar",
  total: { amountCents: 9_000, currency: "BRL" },
  startDate: "2026-10-31",
  state: BillingState.Active,
  nextDueDate: "2026-10-31",
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
  timezone: TIMEZONE,
  paymentMethodId: "pix-1",
  reminders: [emailReminder],
  effectiveReminders: [emailReminder],
  split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: "u1" }] },
  allocations: [],
  charges: [],
  previews: [],
  category: BillingCategory.Other,
  invite: null,
  guests: [],
  linkableContacts: [],
};

it("freezes a finite billing and patches only category, Pix and reminders", async () => {
  const sent = api((_path, init) => (init.method === "PATCH" ? Response.json(onceBilling) : undefined));
  const { user } = renderForm(onceBilling);

  expect(await screen.findByRole("button", { name: /E-mail/ })).toBeInTheDocument();
  expect(screen.getByText("Contas já geradas só permitem categoria, Pix e lembretes.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Salvar conta" })).toBeInTheDocument();
  expect(screen.getByLabelText("Título")).toBeDisabled();
  expect(screen.getByLabelText("Valor total")).toBeDisabled();
  expect(screen.getByLabelText("Vencimento")).toBeDisabled();
  expect(screen.getByRole("radio", { name: "Parcelado" })).toBeDisabled();

  await user.click(screen.getByRole("button", { name: "Salvar conta" }));

  const patch = sent.find(entry => entry.init.method === "PATCH");

  expect(patch?.path).toBe("/api/financial/billings/b1");
  expect(JSON.parse(String(patch?.init.body))).toEqual({
    paymentMethodId: "pix-1",
    clearPaymentMethod: false,
    reminders: [emailReminder],
    category: "other",
  });
});

let reminderSent: Sent[] = [];

/** Same fetch-mock arrangement as `api()`, over a receivable billing whose reminders and effective reminders are given. */
function arrangeBilling(overrides: { reminders: ReminderRule[] | null; effectiveReminders: ReminderRule[] }): BillingDetail {
  const billing: BillingDetail = { ...onceBilling, reminders: overrides.reminders, effectiveReminders: overrides.effectiveReminders };

  reminderSent = api((_path, init) => (init.method === "PATCH" ? Response.json(billing) : undefined));

  return billing;
}

function lastPatchBody(): BillingPatch {
  const patch = reminderSent.find(entry => entry.init.method === "PATCH");

  return JSON.parse(String(patch?.init.body)) as BillingPatch;
}

it("shows the inherited default and only sends reminders after customising", async () => {
  const billing = arrangeBilling({ reminders: null, effectiveReminders: [{ offsetDays: 0, enabled: true, channels: { email: true, whatsapp: false } }] });
  const { user } = renderForm(billing);

  expect(await screen.findByText("Usando seu padrão: no dia (e-mail)")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Salvar conta" }));

  const patch = lastPatchBody();

  expect(patch.reminders).toBeUndefined();
  expect(patch.clearReminders).toBeUndefined();
});

it("customises, sends the rules, and clears back to the default", async () => {
  const billing = arrangeBilling({
    reminders: [{ offsetDays: 3, enabled: true, channels: { email: true, whatsapp: false } }],
    effectiveReminders: [{ offsetDays: 3, enabled: true, channels: { email: true, whatsapp: false } }],
  });
  const { user } = renderForm(billing);

  expect(await screen.findByRole("button", { name: "Quando avisar no lembrete 1" })).toHaveTextContent("3 dias depois");

  await user.click(screen.getByRole("button", { name: "Voltar ao padrão" }));
  await user.click(screen.getByRole("button", { name: "Salvar conta" }));

  expect(lastPatchBody().clearReminders).toBe(true);
});

const untilBilling: BillingDetail = { ...onceBilling, id: "b5", recurrence: BillingRecurrence.Until, endDate: "2026-12-31", installmentCount: 3, total: { amountCents: 3_334, currency: "BRL" } };

it("seeds the amount of a parcelado billing as its total, per-installment × installments", async () => {
  api();
  renderForm(untilBilling);

  expect(await screen.findByLabelText("Valor total")).toHaveValue("100,02");
});

const payableBilling: BillingDetail = {
  ...onceBilling,
  id: "b3",
  type: Direction.Payable,
  paymentMethodId: "pix-ana-2",
  contact: { id: "c1", userId: "u1", name: "Ana", avatar: null },
  pix: { keyType: PixKeyType.Cpf, key: "52998224725", label: "Itaú da Ana" },
};

it("seeds a conta a pagar with its receiving contact and its key, and patches the key back", async () => {
  const sent = api((_path, init) => (init.method === "PATCH" ? Response.json(payableBilling) : undefined));
  const { user } = renderForm(payableBilling);

  expect(await screen.findByRole("button", { name: "Ana" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("radio", { name: "Vou pagar" })).toBeChecked();
  expect(screen.getByRole("radio", { name: "Vou pagar" })).toBeDisabled();
  // The seeded key survives the contact's key list landing: it is one of them.
  expect(await screen.findByRole("button", { name: /CPF/ })).toHaveTextContent("Meio secundário");
  expect(screen.queryByLabelText("E-mail Pix")).not.toBeInTheDocument();
  expect(screen.queryByText("Participantes")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Salvar conta" }));

  const patch = sent.find(entry => entry.init.method === "PATCH");
  const body = JSON.parse(String(patch?.init.body));

  expect(patch?.path).toBe("/api/financial/billings/b3");
  expect(body).toMatchObject({
    paymentMethodId: "pix-ana-2",
    clearPaymentMethod: false,
    reminders: [emailReminder],
    category: "other",
  });
  // The seat did not move, so the patch leaves the receiving contact alone.
  expect(body.contactId).toBeUndefined();
  expect(body.pix).toBeUndefined();
  expect(body.payeeUserId).toBeUndefined();
});

it("clears the key of a conta a pagar whose contact has none left", async () => {
  const sent = api((path, init) => {
    if (path.includes("payment-methods?contactId=")) {
      return Response.json({ paymentMethods: [] });
    }

    return init.method === "PATCH" ? Response.json(payableBilling) : undefined;
  });
  const { user } = renderForm(payableBilling);

  expect(await screen.findByText("Este contato ainda não tem chave Pix. Cadastre no contato.")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Salvar conta" }));

  expect(JSON.parse(String(sent.find(entry => entry.init.method === "PATCH")?.init.body))).toMatchObject({ clearPaymentMethod: true });
});

it("asks for the scope when the key of a recorrente conta a pagar moves to another of the contact's", async () => {
  onSeptemberTenth();

  const recurringPayable: BillingDetail = {
    ...payableBilling,
    id: "b9",
    recurrence: BillingRecurrence.Indefinite,
    frequency: BillingFrequency.Monthly,
    nextDueDate: null,
    startDate: "2026-09-20",
    charges: [{ ...monthCharge, billingId: "b9", direction: Direction.Payable }],
  };
  const sent = api((_path, init) => (init.method === "PATCH" ? Response.json(recurringPayable) : undefined));
  const { user } = renderForm(recurringPayable);

  await user.click(await screen.findByRole("button", { name: /CPF/ }));
  await user.click(within(screen.getByRole("listbox", { name: "Meio de pagamento" })).getByRole("button", { name: /E-mail/ }));
  await user.click(screen.getByRole("button", { name: "Salvar conta" }));

  const dialog = await screen.findByRole("dialog", { name: "Aplicar às cobranças deste mês?" });

  expect(sent.some(entry => entry.init.method === "PATCH")).toBe(false);

  await user.click(within(dialog).getByRole("button", { name: "Aplicar também às deste mês" }));

  expect(JSON.parse(String(sent.find(entry => entry.init.method === "PATCH")?.init.body))).toMatchObject({ paymentMethodId: "pix-ana", applyTo: "current_month" });
});

it("names the seated contact from the loaded billing when the agenda no longer lists them", async () => {
  const archived: BillingDetail = { ...payableBilling, id: "b8", contact: { id: "c9", userId: "u9", name: "Padaria", avatar: null } };

  api(() => undefined);
  renderForm(archived);

  expect(await screen.findByRole("button", { name: "Padaria" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Contato" })).not.toBeInTheDocument();
});

it("patches the receiving contact of a conta a pagar once the seat moves", async () => {
  const openPayable: BillingDetail = { ...payableBilling, id: "b7", recurrence: BillingRecurrence.Indefinite, frequency: BillingFrequency.Monthly, nextDueDate: null };
  const sent = api((_path, init) => (init.method === "PATCH" ? Response.json(openPayable) : undefined));
  const { user } = renderForm(openPayable);

  await user.click(await screen.findByRole("button", { name: "Trocar" }));

  const panel = screen.getByRole("dialog", { name: "Contatos" });

  await user.type(within(panel).getByLabelText("Buscar contatos"), "ma");
  await user.click(await within(panel).findByRole("checkbox", { name: "Bruno Lima" }));
  await user.click(within(panel).getByRole("button", { name: "Concluir" }));

  expect(screen.getByRole("button", { name: "Bruno Lima" })).toHaveAttribute("aria-pressed", "true");

  await vi.waitFor(() => expect(sent.some(entry => entry.path === "/api/financial/payment-methods?contactId=c2")).toBe(true));

  await user.click(screen.getByRole("button", { name: "Salvar conta" }));

  // The old contact's key cannot pay the new one: the patch carries the new contact's default.
  expect(JSON.parse(String(sent.find(entry => entry.init.method === "PATCH")?.init.body))).toMatchObject({ contactId: "c2", paymentMethodId: "pix-bruno" });
});

const indefiniteBilling: BillingDetail = { ...onceBilling, id: "b2", recurrence: BillingRecurrence.Indefinite, frequency: BillingFrequency.Monthly, nextDueDate: null };

it("keeps the schedule read-only while editing an open-ended billing", async () => {
  api();
  renderForm(indefiniteBilling);

  expect(await screen.findByRole("button", { name: /E-mail/ })).toBeInTheDocument();
  expect(screen.getByRole("radio", { name: "Parcelado" })).toBeDisabled();
  expect(screen.getByLabelText("Frequência")).toBeDisabled();
  // An assinatura may move its next due date; only the modality and frequency stay frozen.
  expect(screen.getByLabelText("Vencimento")).toBeEnabled();
  expect(screen.getByRole("button", { name: "Hoje" })).toBeEnabled();
  expect(screen.getByText("Próximo vencimento")).toBeInTheDocument();

  expect(screen.getByLabelText("Valor por ocorrência")).toBeEnabled();
  expect(screen.getByLabelText("Título")).toBeEnabled();
  expect(screen.getByRole("radio", { name: "Cotas" })).toBeEnabled();
  expect(screen.queryByText("Contas já geradas só permitem categoria, Pix e lembretes.")).not.toBeInTheDocument();
});

it("switches an open-ended billing to the end of the month on edit", async () => {
  const sent = api((_path, init) => (init.method === "PATCH" ? Response.json(indefiniteBilling) : undefined));
  const { user } = renderForm(indefiniteBilling);

  expect(await screen.findByRole("button", { name: /E-mail/ })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Final do mês" }));
  await user.click(screen.getByRole("button", { name: "Salvar conta" }));

  const start = indefiniteBilling.startDate >= today() ? indefiniteBilling.startDate : today();
  const patch = sent.find(entry => entry.init.method === "PATCH");

  expect(JSON.parse(String(patch?.init.body))).toMatchObject({ dueRule: "end_of_month", startDate: endOfMonth(start) });
});

const monthCharge: ChargeDetail = {
  id: "c9",
  description: "Jantar",
  amount: { amountCents: 9_000, currency: "BRL" },
  dueDate: "2026-09-20",
  state: ChargeState.Pending,
  billingId: "b2",
  recurrence: BillingRecurrence.Indefinite,
  installment: null,
  installmentCount: null,
  counterpartName: "Ana",
  proofState: null,
  direction: Direction.Receivable,
  recipient: { userId: "u1", name: "Ana", email: null },
  debtorId: "u1",
  payment: null,
  paymentLink: null,
  receiptUrl: null,
  sharingState: SharingState.Ready,
  proof: null,
  cancelledAt: null,
  paidAt: null,
  createdAt: "2026-09-01T00:00:00Z",
};

const recurringWithCharge: BillingDetail = { ...indefiniteBilling, startDate: "2026-09-20", charges: [monthCharge] };

function onSeptemberTenth() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-10T15:00:00Z"));
}

it("asks whether an amount change also reaches this month's charges", async () => {
  onSeptemberTenth();

  const sent = api((_path, init) => (init.method === "PATCH" ? Response.json(recurringWithCharge) : undefined));
  const { user } = renderForm(recurringWithCharge);

  expect(await screen.findByRole("button", { name: /E-mail/ })).toBeInTheDocument();

  await user.clear(screen.getByLabelText("Valor por ocorrência"));
  await user.type(screen.getByLabelText("Valor por ocorrência"), "12000");
  await user.click(screen.getByRole("button", { name: "Salvar conta" }));

  const dialog = await screen.findByRole("dialog", { name: "Aplicar às cobranças deste mês?" });

  expect(within(dialog).getByText("1 cobrança de setembro ainda não venceu.")).toBeInTheDocument();
  expect(sent.some(entry => entry.init.method === "PATCH")).toBe(false);

  await user.click(within(dialog).getByRole("button", { name: "Aplicar também às deste mês" }));

  const patch = sent.find(entry => entry.init.method === "PATCH");

  expect(JSON.parse(String(patch?.init.body))).toMatchObject({ totalCents: 12_000, applyTo: "current_month" });
});

it("sends no scope when the owner keeps this month as it is", async () => {
  onSeptemberTenth();

  const sent = api((_path, init) => (init.method === "PATCH" ? Response.json(recurringWithCharge) : undefined));
  const { user } = renderForm(recurringWithCharge);

  expect(await screen.findByRole("button", { name: /E-mail/ })).toBeInTheDocument();

  await user.clear(screen.getByLabelText("Valor por ocorrência"));
  await user.type(screen.getByLabelText("Valor por ocorrência"), "12000");
  await user.click(screen.getByRole("button", { name: "Salvar conta" }));
  await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Só a partir do mês seguinte" }));

  const patch = sent.find(entry => entry.init.method === "PATCH");

  expect(JSON.parse(String(patch?.init.body)).applyTo).toBeUndefined();
});

it("saves an untouched recurring billing without asking", async () => {
  onSeptemberTenth();

  const sent = api((_path, init) => (init.method === "PATCH" ? Response.json(recurringWithCharge) : undefined));
  const { user } = renderForm(recurringWithCharge);

  expect(await screen.findByRole("button", { name: /E-mail/ })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Salvar conta" }));

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(sent.some(entry => entry.init.method === "PATCH")).toBe(true);
});

it("seeds Não notificar from the allocations and sends the new value on edit", async () => {
  const quietBilling: BillingDetail = {
    ...indefiniteBilling,
    allocations: [{ kind: SplitPartKind.User, userId: "u1", splitMode: SplitMode.Equal, amount: { amountCents: 9_000, currency: "BRL" }, order: 0, notify: false }],
  };
  const sent = api((_path, init) => (init.method === "PATCH" ? Response.json(quietBilling) : undefined));
  const { user } = renderForm(quietBilling);

  const quiet = await screen.findByRole("switch", { name: "Não notificar Ana" });

  expect(quiet).toBeChecked();

  await user.click(quiet);
  await user.click(screen.getByRole("button", { name: "Salvar conta" }));

  const patch = sent.find(entry => entry.init.method === "PATCH");

  expect(JSON.parse(String(patch?.init.body)).split).toEqual({ mode: "equal", parts: [{ kind: "user", userId: "u1", notify: true }] });
});

it("keeps the registro switch locked on edit and never moves its counterpart", async () => {
  const registroBilling: BillingDetail = {
    ...onceBilling,
    id: "b4",
    kind: BillingKind.Record,
    paymentMethodId: undefined,
    reminders: [],
    split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: "u1" }] },
  };
  const sent = api((_path, init) => (init.method === "PATCH" ? Response.json(registroBilling) : undefined));
  const { user } = renderForm(registroBilling);

  const toggle = await screen.findByRole("switch", { name: "Já recebi" });

  expect(toggle).toBeChecked();
  expect(toggle).toBeDisabled();
  expect(screen.getByText("Não dá para mudar depois de criada.")).toBeInTheDocument();
  expect(screen.getByText("De quem")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Ana" })).toBeInTheDocument();
  // The API answers 409 for a counterpart change on a registro, so the form never offers it.
  expect(screen.queryByRole("button", { name: /Escolher|Trocar/ })).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Salvar conta" }));

  const patch = sent.find(entry => entry.init.method === "PATCH");

  expect(patch?.path).toBe("/api/financial/billings/b4");
  expect(JSON.parse(String(patch?.init.body))).toEqual({ category: "other" });
});

/** `a` comes strictly before `b` in the rendered document. */
function isBefore(a: Element, b: Element): boolean {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

it("orders the sections Direção, Valor, Título e categoria, Frequência, Divisão and Chave Pix", async () => {
  api();

  const { user } = renderForm();

  await pickAna(user);

  const direction = screen.getByRole("radiogroup", { name: "Direção" });
  const amount = screen.getByLabelText("Valor total");
  const title = screen.getByLabelText("Título");
  const modality = screen.getByRole("radiogroup", { name: "Modalidade" });
  const due = screen.getByLabelText("Vencimento");
  const split = screen.getByText("Divisão da Conta");
  const pix = screen.getByText("Receber por");

  expect(isBefore(direction, amount)).toBe(true);
  expect(isBefore(amount, title)).toBe(true);
  expect(isBefore(title, modality)).toBe(true);
  expect(isBefore(modality, due)).toBe(true);
  expect(isBefore(due, split)).toBe(true);
  expect(isBefore(split, pix)).toBe(true);
});

it("places the restyled Adicionar action below the participant list, before Não notificar", async () => {
  api();

  const { user } = renderForm();

  await pickAna(user);

  const modeTabs = screen.getByRole("radiogroup", { name: "Divisão" });
  const addButton = screen.getByRole("button", { name: "Adicionar" });
  const quiet = screen.getByRole("switch", { name: "Não notificar Ana" });
  const alsoParticipate = screen.getByRole("checkbox", { name: "Eu também participo" });

  expect(isBefore(modeTabs, addButton)).toBe(true);
  expect(isBefore(addButton, quiet)).toBe(true);
  expect(isBefore(quiet, alsoParticipate)).toBe(true);
  expect(addButton.querySelector(".border-dashed")).not.toBeNull();
});

it("shows the footer summary and the rounded-up total for a parcelado draft", async () => {
  api();

  const { user } = renderForm();

  await pickAna(user);
  await user.click(screen.getByRole("checkbox", { name: "Eu também participo" }));
  await user.click(screen.getByRole("radio", { name: "Parcelado" }));
  await user.clear(screen.getByLabelText("Parcelas"));
  await user.type(screen.getByLabelText("Parcelas"), "3");
  await user.type(screen.getByLabelText("Valor total"), "100,00");

  expect(await screen.findByText("Gera 3 cobranças · 1 pessoa × 3 meses")).toBeInTheDocument();
  expect(screen.getByText("R$ 100,02")).toBeInTheDocument();
});

it("shows the footer summary with the per-month total for an indefinite draft", async () => {
  api();

  const { user } = renderForm();

  await pickAna(user);
  await user.click(screen.getByRole("radio", { name: "Recorrente" }));
  await user.type(screen.getByLabelText("Valor por ocorrência"), "100,00");

  expect(await screen.findByText("Gera 1 cobrança por mês · 1 pessoa")).toBeInTheDocument();
  expect(screen.getByText("R$ 50,00/mês")).toBeInTheDocument();
});

it("hides the footer summary while the draft is not valid yet", async () => {
  api();
  renderForm();

  await screen.findByRole("button", { name: "Criar conta" });

  expect(screen.queryByText(/^Gera /)).not.toBeInTheDocument();
});

it("never shows the footer summary while editing", async () => {
  api();
  renderForm(onceBilling);

  await screen.findByRole("button", { name: "Salvar conta" });

  expect(screen.queryByText(/^Gera /)).not.toBeInTheDocument();
});

it("keeps the footer flush with the page background, like every other screen's ScreenFooter", async () => {
  api();
  renderForm();

  const footer = (await screen.findByRole("button", { name: "Criar conta" })).closest("footer")!;

  expect(footer.className).toContain("bg-canvas/95");
  expect(footer.className).not.toContain("bg-surface/95");
});
