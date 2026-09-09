import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { Share } from "react-native";
import { BillingsScreen } from "./billings-screen";

jest.mock("./billing-form-screen", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot close over module imports
  const react = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot close over module imports
  const { Pressable, Text } = require("react-native");

  return {
    BillingFormScreen: ({ onBack }: { onBack: () => void }) =>
      react.createElement(
        Pressable,
        { accessibilityRole: "button", accessibilityLabel: "Salvar cobrança", onPress: onBack },
        react.createElement(Text, null, "Formulário de cobrança"),
      ),
  };
});

type Overrides = Record<string, unknown>;

function summary(overrides: Overrides = {}) {
  return {
    id: "b1",
    type: "once" as const,
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
    expect(within(card).getByRole("button", { name: "Editar" })).toBeOnTheScreen();

    const ended = screen.getByRole("button", { name: "Cobrança Netflix" });

    expect(within(ended).getByText("Última 20/out")).toBeOnTheScreen();
    expect(within(ended).queryByRole("button", { name: "Editar" })).toBeNull();
    expect(within(ended).queryByRole("button", { name: "Compartilhar" })).toBeNull();
    expect(queries(client)[0]).toBe("state=active");
  });

  it("reveals the search field and sends the trimmed term after the debounce", async () => {
    const client = makeClient();

    await render(<BillingsScreen client={client} />);
    await fireEvent.press(screen.getByRole("button", { name: "Buscar" }));
    await fireEvent.changeText(screen.getByLabelText("Buscar por título ou descrição"), " churr ");

    expect(queries(client).filter((query) => query.includes("search="))).toEqual([]);

    await waitFor(() => expect(queries(client).some((query) => query.includes("search=churr"))).toBe(true));
    expect(queries(client).at(-1)).toContain("state=active");
  });

  it("applies state, type and category filters from the sheet and shows them as chips", async () => {
    const client = makeClient();

    await render(<BillingsScreen client={client} />);
    await fireEvent.press(await screen.findByRole("button", { name: "Filtros" }));
    await fireEvent.press(screen.getByRole("button", { name: "Estado Encerradas" }));
    await fireEvent.press(screen.getByRole("button", { name: "Tipo Parcelada" }));
    await fireEvent.press(screen.getByRole("button", { name: "Categoria Alimentação" }));
    await fireEvent.press(screen.getByRole("button", { name: "Aplicar" }));

    await waitFor(() => expect(queries(client).at(-1)).toContain("state=ended"));
    expect(queries(client).at(-1)).toContain("type=until");
    expect(queries(client).at(-1)).toContain("category=food");
    expect(screen.getByRole("button", { name: "Remover filtro Encerradas" })).toBeOnTheScreen();
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

  it("opens the billing detail when there is no single charge to share", async () => {
    const client = makeClient();

    await render(<BillingsScreen client={client} />);
    await fireEvent.press(await screen.findByRole("button", { name: "Compartilhar" }));

    await waitFor(() => expect(client.billing).toHaveBeenCalledWith("b1"));
    expect(await screen.findByText("Cobranças geradas")).toBeOnTheScreen();
  });

  it("opens the detail from the card and the form from Editar", async () => {
    const client = makeClient();

    await render(<BillingsScreen client={client} />);
    await fireEvent.press(await screen.findByRole("button", { name: "Cobrança Churrasco" }));

    expect(await screen.findByText("Cobranças geradas")).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("button", { name: "Todas as cobranças" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Editar" }));

    expect(await screen.findByRole("button", { name: "Salvar cobrança" })).toBeOnTheScreen();
  });

  it("creates, shares and revokes the billing invite from the detail", async () => {
    const client = makeClient();

    await render(<BillingsScreen client={client} />);
    await fireEvent.press(await screen.findByRole("button", { name: "Cobrança Churrasco" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Convidar" }));

    await waitFor(() => expect(client.invite).toHaveBeenCalledWith("b1"));
    expect(Share.share).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Entre na cobrança Churrasco no Receivy: http://localhost:3000/join/abc" }),
    );
    expect(await screen.findByText("Convite ativo até 08/10")).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("button", { name: "Revogar" }));

    await waitFor(() => expect(client.revokeInvite).toHaveBeenCalledWith("b1"));
    expect(screen.queryByText("Convite ativo até 08/10")).toBeNull();
  });

  it("shows an invite already active without issuing a new one", async () => {
    const client = makeClient({
      billing: jest.fn().mockResolvedValue(detail({ invite: { url: "http://localhost:3000/join/abc", expiresAt: "2026-10-08T12:00:00Z" } })),
    });

    await render(<BillingsScreen client={client} />);
    await fireEvent.press(await screen.findByRole("button", { name: "Cobrança Churrasco" }));

    expect(await screen.findByText("Convite ativo até 08/10")).toBeOnTheScreen();
    expect(client.invite).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole("button", { name: "Compartilhar convite" }));

    expect(Share.share).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Entre na cobrança Churrasco no Receivy: http://localhost:3000/join/abc" }),
    );
  });

  it("hides the invite actions on a billing that is no longer active", async () => {
    const client = makeClient({
      billing: jest.fn().mockResolvedValue(detail({ state: "paused", invite: { url: "http://localhost:3000/join/abc", expiresAt: "2026-10-08T12:00:00Z" } })),
    });

    await render(<BillingsScreen client={client} />);
    await fireEvent.press(await screen.findByRole("button", { name: "Cobrança Churrasco" }));

    expect(await screen.findByText("Cobranças geradas")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Convidar" })).toBeNull();
    expect(screen.queryByText("Convite ativo até 08/10")).toBeNull();
    expect(screen.queryByRole("button", { name: "Compartilhar convite" })).toBeNull();
  });

  it("ends only after confirmation, revokes the invite and hides edit afterwards", async () => {
    const client = makeClient({
      billing: jest.fn().mockResolvedValue(
        detail({ type: "indefinite", invite: { url: "http://localhost:3000/join/abc", expiresAt: "2026-10-08T12:00:00Z" } }),
      ),
    });

    await render(<BillingsScreen client={client} />);
    await fireEvent.press(await screen.findByRole("button", { name: "Cobrança Churrasco" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Encerrar" }));

    expect(client.patchBilling).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole("button", { name: "Confirmar encerramento" }));

    await waitFor(() => expect(client.patchBilling).toHaveBeenCalledWith("b1", { state: "ended" }));
    await waitFor(() => expect(client.revokeInvite).toHaveBeenCalledWith("b1"));
    expect(await screen.findByText(/Encerrada/)).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Editar" })).toBeNull();
    expect(screen.queryByText("Convite ativo até 08/10")).toBeNull();
  });

  it("offers the FAB and the empty state to create a billing", async () => {
    const onCreate = jest.fn();
    const client = makeClient();

    await render(<BillingsScreen client={client} onCreate={onCreate} />);
    await fireEvent.press(await screen.findByRole("button", { name: "Nova cobrança" }));

    expect(onCreate).toHaveBeenCalled();
  });

  it("shows the empty state when there is no billing yet", async () => {
    const client = makeClient({ billings: jest.fn().mockResolvedValue({ billings: [], nextCursor: null }) });

    await render(<BillingsScreen client={client} />);

    expect(await screen.findByText("Nenhuma cobrança ainda")).toBeOnTheScreen();
    expect(screen.getAllByRole("button", { name: "Nova cobrança" }).length).toBeGreaterThan(1);
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

  it("keeps the Cobranças tab selected and navigates to the other tabs", async () => {
    const onOpenFeed = jest.fn();
    const onOpenSettings = jest.fn();

    await render(<BillingsScreen client={makeClient()} onOpenFeed={onOpenFeed} onOpenSettings={onOpenSettings} />);

    expect(screen.getByRole("button", { name: "Cobranças", selected: true })).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("button", { name: "Feed" }));
    await fireEvent.press(screen.getByRole("button", { name: "Perfil" }));

    expect(onOpenFeed).toHaveBeenCalled();
    expect(onOpenSettings).toHaveBeenCalled();
  });
});
