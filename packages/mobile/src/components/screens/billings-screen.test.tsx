import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { BillingsScreen } from "@/components/screens/billings-screen";

jest.mock("expo-router", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot close over module imports
  const react = require("react");

  return { useFocusEffect: (callback: () => void | (() => void)) => react.useEffect(() => callback(), [callback]) };
});

type Overrides = Record<string, unknown>;

function summary(overrides: Overrides = {}) {
  return {
    id: "b1",
    recurrence: "once" as const,
    type: "receivable" as const,
    contact: null,
    counterpart: null,
    description: "Churrasco",
    total: { amountCents: 12000, currency: "BRL" as const },
    startDate: "2026-09-01",
    state: "active" as const,
    nextDueDate: "2026-10-20",
    createdAt: "2026-09-01T00:00:00Z",
    category: "food" as const,
    participantCount: 3,
    chargeCount: 3,
    paidCount: 0,
    proofsPending: 0,
    shareChargeId: null,
    splitMode: "equal" as const,
    ...overrides,
  };
}

function shiftDays(days: number): string {
  const date = new Date();

  date.setDate(date.getDate() + days);

  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

const COUNTS = { active: 7, paused: 1, ended: 4, monthCharges: 23 };

function makeClient(overrides: Overrides = {}) {
  return {
    billings: jest.fn().mockResolvedValue({ billings: [summary()], nextCursor: null, counts: COUNTS }),
    ...overrides,
  };
}

const profile = { load: jest.fn().mockResolvedValue({ name: "Wellington Silva", avatar: null }) };

/** Every query string the screen asked the API for, oldest first. */
function queries(client: { billings: jest.Mock }): string[] {
  return client.billings.mock.calls.map((call) => String(call[0] ?? ""));
}

function page(billings: ReturnType<typeof summary>[], nextCursor: string | null = null) {
  return { billings, nextCursor, counts: COUNTS };
}

describe("BillingsScreen", () => {
  it("renders one two-line card per billing with its chips, amount and next due date", async () => {
    const client = makeClient({
      billings: jest.fn().mockResolvedValue(
        page([
          summary({ recurrence: "until", installmentCount: 12, paidCount: 2, chargeCount: 12 }),
          summary({ id: "b2", description: "Aluguel", category: "housing", participantCount: 1, nextDueDate: shiftDays(-4) }),
          summary({ id: "b3", description: "Netflix", state: "ended", chargeCount: 2, paidCount: 2 }),
        ]),
      ),
    });

    await render(<BillingsScreen client={client} profile={profile} />);

    const card = await screen.findByRole("button", { name: "Conta Churrasco" });

    expect(within(card).getByText("Alimentação · a receber")).toBeOnTheScreen();
    expect(within(card).getByText("Parcelado 3/12")).toBeOnTheScreen();
    expect(within(card).getByText("Igual")).toBeOnTheScreen();
    expect(within(card).getByText("R$ 120,00")).toBeOnTheScreen();
    expect(within(card).getByText("próx. 20/out")).toBeOnTheScreen();
    expect(within(card).queryByRole("button", { name: "Compartilhar" })).toBeNull();

    const overdue = screen.getByRole("button", { name: "Conta Aluguel" });

    expect(within(overdue).getByText("atrasada")).toBeOnTheScreen();
    expect(within(overdue).getByText("4 dias de atraso")).toBeOnTheScreen();
    expect(within(overdue).queryByText("Igual")).toBeNull();

    await fireEvent.press(screen.getByRole("tab", { name: "Encerradas" }));

    expect(within(screen.getByRole("button", { name: "Conta Netflix" })).getByText("liquidada")).toBeOnTheScreen();
    expect(queries(client)[0]).toBe("");
  });

  it("reads the counts the API sent in the header and on the tabs", async () => {
    await render(<BillingsScreen client={makeClient()} profile={profile} />);

    expect(await screen.findByText("7 ativas · 23 cobranças no mês")).toBeOnTheScreen();
    expect(within(screen.getByRole("tab", { name: "Pausadas" })).getByText("1")).toBeOnTheScreen();
    expect(within(screen.getByRole("tab", { name: "Encerradas" })).getByText("4")).toBeOnTheScreen();
  });

  it("sends the trimmed search term after the debounce", async () => {
    const client = makeClient();

    await render(<BillingsScreen client={client} profile={profile} />);
    await fireEvent.changeText(screen.getByLabelText("Buscar conta"), " churr ");

    expect(queries(client).filter((query) => query.includes("search="))).toEqual([]);

    await waitFor(() => expect(queries(client).some((query) => query.includes("search=churr"))).toBe(true));

    expect(queries(client).at(-1)).toBe("search=churr");
  });

  it("opens the billing detail from the card", async () => {
    const onOpenBilling = jest.fn();

    await render(<BillingsScreen client={makeClient()} profile={profile} onOpenBilling={onOpenBilling} />);
    await fireEvent.press(await screen.findByRole("button", { name: "Conta Churrasco" }));

    expect(onOpenBilling).toHaveBeenCalledWith("b1");
  });

  it("goes back to the Feed and opens Perfil from the header", async () => {
    const onBack = jest.fn();
    const onOpenProfile = jest.fn();

    await render(<BillingsScreen client={makeClient()} profile={profile} onBack={onBack} onOpenProfile={onOpenProfile} />);
    await screen.findByRole("button", { name: "Conta Churrasco" });
    await fireEvent.press(screen.getByRole("button", { name: "Voltar para o Feed" }));
    await fireEvent.press(screen.getByRole("button", { name: "Perfil" }));

    expect(onBack).toHaveBeenCalled();
    expect(onOpenProfile).toHaveBeenCalled();
  });

  it("shows only active billings by default and switches state without asking the API again", async () => {
    const client = makeClient({
      billings: jest
        .fn()
        .mockResolvedValue(
          page([summary(), summary({ id: "b2", description: "Netflix", state: "ended", paidCount: 3 }), summary({ id: "b3", description: "Academia", recurrence: "indefinite", state: "paused" })]),
        ),
    });

    await render(<BillingsScreen client={client} profile={profile} />);

    expect(await screen.findByRole("button", { name: "Conta Churrasco" })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Conta Netflix" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Ativas" })).toBeSelected();

    await fireEvent.press(screen.getByRole("tab", { name: "Encerradas" }));

    expect(screen.getByRole("button", { name: "Conta Netflix" })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Conta Churrasco" })).toBeNull();

    await fireEvent.press(screen.getByRole("tab", { name: "Pausadas" }));

    expect(screen.getByRole("button", { name: "Conta Academia" })).toBeOnTheScreen();
    expect(client.billings).toHaveBeenCalledTimes(1);
  });

  it("filters by type, frequency and category on the loaded list without asking the API again", async () => {
    const client = makeClient({
      billings: jest.fn().mockResolvedValue(page([summary(), summary({ id: "b2", description: "Streaming", type: "payable", recurrence: "indefinite", category: "subscription" })])),
    });

    await render(<BillingsScreen client={client} profile={profile} />);
    await screen.findByRole("button", { name: "Conta Churrasco" });
    await fireEvent.press(screen.getByRole("button", { name: "Filtros" }));
    await fireEvent.press(screen.getByRole("button", { name: "Tipo A pagar" }));
    await fireEvent.press(screen.getByRole("button", { name: "Aplicar" }));

    expect(screen.getByRole("button", { name: "Conta Streaming" })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Conta Churrasco" })).toBeNull();
    expect(screen.getByRole("button", { name: "Filtros, 1 ativos" })).toBeOnTheScreen();
    expect(client.billings).toHaveBeenCalledTimes(1);
  });

  it("explains an empty state filter instead of hiding everything silently", async () => {
    await render(<BillingsScreen client={makeClient()} profile={profile} />);

    await screen.findByRole("button", { name: "Conta Churrasco" });
    await fireEvent.press(screen.getByRole("tab", { name: "Encerradas" }));

    expect(screen.getByText("Nenhuma conta encerrada.")).toBeOnTheScreen();
    expect(screen.queryByText("Nenhuma conta ainda")).toBeNull();
  });

  it("creates a billing from the + in the footer", async () => {
    const onCreate = jest.fn();

    await render(<BillingsScreen client={makeClient()} profile={profile} onCreate={onCreate} />);
    await screen.findByRole("button", { name: "Conta Churrasco" });
    await fireEvent.press(screen.getByRole("button", { name: "Nova conta" }));

    expect(onCreate).toHaveBeenCalled();
  });

  it("shows the empty state when there is no billing yet", async () => {
    await render(<BillingsScreen client={makeClient({ billings: jest.fn().mockResolvedValue(page([])) })} profile={profile} />);

    expect(await screen.findByText("Nenhuma conta ainda")).toBeOnTheScreen();
  });

  it("loads the next page when asked", async () => {
    const client = makeClient({
      billings: jest
        .fn()
        .mockResolvedValueOnce(page([summary()], "c2"))
        .mockResolvedValue(page([summary({ id: "b2", description: "Aluguel" })])),
    });

    await render(<BillingsScreen client={client} profile={profile} />);
    await fireEvent.press(await screen.findByRole("button", { name: "Carregar mais" }));

    expect(await screen.findByRole("button", { name: "Conta Aluguel" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Conta Churrasco" })).toBeOnTheScreen();
    expect(queries(client).at(-1)).toContain("cursor=c2");
  });

  it("replaces the list when the user pulls to refresh", async () => {
    const client = makeClient({
      billings: jest
        .fn()
        .mockResolvedValueOnce(page([summary()]))
        .mockResolvedValue(page([summary({ id: "b2", description: "Aluguel" })])),
    });

    await render(<BillingsScreen client={client} profile={profile} />);

    expect(await screen.findByRole("button", { name: "Conta Churrasco" })).toBeOnTheScreen();

    await act(async () => {
      await screen.getByTestId("billings-list").props.refreshControl.props.onRefresh();
    });

    expect(await screen.findByRole("button", { name: "Conta Aluguel" })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Conta Churrasco" })).toBeNull();
    expect(client.billings).toHaveBeenCalledTimes(2);
  });
});
