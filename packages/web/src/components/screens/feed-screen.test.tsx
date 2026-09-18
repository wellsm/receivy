import {
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
} from "@receivy/common";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FeedScreen } from "@/components/screens/feed-screen";

import { browserFetch } from "@/lib/auth/browser-fetch";

const { replace, refresh } = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh }) }));
vi.mock("@/lib/auth/browser-fetch", () => ({ browserFetch: vi.fn() }));

const MONTH = "2026-09";
const TODAY = calendarDate();

/** `formatMoney` separates the symbol with a non-breaking space; the DOM matchers normalize it away. */
function brl(amountCents: number): string {
  return formatMoney({ amountCents, currency: "BRL" }).replace(/ /g, " ");
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
    proof: null,
    billing: { recurrence: BillingRecurrence.Once, kind: BillingKind.Live, contact: null },
    debtor: { name: "Ana Prado" },
    ...overrides,
  };
}

/** A charge the viewer pays: the API already says which side they are on. */
function payable(overrides: Partial<ListChargeItem> = {}): ListChargeItem {
  return charge({ type: Direction.Payable, ...overrides });
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("FeedScreen", () => {
  it("sums each side of the month, open and settled, and counts only what is open", () => {
    render(
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

    const summary = screen.getByRole("region", { name: "Resumo do mês" });

    expect(within(summary).getByText(brl(1620))).toBeInTheDocument();
    expect(within(summary).getByText(brl(700))).toBeInTheDocument();
    expect(within(summary).getByText("2 cobranças")).toBeInTheDocument();
    expect(within(summary).getByText("1 cobrança")).toBeInTheDocument();
    // Previsto: 1620 open in, 700 open out, 250 in and 40 out already settled. Realizado: 250 - 40.
    expect(within(summary).getByText(`+ ${brl(1130)}`)).toBeInTheDocument();
    expect(within(summary).getByText(`+ ${brl(210)}`)).toBeInTheDocument();
  });

  it("groups the charges by due date and heads each day with what it still owes", () => {
    render(
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

    const first = screen.getByRole("heading", { name: new RegExp(feedDayLabel("2026-09-10", TODAY), "i") });

    expect(first).toHaveTextContent(brl(1500));
    expect(screen.getByText(/Aluguel/)).toBeInTheDocument();
    expect(screen.getByText(/Academia/)).toBeInTheDocument();
  });

  it("names the counterpart by join: the contact when the viewer pays, the debtor when they receive", () => {
    const viewerName = "Ana Silva";

    render(
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
              contact: { id: "c1", nickname: "Padaria da esquina", user: { name: "Padaria" } },
            },
          }),
          charge({
            description: "Aluguel",
            debtor: { name: "Bruno" },
            billing: { recurrence: BillingRecurrence.Once, kind: BillingKind.Live, contact: null },
          }),
        ]}
      />,
    );

    expect(screen.getByText(/Padaria da esquina/)).toBeInTheDocument();
    expect(screen.getByText(/Bruno/)).toBeInTheDocument();
    // The payable card names the contact, never the viewer's own name (the debtor on that side).
    expect(screen.queryByText(new RegExp(viewerName))).not.toBeInTheDocument();
  });

  it("marks a day as settled once none of its charges is open", () => {
    render(<FeedScreen month={MONTH} filters={DEFAULT_FEED_FILTERS} today={TODAY} charges={[charge({ state: ChargeState.Paid })]} />);

    expect(screen.getByText("liquidado")).toBeInTheDocument();
  });

  it("invites the visitor to start when the month has no charge", () => {
    render(<FeedScreen month={MONTH} filters={DEFAULT_FEED_FILTERS} today={TODAY} charges={[]} />);

    expect(screen.getByText("Sua timeline começa aqui")).toBeInTheDocument();
  });

  it("opens on the month it was given, with that tab pressed", () => {
    render(<FeedScreen month={MONTH} filters={DEFAULT_FEED_FILTERS} today={TODAY} charges={[]} />);

    expect(screen.getByRole("button", { name: monthLabel(MONTH) })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: monthLabel("2026-08") })).toHaveAttribute("aria-pressed", "false");
  });

  it("moves the selected month to the URL so the server renders that month", async () => {
    render(<FeedScreen month={MONTH} filters={DEFAULT_FEED_FILTERS} today={TODAY} charges={[]} />);

    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: monthLabel("2026-08") }));

    expect(replace).toHaveBeenCalledWith(`/feed?${feedFilterQuery(DEFAULT_FEED_FILTERS, TODAY, "2026-08")}`, { scroll: false });
  });

  it("moves a chosen filter to the URL, keeping the month it is on", async () => {
    render(<FeedScreen month={MONTH} filters={DEFAULT_FEED_FILTERS} today={TODAY} charges={[]} />);

    const user = userEvent.setup();

    await user.click(screen.getByRole("combobox", { name: "Direção" }));
    await user.click(screen.getByRole("option", { name: "A receber" }));

    expect(replace).toHaveBeenCalledWith(
      `/feed?${feedFilterQuery({ ...DEFAULT_FEED_FILTERS, direction: [Direction.Receivable] }, TODAY, MONTH)}`,
      { scroll: false },
    );
  });
  it("reminds an overdue debtor from the card after confirming, once", async () => {
    vi.mocked(browserFetch).mockResolvedValue(Response.json({ queued: true }));
    render(
      <FeedScreen
        month={MONTH}
        filters={DEFAULT_FEED_FILTERS}
        today={TODAY}
        charges={[charge({ id: "late", description: "Aluguel", dueDate: "2020-01-01", debtor: { name: "Bruno" } })]}
      />,
    );

    const user = userEvent.setup();

    expect(screen.getByText("Atrasado")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Lembrar" }));

    expect(screen.getByRole("dialog", { name: "Enviar lembrete?" })).toHaveTextContent("Avisa Bruno");

    await user.click(screen.getByRole("button", { name: "Enviar lembrete" }));

    expect(browserFetch).toHaveBeenCalledWith("/api/financial/charges/late/reminders", { method: "POST" });
    expect(await screen.findByRole("button", { name: "Lembrete enviado" })).toBeDisabled();
  });

  it("marks the viewer's own bill without Pix as paid and refreshes the server render", async () => {
    vi.mocked(browserFetch).mockResolvedValue(Response.json({}));
    render(
      <FeedScreen
        month={MONTH}
        filters={DEFAULT_FEED_FILTERS}
        today={TODAY}
        charges={[payable({ id: "own", description: "Luz", ownedByViewer: true, hasPayment: false, confirmationRequired: false, creditor: { name: "Enel" } })]}
      />,
    );

    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Marcar pago" }));
    await user.click(screen.getByRole("button", { name: "Marcar paga" }));

    expect(browserFetch).toHaveBeenCalledWith("/api/financial/charges/own/pay", { method: "POST" });

    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("surfaces the API message when an action fails", async () => {
    vi.mocked(browserFetch).mockResolvedValue(Response.json({ message: "Cobrança já liquidada." }, { status: 409 }));
    render(
      <FeedScreen
        month={MONTH}
        filters={DEFAULT_FEED_FILTERS}
        today={TODAY}
        charges={[payable({ id: "own", ownedByViewer: true, hasPayment: false, confirmationRequired: true, creditor: { name: "Maria" } })]}
      />,
    );

    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Marcar pago" }));

    const dialog = screen.getByRole("dialog", { name: "Marcar como pago?" });

    expect(dialog).toHaveTextContent("Maria vai receber um aviso");

    await user.click(within(dialog).getByRole("button", { name: "Marcar pago" }));

    expect(browserFetch).toHaveBeenCalledWith("/api/financial/charges/own/proof/declaration", { method: "POST" });
    expect(await screen.findByRole("alert")).toHaveTextContent("Cobrança já liquidada.");
    expect(refresh).not.toHaveBeenCalled();
  });
});
