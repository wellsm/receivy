import {
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
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FeedScreen } from "@/components/screens/feed-screen";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const MONTH = "2026-09";
const TODAY = calendarDate();
const VIEWER = "ana@example.com";

/** `formatMoney` separates the symbol with a non-breaking space; the DOM matchers normalize it away. */
function brl(amountCents: number): string {
  return formatMoney({ amountCents, currency: "BRL" }).replace(/\u00a0/g, " ");
}

function charge(overrides: Partial<ListChargeItem> = {}): ListChargeItem {
  return {
    id: crypto.randomUUID(),
    description: "Aluguel",
    state: ChargeState.Pending,
    due_date: "2026-09-10",
    amount_cents: 1000,
    billing: { type: "once", direction: Direction.Receivable },
    debtor: { name: "Ana Prado" },
    ...overrides,
  };
}

/** A charge the viewer pays: `debtor` is whoever pays, so it is the viewer here. */
function payable(overrides: Partial<ListChargeItem> = {}): ListChargeItem {
  return charge({ debtor: { email: VIEWER }, ...overrides });
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
        viewerEmail={VIEWER}
        filters={DEFAULT_FEED_FILTERS}
        today={TODAY}
        charges={[
          charge({ amount_cents: 1000 }),
          charge({ amount_cents: 620 }),
          charge({ amount_cents: 250, state: ChargeState.Paid }),
          payable({ amount_cents: 700 }),
          payable({ amount_cents: 40, state: ChargeState.Paid }),
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
        viewerEmail={VIEWER}
        filters={DEFAULT_FEED_FILTERS}
        today={TODAY}
        charges={[
          charge({ description: "Aluguel", due_date: "2026-09-10", amount_cents: 1000 }),
          charge({ description: "Internet", due_date: "2026-09-10", amount_cents: 500 }),
          charge({ description: "Academia", due_date: "2026-09-11", amount_cents: 300 }),
        ]}
      />,
    );

    const first = screen.getByRole("heading", { name: new RegExp(feedDayLabel("2026-09-10", TODAY), "i") });

    expect(first).toHaveTextContent(brl(1500));
    expect(screen.getByText(/Aluguel/)).toBeInTheDocument();
    expect(screen.getByText(/Academia/)).toBeInTheDocument();
  });

  it("marks a day as settled once none of its charges is open", () => {
    render(<FeedScreen month={MONTH} viewerEmail={VIEWER} filters={DEFAULT_FEED_FILTERS} today={TODAY} charges={[charge({ state: ChargeState.Paid })]} />);

    expect(screen.getByText("liquidado")).toBeInTheDocument();
  });

  it("invites the visitor to start when the month has no charge", () => {
    render(<FeedScreen month={MONTH} viewerEmail={VIEWER} filters={DEFAULT_FEED_FILTERS} today={TODAY} charges={[]} />);

    expect(screen.getByText("Sua timeline começa aqui")).toBeInTheDocument();
  });

  it("opens on the month it was given, with that tab pressed", () => {
    render(<FeedScreen month={MONTH} viewerEmail={VIEWER} filters={DEFAULT_FEED_FILTERS} today={TODAY} charges={[]} />);

    expect(screen.getByRole("button", { name: monthLabel(MONTH) })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: monthLabel("2026-08") })).toHaveAttribute("aria-pressed", "false");
  });

  it("moves the selected month to the URL so the server renders that month", async () => {
    render(<FeedScreen month={MONTH} viewerEmail={VIEWER} filters={DEFAULT_FEED_FILTERS} today={TODAY} charges={[]} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: monthLabel("2026-08") }));

    expect(replace).toHaveBeenCalledWith(`/feed?${feedFilterQuery(DEFAULT_FEED_FILTERS, TODAY, "2026-08")}`, { scroll: false });
  });

  it("moves a chosen filter to the URL, keeping the month it is on", async () => {
    render(<FeedScreen month={MONTH} viewerEmail={VIEWER} filters={DEFAULT_FEED_FILTERS} today={TODAY} charges={[]} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("combobox", { name: "Direção" }));
    await user.click(screen.getByRole("option", { name: "A receber" }));

    expect(replace).toHaveBeenCalledWith(
      `/feed?${feedFilterQuery({ ...DEFAULT_FEED_FILTERS, direction: [Direction.Receivable] }, TODAY, MONTH)}`,
      { scroll: false },
    );
  });
});
