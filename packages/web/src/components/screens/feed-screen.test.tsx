import {
  BillingCategory,
  BillingKind,
  BillingRecurrence,
  DEFAULT_FEED_FILTERS,
  calendarDate,
  feedFilterQuery,
  ChargeState,
  Direction,
  feedDayLabel,
  formatMoney,
  monthLabel,
  type ListChargeItem,
  SplitMode,
} from "@receivy/common";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeedScreen } from "@/components/screens/feed-screen";
import { renderWithRouter } from "@/test/render";

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock("@/lib/navigate", () => ({ useAppNavigate: () => navigate }));

const API = "https://api.test";
const MONTH = "2026-09";
const TODAY = calendarDate();

/** `formatMoney` separates the symbol with a non-breaking space; the DOM matchers normalize it away. */
function brl(amountCents: number): string {
  return formatMoney({ amountCents, currency: "BRL" }).replace(/\u00a0/g, " ");
}

function charge(overrides: Partial<ListChargeItem> = {}): ListChargeItem {
  return {
    id: crypto.randomUUID(),
    billingId: "b1",
    description: "Aluguel",
    state: ChargeState.Pending,
    dueDate: "2026-09-10",
    amountCents: 1000,
    type: Direction.Receivable,
    ownedByViewer: true,
    hasPayment: false,
    notify: true,
    counterpartReachable: true,
    confirmationRequired: true,
    participantCount: 1,
    proof: null,
    billing: { recurrence: BillingRecurrence.Once, kind: BillingKind.Live, category: BillingCategory.Housing, contact: null },
    debtor: { name: "Ana Prado" },
    ...overrides,
  };
}

/** A charge the viewer pays: the API already says which side they are on. */
function payable(overrides: Partial<ListChargeItem> = {}): ListChargeItem {
  return charge({ type: Direction.Payable, ...overrides });
}

