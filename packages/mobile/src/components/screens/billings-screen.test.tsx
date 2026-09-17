import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { Share } from "react-native";
import { BillingsScreen } from "@/components/screens/billings-screen";

jest.mock("@/navigation/tab-header", () => ({ useTabHeader: () => {} }));
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
    ...overrides,
  };
}

function detail(overrides: Overrides = {}) {
  return {
    ...summary(overrides),
    updatedAt: "2026-09-01T00:00:00Z",
    timezone: "America/Sao_Paulo",
    reminders: [],
    split: { mode: "equal" as const, parts: [{ kind: "owner" as const }] },
    allocations: [],
    charges: [],
    previews: [],
    nextMaterialization: null,
    invite: null,
    guests: [],
    linkableContacts: [],
    ...overrides,
  };
}

function shiftDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);

  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function makeClient(overrides: Overrides = {}) {
  return {
    billings: jest.fn().mockResolvedValue({ billings: [summary()], nextCursor: null }),
    billing: jest.fn().mockResolvedValue(detail()),
    patchBilling: jest.fn().mockResolvedValue(detail({ state: "ended" })),
    paymentMethods: jest.fn().mockResolvedValue({ methods: [] }),
    profile: jest.fn().mockResolvedValue({ user: { timezone: "America/Sao_Paulo" } }),
    createBilling: jest.fn(),
    publicLink: jest.fn().mockResolvedValue({ token: "tk" }),
    publicChargeUrl: (token: string) => `http://localhost:3000/pay/${token}`,
    invite: jest.fn().mockResolvedValue({ url: "http://localhost:3000/join/abc", expiresAt: "2026-10-08T12:00:00Z" }),
    revokeInvite: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

/** Every query string the screen asked the API for, oldest first. */
function queries(client: { billings: jest.Mock }): string[] {
  return client.billings.mock.calls.map((call) => String(call[0] ?? ""));
}

describe("BillingsScreen", () => {
  beforeEach(() => {
    jest.spyOn(Share, "share").mockResolvedValue({ action: Share.sharedAction });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders one card per billing with badges, due label, amount and next due date", async () => {
    const client = makeClient({
      billings: jest.fn().mockResolvedValue({
        billings: [
          summary(),
          summary({ id: "b2", description: "Aluguel", category: "housing", participantCount: 1, nextDueDate: shiftDays(-1) }),
          summary({ id: "b3", description: "Netflix", state: "ended", chargeCount: 2, paidCount: 2 }),
        ],
        nextCursor: null,
      }),
    });

    await render(<BillingsScreen client={client} />);

    const card = await screen.findByRole("button", { name: "Cobrança Churrasco" });

    expect(within(card).getByText("Única")).toBeOnTheScreen();
    expect(within(card).getByText("3 pessoas")).toBeOnTheScreen();
    expect(within(card).getByText("R$ 120,00")).toBeOnTheScreen();
    expect(within(card).getByText("Vencimento 20/out")).toBeOnTheScreen();

    const overdue = screen.getByRole("button", { name: "Cobrança Aluguel" });

    expect(within(overdue).getByText("Atrasado 1 dia")).toBeOnTheScreen();
    expect(within(overdue).getByText("1 pessoa")).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("radio", { name: "Encerradas" }));

    const ended = screen.getByRole("button", { name: "Cobrança Netflix" });

    expect(within(ended).getByText("Última 20/out")).toBeOnTheScreen();
    expect(within(ended).queryByRole("button", { name: "Compartilhar" })).toBeNull();
    expect(queries(client)[0]).toBe("");
  });

  it("sends the trimmed search term after the debounce", async () => {
    const client = makeClient();

    await render(<BillingsScreen client={client} />);
    await fireEvent.changeText(screen.getByLabelText("Buscar por título ou descrição"), " churr ");

    expect(queries(client).filter((query) => query.includes("search="))).toEqual([]);

    await waitFor(() => expect(queries(client).some((query) => query.includes("search=churr"))).toBe(true));
    expect(queries(client).at(-1)).toBe("search=churr");
  });

  it("shares the public link of the only pending charge", async () => {
    const client = makeClient({
      billings: jest.fn().mockResolvedValue({ billings: [summary({ shareChargeId: "c9" })], nextCursor: null }),
    });

    await render(<BillingsScreen client={client} />);
    await fireEvent.press(await screen.findByRole("button", { name: "Compartilhar" }));

    await waitFor(() => expect(client.publicLink).toHaveBeenCalledWith("c9"));
    expect(Share.share).toHaveBeenCalledWith(expect.objectContaining({ message: "http://localhost:3000/pay/tk" }));
  });

  it("opens the charge when the public link cannot be published", async () => {
    const onOpenCharge = jest.fn();
    const client = makeClient({
      billings: jest.fn().mockResolvedValue({ billings: [summary({ shareChargeId: "c9" })], nextCursor: null }),
      publicLink: jest.fn().mockRejectedValue(new Error("Cadastre uma chave Pix.")),
    });

    await render(<BillingsScreen client={client} onOpenCharge={onOpenCharge} />);
    await fireEvent.press(await screen.findByRole("button", { name: "Compartilhar" }));

    await waitFor(() => expect(onOpenCharge).toHaveBeenCalledWith("c9"));
  });

  it("opens the billing detail when there is no single charge to share, and from the card itself", async () => {
    const onOpenBilling = jest.fn();
    const client = makeClient();

    await render(<BillingsScreen client={client} onOpenBilling={onOpenBilling} />);
    await fireEvent.press(await screen.findByRole("button", { name: "Compartilhar" }));

    expect(onOpenBilling).toHaveBeenCalledWith("b1");
    expect(client.billing).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole("button", { name: "Cobrança Churrasco" }));

    expect(onOpenBilling).toHaveBeenCalledTimes(2);
  });

  it("shows only active billings by default and switches state without asking the API again", async () => {
    const client = makeClient({
      billings: jest.fn().mockResolvedValue({
        billings: [summary(), summary({ id: "b2", description: "Netflix", state: "ended", paidCount: 3 }), summary({ id: "b3", description: "Academia", recurrence: "indefinite", state: "paused" })],
        nextCursor: null,
      }),
    });

    await render(<BillingsScreen client={client} />);

    expect(await screen.findByRole("button", { name: "Cobrança Churrasco" })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Cobrança Netflix" })).toBeNull();
    expect(screen.getByRole("radio", { name: "Ativas" })).toBeChecked();

    await fireEvent.press(screen.getByRole("radio", { name: "Encerradas" }));

    expect(screen.getByRole("button", { name: "Cobrança Netflix" })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Cobrança Churrasco" })).toBeNull();

    await fireEvent.press(screen.getByRole("radio", { name: "Pausadas" }));

    expect(screen.getByRole("button", { name: "Cobrança Academia" })).toBeOnTheScreen();
    expect(client.billings).toHaveBeenCalledTimes(1);
  });

  it("explains an empty state filter instead of hiding everything silently", async () => {
    await render(<BillingsScreen client={makeClient()} />);

    await screen.findByRole("button", { name: "Cobrança Churrasco" });
    await fireEvent.press(screen.getByRole("radio", { name: "Encerradas" }));

    expect(screen.getByText("Nenhuma conta encerrada.")).toBeOnTheScreen();
    expect(screen.queryByText("Nenhuma conta ainda")).toBeNull();
  });

  it("offers the FAB and the empty state to create a billing", async () => {
    const onCreate = jest.fn();
    const client = makeClient();

    await render(<BillingsScreen client={client} onCreate={onCreate} />);
    await fireEvent.press(await screen.findByRole("button", { name: "Nova conta" }));

    expect(onCreate).toHaveBeenCalled();
  });

  it("shows the empty state when there is no billing yet", async () => {
    const client = makeClient({ billings: jest.fn().mockResolvedValue({ billings: [], nextCursor: null }) });

    await render(<BillingsScreen client={client} />);

    expect(await screen.findByText("Nenhuma conta ainda")).toBeOnTheScreen();
    expect(screen.getAllByRole("button", { name: "Nova conta" }).length).toBeGreaterThan(1);
  });

  it("loads the next page when asked", async () => {
    const client = makeClient({
      billings: jest
        .fn()
        .mockResolvedValueOnce({ billings: [summary()], nextCursor: "c2" })
        .mockResolvedValue({ billings: [summary({ id: "b2", description: "Aluguel" })], nextCursor: null }),
    });

    await render(<BillingsScreen client={client} />);
    await fireEvent.press(await screen.findByRole("button", { name: "Carregar mais" }));

    expect(await screen.findByRole("button", { name: "Cobrança Aluguel" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Cobrança Churrasco" })).toBeOnTheScreen();
    expect(queries(client).at(-1)).toContain("cursor=c2");
  });

  it("replaces the list when the user pulls to refresh", async () => {
    const client = makeClient({
      billings: jest
        .fn()
        .mockResolvedValueOnce({ billings: [summary()], nextCursor: null })
        .mockResolvedValue({ billings: [summary({ id: "b2", description: "Aluguel" })], nextCursor: null }),
    });

    await render(<BillingsScreen client={client} />);
    expect(await screen.findByRole("button", { name: "Cobrança Churrasco" })).toBeOnTheScreen();

    await act(async () => {
      await screen.getByTestId("billings-list").props.refreshControl.props.onRefresh();
    });

    expect(await screen.findByRole("button", { name: "Cobrança Aluguel" })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Cobrança Churrasco" })).toBeNull();
    expect(client.billings).toHaveBeenCalledTimes(2);
  });

  it("asks the API for one direction only", async () => {
    const client = makeClient();

    await render(<BillingsScreen client={client} />);
    await screen.findByRole("button", { name: "Cobrança Churrasco" });
    await fireEvent.press(screen.getByRole("radio", { name: "A pagar" }));

    await waitFor(() => expect(queries(client).at(-1)).toBe("type=payable"));

    await fireEvent.press(screen.getByRole("radio", { name: "Todas" }));

    await waitFor(() => expect(queries(client).at(-1)).toBe(""));
  });

  it("opens a conta a pagar instead of sharing a link", async () => {
    const onOpenBilling = jest.fn();
    const client = makeClient({
      billings: jest.fn().mockResolvedValue({ billings: [summary({ type: "payable", contact: { id: "c1", userId: "u1", name: "Ana", avatar: null }, shareChargeId: "c9" })], nextCursor: null }),
    });

    await render(<BillingsScreen client={client} onOpenBilling={onOpenBilling} />);
    await fireEvent.press(await screen.findByRole("button", { name: "Compartilhar" }));

    expect(onOpenBilling).toHaveBeenCalledWith("b1");
    expect(client.publicLink).not.toHaveBeenCalled();
    expect(Share.share).not.toHaveBeenCalled();
  });
});