beforeEach(() => {
  vi.stubEnv("VITE_API_URL", API);
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("FeedScreen", () => {
  it("sums each side of the month, open and settled, and counts only what is open", async () => {
    renderWithRouter(
      <FeedScreen
        month={MONTH}
        filters={DEFAULT_FEED_FILTERS}
        today={TODAY}
        charges={[
          charge({ amountCents: 1000 }),
          charge({ amountCents: 620 }),
          charge({ amountCents: 250, state: ChargeState.Paid }),
          payable({ amountCents: 700 }),
          payable({ amountCents: 40, state: ChargeState.Paid }),
        ]}
      />,
    );

    const summary = await screen.findByRole("region", { name: "Resumo do mês" });

    expect(within(summary).getByText(brl(1620))).toBeInTheDocument();
    expect(within(summary).getByText(brl(700))).toBeInTheDocument();
    expect(within(summary).getByText("2 cobranças")).toBeInTheDocument();
    expect(within(summary).getByText("1 cobrança")).toBeInTheDocument();
    // Previsto: 1620 open in, 700 open out, 250 in and 40 out already settled. Realizado: 250 - 40.
    expect(within(summary).getByText(`+ ${brl(1130)}`)).toBeInTheDocument();
    expect(within(summary).getByText(`+ ${brl(210)}`)).toBeInTheDocument();
  });

  it("groups the charges by due date and heads each day with what it still owes", async () => {
    renderWithRouter(
      <FeedScreen
        month={MONTH}
        filters={DEFAULT_FEED_FILTERS}
        today={TODAY}
        charges={[
          charge({ description: "Aluguel", dueDate: "2026-09-10", amountCents: 1000 }),
          charge({ description: "Internet", dueDate: "2026-09-10", amountCents: 500 }),
          charge({ description: "Academia", dueDate: "2026-09-11", amountCents: 300 }),
        ]}
      />,
    );

    const first = await screen.findByRole("heading", { name: new RegExp(feedDayLabel("2026-09-10", TODAY), "i") });

    expect(first).toHaveTextContent(brl(1500));
    expect(screen.getByText(/Aluguel/)).toBeInTheDocument();
    expect(screen.getByText(/Academia/)).toBeInTheDocument();
  });

  it("names the counterpart by join: the contact when the viewer pays, the debtor when they receive", async () => {
    const viewerName = "Ana Silva";

    renderWithRouter(
      <FeedScreen
        month={MONTH}
        filters={DEFAULT_FEED_FILTERS}
        today={TODAY}
        charges={[
          payable({
            description: "Pão",
            debtor: { name: viewerName },
            billing: {
              recurrence: BillingRecurrence.Once,
              kind: BillingKind.Live,
              category: BillingCategory.Food,
              contact: { id: "c1", nickname: "Padaria da esquina", user: { name: "Padaria" } },
            },
          }),
          charge({
            description: "Aluguel",
            debtor: { name: "Bruno" },
            billing: { recurrence: BillingRecurrence.Once, kind: BillingKind.Live, category: BillingCategory.Housing, contact: null },
          }),
        ]}
      />,
    );

    expect(await screen.findByText(/Padaria da esquina/)).toBeInTheDocument();
    expect(screen.getByText(/Bruno/)).toBeInTheDocument();
    // The payable card names the contact, never the viewer's own name (the debtor on that side).
    expect(screen.queryByText(new RegExp(viewerName))).not.toBeInTheDocument();
  });

  it("marks a day as settled once none of its charges is open", async () => {
    renderWithRouter(<FeedScreen month={MONTH} filters={DEFAULT_FEED_FILTERS} today={TODAY} charges={[charge({ state: ChargeState.Paid })]} />);

    expect(await screen.findByText("liquidado")).toBeInTheDocument();
  });

  it("invites the visitor to start when the month has no charge", async () => {
    renderWithRouter(<FeedScreen month={MONTH} filters={DEFAULT_FEED_FILTERS} today={TODAY} charges={[]} />);

    expect(await screen.findByText("Sua timeline começa aqui")).toBeInTheDocument();
  });

  it("opens on the month it was given, with that tab pressed", async () => {
    renderWithRouter(<FeedScreen month={MONTH} filters={DEFAULT_FEED_FILTERS} today={TODAY} charges={[]} />);

    expect(await screen.findByRole("button", { name: monthLabel(MONTH) })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: monthLabel("2026-08") })).toHaveAttribute("aria-pressed", "false");
  });

  it("moves the selected month to the URL so the server renders that month", async () => {
    renderWithRouter(<FeedScreen month={MONTH} filters={DEFAULT_FEED_FILTERS} today={TODAY} charges={[]} />);

    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: monthLabel("2026-08") }));

    expect(navigate).toHaveBeenCalledWith(`/feed?${feedFilterQuery(DEFAULT_FEED_FILTERS, TODAY, "2026-08")}`, { replace: true, resetScroll: false });
  });

  it("moves a chosen filter to the URL, keeping the month it is on", async () => {
    renderWithRouter(<FeedScreen month={MONTH} filters={DEFAULT_FEED_FILTERS} today={TODAY} charges={[]} />);

    const user = userEvent.setup();

    await user.click(await screen.findByRole("combobox", { name: "Direção" }));
    await user.click(screen.getByRole("option", { name: "A receber" }));

    expect(navigate).toHaveBeenCalledWith(
      `/feed?${feedFilterQuery({ ...DEFAULT_FEED_FILTERS, direction: [Direction.Receivable] }, TODAY, MONTH)}`,
      { replace: true, resetScroll: false },
    );
  });
  it("reminds an overdue debtor from the card after confirming, once", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ queued: true }));

    vi.stubGlobal("fetch", fetchMock);
    renderWithRouter(
      <FeedScreen
        month={MONTH}
        filters={DEFAULT_FEED_FILTERS}
        today={TODAY}
        charges={[charge({ id: "late", description: "Aluguel", dueDate: "2020-01-01", debtor: { name: "Bruno" } })]}
      />,
    );

    const user = userEvent.setup();

    expect(await screen.findByText("Atrasado")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Lembrar" }));

    expect(screen.getByRole("dialog", { name: "Enviar lembrete?" })).toHaveTextContent("Avisa Bruno");

    await user.click(screen.getByRole("button", { name: "Enviar lembrete" }));

    expect(fetchMock).toHaveBeenCalledWith(`${API}/charges/late/reminders`, expect.objectContaining({ method: "POST" }));
    expect(await screen.findByRole("button", { name: "Lembrete enviado" })).toBeDisabled();
  });

  it("marks the viewer's own bill without Pix as paid and invalidates the router", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({}));

    vi.stubGlobal("fetch", fetchMock);

    const { router } = renderWithRouter(
      <FeedScreen
        month={MONTH}
        filters={DEFAULT_FEED_FILTERS}
        today={TODAY}
        charges={[payable({ id: "own", description: "Luz", ownedByViewer: true, hasPayment: false, confirmationRequired: false, creditor: { name: "Enel" } })]}
      />,
    );

    const invalidate = vi.spyOn(router, "invalidate");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Marcar pago" }));
    await user.click(screen.getByRole("button", { name: "Marcar paga" }));

    expect(fetchMock).toHaveBeenCalledWith(`${API}/charges/own/pay`, expect.objectContaining({ method: "POST" }));

    await waitFor(() => expect(invalidate).toHaveBeenCalled());
  });

  it("surfaces the API message when an action fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ message: "Cobrança já liquidada." }, { status: 409 }));

    vi.stubGlobal("fetch", fetchMock);

    const { router } = renderWithRouter(
      <FeedScreen
        month={MONTH}
        filters={DEFAULT_FEED_FILTERS}
        today={TODAY}
        charges={[payable({ id: "own", ownedByViewer: true, hasPayment: false, confirmationRequired: true, creditor: { name: "Maria" } })]}
      />,
    );

    const invalidate = vi.spyOn(router, "invalidate");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Marcar pago" }));

    const dialog = screen.getByRole("dialog", { name: "Marcar como pago?" });

    expect(dialog).toHaveTextContent("Maria vai receber um aviso");

    await user.click(within(dialog).getByRole("button", { name: "Marcar pago" }));

    expect(fetchMock).toHaveBeenCalledWith(`${API}/charges/own/proof/declaration`, expect.objectContaining({ method: "POST" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Cobrança já liquidada.");
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("greets the viewer in the narrow header, linking Perfil and Contas", async () => {
    renderWithRouter(<FeedScreen month={MONTH} filters={DEFAULT_FEED_FILTERS} today={TODAY} charges={[]} user={{ name: "Wellington Silva", avatar: null }} />);

    expect(await screen.findByText("Olá, Wellington")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Perfil" })).toHaveAttribute("href", "/settings");
    expect(screen.getByRole("link", { name: "Contas" })).toHaveAttribute("href", "/billings");
    expect(screen.getByRole("link", { name: "Nova conta" })).toHaveAttribute("href", "/billings/new");
  });

  it("searches the month from the footer, leaving the summary on the whole month", async () => {
    const user = userEvent.setup();

    renderWithRouter(
      <FeedScreen
        month={MONTH}
        filters={DEFAULT_FEED_FILTERS}
        today={TODAY}
        charges={[charge({ description: "Aluguel", debtor: { name: "Marina" } }), charge({ description: "Uber", debtor: { name: "Rafa" } })]}
      />,
    );

    await user.type(await screen.findByRole("searchbox", { name: "Buscar cobrança" }), "marina");

    expect(screen.getByRole("link", { name: "Abrir cobrança Aluguel" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Abrir cobrança Uber" })).not.toBeInTheDocument();

    await user.clear(screen.getByRole("searchbox", { name: "Buscar cobrança" }));
    await user.type(screen.getByRole("searchbox", { name: "Buscar cobrança" }), "nada");

    expect(screen.getByText("Nenhuma cobrança encontrada.")).toBeInTheDocument();
  });

  it("reads the second line of a narrow row: people and split of a shared billing", async () => {
    renderWithRouter(
      <FeedScreen
        month={MONTH}
        filters={DEFAULT_FEED_FILTERS}
        today="2026-09-01"
        charges={[
          charge({
            participantCount: 3,
            billing: { recurrence: BillingRecurrence.Once, kind: BillingKind.Live, category: BillingCategory.Groceries, splitMode: SplitMode.Equal, contact: null },
          }),
        ]}
      />,
    );

    expect(await screen.findByText("3 pessoas · igual")).toBeInTheDocument();
  });

  it("opens the filters from the footer and moves the choice to the URL", async () => {
    const user = userEvent.setup();

    renderWithRouter(<FeedScreen month={MONTH} filters={DEFAULT_FEED_FILTERS} today={TODAY} charges={[charge()]} />);

    await user.click(await screen.findByRole("button", { name: "Filtros" }));
    await user.click(within(screen.getByRole("dialog", { name: "Filtros" })).getByRole("button", { name: "Direção A pagar" }));
    await user.click(screen.getByRole("button", { name: "Aplicar" }));

    expect(navigate).toHaveBeenCalledWith(expect.stringContaining("direction=payable"), { replace: true, resetScroll: false });
  });
});
