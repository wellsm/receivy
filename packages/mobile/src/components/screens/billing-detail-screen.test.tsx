import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";
import { Alert, Share } from "react-native";
import { BillingCategory, BillingFrequency, BillingState, BillingKind, BillingRecurrence, ChargeState, chargeShareText, Direction, PendingChargesAction, PixKeyType, ProofKind, ProofMime, ProofState, SharingState, SplitMode, SplitPartKind, type BillingAllocation, type BillingDetail, type ChargeDetail } from "@receivy/common";
import { BillingDetailScreen } from "@/components/screens/billing-detail-screen";

jest.mock("expo-router", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot close over module imports
  const react = require("react");

  return { useFocusEffect: (callback: () => void | (() => void)) => react.useEffect(() => callback(), [callback]) };
});

jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn().mockResolvedValue(true) }));

const PIX = { keyType: PixKeyType.Phone, key: "11987654321", label: "Inter" };

function charge(overrides: Partial<ChargeDetail> & { id: string; name: string }): ChargeDetail {
  const { name, ...rest } = overrides;

  return {
    description: "Jantar de despedida",
    amount: { amountCents: 6_000, currency: "BRL" },
    dueDate: "2026-11-15",
    state: ChargeState.Pending,
    billingId: "b1",
    recurrence: BillingRecurrence.Until,
    installment: 2,
    installmentCount: 3,
    counterpartName: name,
    proofState: null,
    direction: Direction.Receivable,
    recipient: { userId: "u1", name, email: null },
    debtorId: "u1",
    pix: PIX,
    sharingState: SharingState.Ready,
    proof: null,
    cancelledAt: null,
    paidAt: null,
    createdAt: "2026-10-01T00:00:00Z",
    ...rest,
  };
}

const firstCycle = [
  charge({ id: "c1", name: "Lucas F.", dueDate: "2026-10-15", installment: 1, state: ChargeState.Paid, paidAt: "2026-10-14T22:42:00Z" }),
  charge({ id: "c2", name: "Mariana S.", dueDate: "2026-10-15", installment: 1, state: ChargeState.Paid, paidAt: "2026-10-15T11:15:00Z" }),
  charge({ id: "c3", name: "Carlos", dueDate: "2026-10-15", installment: 1, state: ChargeState.Paid, paidAt: "2026-10-15T12:00:00Z" }),
];

const secondCycle = [
  charge({ id: "c4", name: "Lucas F.", state: ChargeState.Paid, paidAt: "2026-11-14T22:42:00Z" }),
  charge({ id: "c5", name: "Mariana S.", state: ChargeState.Paid, paidAt: "2026-11-15T11:15:00Z" }),
  charge({ id: "c6", name: "Carlos" }),
];

function billing(overrides: Partial<BillingDetail> = {}): BillingDetail {
  return {
    id: "b1",
    recurrence: BillingRecurrence.Until,
    type: Direction.Receivable,
    contact: null,
    payee: null,
    pix: null,
    description: "Jantar de despedida",
    total: { amountCents: 18_000, currency: "BRL" },
    startDate: "2026-10-15",
    endDate: "2026-12-15",
    state: BillingState.Active,
    installmentCount: 3,
    nextDueDate: "2026-11-15",
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    timezone: "America/Sao_Paulo",
    paymentMethodId: "pix-1",
    reminders: [],
    split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: "u1" }] },
    allocations: [],
    charges: [...firstCycle, ...secondCycle],
    previews: [],
    nextMaterialization: null,
    category: BillingCategory.Food,
    invite: null,
    guests: [],
    linkableContacts: [],
    ...overrides,
  };
}

function makeClient(detail = billing(), overrides: Record<string, unknown> = {}) {
  return {
    billing: jest.fn().mockResolvedValue(detail),
    patchBilling: jest.fn().mockResolvedValue({ ...detail, state: "ended" }),
    invite: jest.fn().mockResolvedValue({ url: "http://localhost:3000/join/abc", expiresAt: "2026-10-08T12:00:00Z" }),
    revokeInvite: jest.fn().mockResolvedValue(undefined),
    resolveGuest: jest.fn().mockResolvedValue(detail),
    setParticipantNotify: jest.fn().mockResolvedValue(detail),
    publicLink: jest.fn().mockResolvedValue({ token: "tk" }),
    publicChargeUrl: (token: string) => `http://localhost:3000/pay/${token}`,
    paymentMethods: jest.fn().mockResolvedValue({ paymentMethods: [] }),
    pay: jest.fn().mockResolvedValue(charge({ id: "c6", name: "Carlos", state: ChargeState.Paid })),
    reopen: jest.fn().mockResolvedValue(charge({ id: "c4", name: "Lucas F." })),
    reviewProof: jest.fn().mockResolvedValue(charge({ id: "c6", name: "Carlos", state: ChargeState.Paid })),
    ...overrides,
  };
}

async function open(client = makeClient(), props: Record<string, unknown> = {}) {
  await render(<BillingDetailScreen id="b1" client={client} {...props} />);
  await screen.findByRole("header", { name: "Jantar de despedida" });

  return { client };
}

describe("BillingDetailScreen", () => {
  beforeEach(() => {
    jest.spyOn(Share, "share").mockResolvedValue({ action: Share.sharedAction });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  // Only Date is faked: RNTL keeps its real timers for waitFor/findBy.
  function pinClock(iso: string) {
    jest.useFakeTimers({
      now: new Date(iso),
      doNotFake: ["nextTick", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout", "queueMicrotask", "requestAnimationFrame", "cancelAnimationFrame", "requestIdleCallback", "cancelIdleCallback", "hrtime", "performance"],
    });
  }

  it("sums the current cycle in the hero and lists its participants with their status", async () => {
    // Pinned before the second cycle's due date (2026-11-15) so Carlos's charge reads "Pendente", not
    // "Vence hoje"/"Atrasado" once the real clock catches up to it.
    pinClock("2026-11-10T12:00:00Z");

    await open();

    expect(screen.getByText("Parcelado (2/3)")).toBeOnTheScreen();
    expect(screen.getByText("Ativa")).toBeOnTheScreen();
    expect(screen.getByText("15/11/2026")).toBeOnTheScreen();
    expect(screen.getByText("R$ 120,00")).toBeOnTheScreen();
    expect(screen.getByText("66% liquidado")).toBeOnTheScreen();
    expect(screen.getByText("Falta R$ 60,00")).toBeOnTheScreen();
    expect(screen.getByText("11987654321")).toBeOnTheScreen();
    expect(screen.getByText("Ciclo 2 de 3")).toBeOnTheScreen();

    const lucas = screen.getByRole("button", { name: "Abrir cobrança de Lucas F." });

    expect(within(lucas).getByText("Pago em 14/11 às 19:42")).toBeOnTheScreen();
    expect(within(lucas).getByText("Pago")).toBeOnTheScreen();
    expect(screen.getByText("Pendente")).toBeOnTheScreen();
    expect(screen.getByText("Aguardando pagamento")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Compartilhar link de Carlos" })).toBeOnTheScreen();
  });

  it("tags an overdue pending charge Atrasado", async () => {
    pinClock("2026-11-20T12:00:00Z"); // noon UTC = 09:00 in America/Sao_Paulo, same calendar day

    const overdue = billing({ nextDueDate: "2026-11-15", charges: [charge({ id: "c1", name: "Carlos", dueDate: "2026-11-15" })] });
    await open(makeClient(overdue));

    expect(screen.getByText("Atrasado")).toBeOnTheScreen();
  });

  it("tags a charge due today Vence hoje", async () => {
    pinClock("2026-11-20T12:00:00Z");

    const dueToday = billing({ nextDueDate: "2026-11-20", charges: [charge({ id: "c2", name: "Carlos", dueDate: "2026-11-20" })] });
    await open(makeClient(dueToday));

    // The corner tag and the secondary line both read "Vence hoje" for a charge due today.
    expect(screen.getAllByText("Vence hoje")).toHaveLength(2);
  });

  it("keeps a far-future pending charge tagged Pendente", async () => {
    pinClock("2026-11-20T12:00:00Z");

    const future = billing({ nextDueDate: "2027-01-31", charges: [charge({ id: "c3", name: "Carlos", dueDate: "2027-01-31" })] });
    await open(makeClient(future));

    expect(screen.getByText("Pendente")).toBeOnTheScreen();
  });

  it("still tags a paid charge Pago once its due date has passed", async () => {
    pinClock("2026-11-20T12:00:00Z");

    const paid = billing({
      nextDueDate: "2026-11-15",
      charges: [charge({ id: "c1", name: "Carlos", dueDate: "2026-11-15", state: ChargeState.Paid, paidAt: "2026-11-14T22:42:00Z" })],
    });
    await open(makeClient(paid));

    expect(screen.getByText("Pago")).toBeOnTheScreen();
  });

  it("asks the owner to review a sent proof instead of sharing the link", async () => {
    const detail = billing({ charges: [charge({ id: "c4", name: "Lucas F.", state: ChargeState.Paid }), charge({ id: "c6", name: "Carlos", proofState: ProofState.Pending })] });
    const onOpenCharge = jest.fn();

    await open(makeClient(detail), { onOpenCharge });

    expect(screen.getByText("Em revisão")).toBeOnTheScreen();
    expect(screen.getByText("Comprovante em revisão")).toBeOnTheScreen();
    expect(screen.queryByText("Aguardando pagamento")).toBeNull();
    expect(screen.queryByRole("button", { name: "Compartilhar link de Carlos" })).toBeNull();

    await fireEvent.press(screen.getByRole("button", { name: "Revisar comprovante de Carlos" }));

    expect(onOpenCharge).toHaveBeenCalledWith("c6");
  });

  it("accepts the proof under review when the owner marks the participant as paid", async () => {
    jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons) => buttons?.find((button) => button.text === "Marcar paga")?.onPress?.());
    const pending = { state: ProofState.Pending, kind: ProofKind.File, file: { name: "pix.png", mime: ProofMime.Png, size: 10 }, sentAt: "2026-11-12T10:00:00Z", reviewedAt: null, reason: null, sentByViewer: false };
    const detail = billing({ charges: [charge({ id: "c4", name: "Lucas F.", state: ChargeState.Paid }), charge({ id: "c6", name: "Carlos", proofState: ProofState.Pending, proof: pending })] });
    const { client } = await open(makeClient(detail));

    await fireEvent.press(screen.getByRole("button", { name: "Marcar Carlos como pago" }));

    await waitFor(() => expect(client.reviewProof).toHaveBeenCalledWith("c6", "accepted"));
    expect(client.pay).not.toHaveBeenCalled();
    expect(await screen.findByText("Pagamento de Carlos registrado.")).toBeOnTheScreen();
    expect(client.billing).toHaveBeenCalledTimes(2);
  });

  it("lists every cycle in the history, newest first", async () => {
    await open();

    expect(screen.getByText("Total: 2 ciclos")).toBeOnTheScreen();
    expect(screen.getByText(/Parcela 2 de 3/)).toBeOnTheScreen();
    expect(screen.getByText("2 de 3 participantes pagos")).toBeOnTheScreen();
    expect(screen.getByText("Em andamento")).toBeOnTheScreen();
    expect(screen.getByText(/Parcela 1 de 3/)).toBeOnTheScreen();
    expect(screen.getByText("Todos os 3 pagaram")).toBeOnTheScreen();
    expect(screen.getByText("Concluída")).toBeOnTheScreen();
  });

  it("copies the Pix key and shares the link of a pending participant from the row", async () => {
    const { client } = await open();

    await fireEvent.press(screen.getByRole("button", { name: "Copiar chave Pix" }));
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith("11987654321");
    expect(await screen.findByText("Copiado")).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("button", { name: "Compartilhar link de Carlos" }));
    await waitFor(() => expect(client.publicLink).toHaveBeenCalledWith("c6"));
    expect(Share.share).toHaveBeenCalledWith(expect.objectContaining({ message: chargeShareText(charge({ id: "c6", name: "Carlos" }), "http://localhost:3000/pay/tk") }));
  });

  it("marks a pending participant as paid after confirmation and reloads the billing", async () => {
    jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons) => buttons?.find((button) => button.text === "Marcar paga")?.onPress?.());
    const { client } = await open();

    await fireEvent.press(screen.getByRole("button", { name: "Marcar Carlos como pago" }));

    await waitFor(() => expect(client.pay).toHaveBeenCalledWith("c6"));
    expect(await screen.findByText("Pagamento de Carlos registrado.")).toBeOnTheScreen();
    expect(client.billing).toHaveBeenCalledTimes(2);
  });

  it("reopens a paid participant after confirmation and reloads the billing", async () => {
    jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons) => buttons?.find((button) => button.text === "Reabrir")?.onPress?.());
    const { client } = await open();

    await fireEvent.press(screen.getByRole("button", { name: "Reabrir cobrança de Lucas F." }));

    await waitFor(() => expect(client.reopen).toHaveBeenCalledWith("c4"));
    await waitFor(() => expect(client.billing).toHaveBeenCalledTimes(2));
  });

  it("shares the payment link of the only pending participant", async () => {
    const { client } = await open();

    await fireEvent.press(screen.getByRole("button", { name: "Compartilhar link de pagamento" }));

    await waitFor(() => expect(client.publicLink).toHaveBeenCalledWith("c6"));
    expect(Share.share).toHaveBeenCalledWith(expect.objectContaining({ message: chargeShareText(charge({ id: "c6", name: "Carlos" }), "http://localhost:3000/pay/tk") }));
  });

  it("asks whose link to share when more than one participant is pending", async () => {
    const detail = billing({ charges: [...firstCycle, charge({ id: "c4", name: "Lucas F." }), charge({ id: "c6", name: "Carlos" })] });
    const { client } = await open(makeClient(detail));

    await fireEvent.press(screen.getByRole("button", { name: "Compartilhar link de pagamento" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Link de Lucas F." }));

    await waitFor(() => expect(client.publicLink).toHaveBeenCalledWith("c4"));
  });

  it("opens the charge and the edit form from the actions", async () => {
    const onOpenCharge = jest.fn();
    const onEdit = jest.fn();

    await open(makeClient(), { onOpenCharge, onEdit });
    await fireEvent.press(screen.getByRole("button", { name: "Abrir cobrança de Carlos" }));
    await fireEvent.press(screen.getByRole("button", { name: "Editar" }));

    expect(onOpenCharge).toHaveBeenCalledWith("c6");
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "b1" }));
  });

  it("creates, shares and revokes the invite", async () => {
    const { client } = await open();

    await fireEvent.press(screen.getByRole("button", { name: "Convidar" }));

    await waitFor(() => expect(client.invite).toHaveBeenCalledWith("b1"));
    expect(Share.share).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Entre na conta Jantar de despedida no Receivy: http://localhost:3000/join/abc" }),
    );
    expect(await screen.findByText("Convite ativo até 08/10")).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("button", { name: "Revogar convite" }));

    await waitFor(() => expect(client.revokeInvite).toHaveBeenCalledWith("b1"));
    expect(screen.queryByText("Convite ativo até 08/10")).toBeNull();
  });

  it("shares an invite that already exists instead of issuing a new one", async () => {
    const { client } = await open(makeClient(billing({ invite: { url: "http://localhost:3000/join/abc", expiresAt: "2026-10-08T12:00:00Z" } })));

    expect(screen.getByText("Convite ativo até 08/10")).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("button", { name: "Convidar" }));

    expect(client.invite).not.toHaveBeenCalled();
    expect(Share.share).toHaveBeenCalled();
  });

  it("links a guest who came in by the link to the contact the owner picks", async () => {
    const guest = { id: "g1", userId: "u9", name: "José Silva", email: "ze@example.com", createdAt: "2026-10-02T00:00:00Z" };
    const detail = billing({ guests: [guest], linkableContacts: [{ contactId: "c1", displayName: "Zé" }] });
    const client = makeClient(detail, { resolveGuest: jest.fn().mockResolvedValue(billing()) });

    await open(client);

    expect(screen.getByText("Aguardando você")).toBeOnTheScreen();
    expect(screen.getByText("José Silva")).toBeOnTheScreen();
    expect(screen.getByText("ze@example.com")).toBeOnTheScreen();
    expect(screen.getByText("Entrou pelo link. Quem é essa pessoa?")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Novo participante José Silva" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Ignorar José Silva" })).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("button", { name: "É Zé" }));

    await waitFor(() => expect(client.resolveGuest).toHaveBeenCalledWith("b1", "g1", { action: "link", contactId: "c1" }));
    await waitFor(() => expect(screen.queryByText("Aguardando você")).toBeNull());
    expect(screen.queryByText("José Silva")).toBeNull();
  });

  it("asks what to do with the pending charges before pausing a subscription", async () => {
    const detail = billing({ recurrence: BillingRecurrence.Indefinite, frequency: BillingFrequency.Monthly, installmentCount: undefined, endDate: undefined });
    const client = makeClient(detail, { patchBilling: jest.fn().mockResolvedValue({ ...detail, state: BillingState.Paused }) });

    await open(client);

    expect(screen.getByText("Recorrente mensal")).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("button", { name: "Pausar" }));

    expect(screen.getByRole("header", { name: "Pausar conta?" })).toBeOnTheScreen();
    expect(client.patchBilling).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole("button", { name: "Manter as deste mês" }));

    await waitFor(() => expect(client.patchBilling).toHaveBeenCalledWith("b1", { state: BillingState.Paused, pendingCharges: PendingChargesAction.Keep }));
    expect(await screen.findByRole("button", { name: "Retomar" })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Convidar" })).toBeNull();
  });

  it("pauses right away when nothing is pending", async () => {
    const detail = billing({ recurrence: BillingRecurrence.Indefinite, frequency: BillingFrequency.Monthly, installmentCount: undefined, endDate: undefined, charges: firstCycle });
    const client = makeClient(detail, { patchBilling: jest.fn().mockResolvedValue({ ...detail, state: BillingState.Paused }) });

    await open(client);
    await fireEvent.press(screen.getByRole("button", { name: "Pausar" }));

    await waitFor(() => expect(client.patchBilling).toHaveBeenCalledWith("b1", { state: BillingState.Paused }));
    expect(screen.queryByRole("header", { name: "Pausar conta?" })).toBeNull();
  });

  it("names the Pix key from the wallet while no charge has been generated", async () => {
    const detail = billing({ recurrence: BillingRecurrence.Indefinite, frequency: BillingFrequency.Monthly, installmentCount: undefined, endDate: undefined, charges: [], paymentMethodId: "pix-2" });
    const wallet = [{ id: "pix-2", type: "pix", pixKeyType: "email", pixKey: "ana@example.com", label: "Nubank", isDefault: true, archivedAt: null, createdAt: "" }];

    await open(makeClient(detail, { paymentMethods: jest.fn().mockResolvedValue({ paymentMethods: wallet }) }));

    expect(screen.getByText("ana@example.com")).toBeOnTheScreen();
    expect(screen.queryByText("Sem chave Pix vinculada")).toBeNull();
  });

  it("has no pause for a finite billing", async () => {
    await open();

    expect(screen.queryByRole("button", { name: "Pausar" })).toBeNull();
  });

  it("ends cancelling the pending charges, revokes the invite and hides the actions", async () => {
    const detail = billing({ invite: { url: "http://localhost:3000/join/abc", expiresAt: "2026-10-08T12:00:00Z" } });
    const { client } = await open(makeClient(detail));

    await fireEvent.press(screen.getByRole("button", { name: "Encerrar" }));

    expect(screen.getByRole("header", { name: "Encerrar conta?" })).toBeOnTheScreen();
    expect(client.patchBilling).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole("button", { name: "Cancelar pendentes (1)" }));

    await waitFor(() => expect(client.patchBilling).toHaveBeenCalledWith("b1", { state: BillingState.Ended, pendingCharges: PendingChargesAction.Cancel }));
    await waitFor(() => expect(client.revokeInvite).toHaveBeenCalledWith("b1"));
    expect(await screen.findByText("Encerrada")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Editar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Compartilhar link de pagamento" })).toBeNull();
  });

  it("ends with the simple confirmation when nothing is pending", async () => {
    const { client } = await open(makeClient(billing({ charges: firstCycle })));

    await fireEvent.press(screen.getByRole("button", { name: "Encerrar" }));
    await fireEvent.press(screen.getByRole("button", { name: "Confirmar encerramento" }));

    await waitFor(() => expect(client.patchBilling).toHaveBeenCalledWith("b1", { state: BillingState.Ended }));
  });

  it("reports a billing that cannot be loaded and retries", async () => {
    const client = makeClient(billing(), { billing: jest.fn().mockRejectedValueOnce(new Error("Sem rede.")).mockResolvedValue(billing()) });

    await render(<BillingDetailScreen id="b1" client={client} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Sem rede.");

    await fireEvent.press(screen.getByRole("button", { name: "Tentar novamente" }));

    expect(await screen.findByRole("header", { name: "Jantar de despedida" })).toBeOnTheScreen();
  });

  it("shows a conta a pagar with its own key and without invites or links", async () => {
    const own = charge({ id: "c7", name: "Ana", direction: Direction.Payable, ownedByViewer: true, counterpartName: "Ana", pix: null });
    const detail = billing({
      type: Direction.Payable,
      contact: { id: "c1", userId: "u1", name: "Ana", avatar: null },
      pix: { keyType: PixKeyType.Email, key: "ana@example.com", label: "Nubank" },
      paymentMethodId: undefined,
      charges: [own],
    });
    const { client } = await open(makeClient(detail));

    expect(screen.getByText("A pagar")).toBeOnTheScreen();
    expect(screen.getByText("Total pago")).toBeOnTheScreen();
    expect(screen.getByText("ana@example.com")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Copiar chave Pix" })).toBeOnTheScreen();
    expect(screen.getByText("Cobranças")).toBeOnTheScreen();
    expect(screen.queryByText("Participantes")).toBeNull();
    expect(screen.getByRole("button", { name: "Abrir cobrança de Ana" })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Convidar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Compartilhar link de Ana" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Compartilhar link de pagamento" })).toBeNull();
    expect(screen.getByRole("button", { name: "Editar" })).toHaveProp("accessibilityHint", "Categoria, Pix e lembretes");
    expect(client.invite).not.toHaveBeenCalled();
    expect(Share.share).not.toHaveBeenCalled();
  });

  it("names the owner's own bill and falls back to no key on a conta a pagar", async () => {
    const own = charge({ id: "c7", name: "Você", direction: Direction.Payable, ownedByViewer: true, counterpartName: "Você", pix: null });
    const detail = billing({ type: Direction.Payable, contact: null, pix: null, paymentMethodId: undefined, charges: [own] });

    await open(makeClient(detail));

    expect(screen.getByRole("button", { name: "Abrir cobrança de Só comigo" })).toBeOnTheScreen();
    expect(screen.getByText("Sem chave Pix vinculada")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Copiar chave Pix" })).toBeNull();
  });

  it("badges each silenced charge on its own row and shows the participant action once", async () => {
    const allocation: BillingAllocation = { kind: SplitPartKind.User, userId: "u1", splitMode: SplitMode.Equal, amount: { amountCents: 6_000, currency: "BRL" }, order: 0, notify: true };
    const detail = billing({
      charges: [charge({ id: "c6", name: "Carlos", notify: false }), charge({ id: "c7", name: "Carlos", state: ChargeState.Cancelled, cancelledAt: "2026-11-01T00:00:00Z" })],
      allocations: [allocation],
    });

    await open(makeClient(detail));

    expect(screen.getAllByRole("button", { name: "Abrir cobrança de Carlos" })).toHaveLength(2);
    expect(screen.getAllByText("Sem avisos")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Não notificar Carlos" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Voltar a notificar Carlos" })).toBeNull();
  });

  it("silences a participant after confirmation and turns the notices back on without asking", async () => {
    const allocation: BillingAllocation = { kind: SplitPartKind.User, userId: "u1", splitMode: SplitMode.Equal, amount: { amountCents: 6_000, currency: "BRL" }, order: 0, notify: true };
    const loud = billing({ charges: [charge({ id: "c6", name: "Carlos", notify: true })], allocations: [allocation] });
    const quiet = billing({ charges: [charge({ id: "c6", name: "Carlos", notify: false })], allocations: [{ ...allocation, notify: false }] });
    const setParticipantNotify = jest.fn(async (_billingId: string, _userId: string, notify: boolean) => (notify ? loud : quiet));

    jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons) => buttons?.find((button) => button.text === "Não notificar")?.onPress?.());

    await open(makeClient(loud, { setParticipantNotify }));
    await fireEvent.press(screen.getByRole("button", { name: "Não notificar Carlos" }));

    expect(Alert.alert).toHaveBeenCalledWith("Não notificar Carlos?", "Os lembretes automáticos das cobranças pendentes e futuras de Carlos nesta conta param.", expect.any(Array));
    await waitFor(() => expect(setParticipantNotify).toHaveBeenCalledWith("b1", "u1", false));
    expect(await screen.findByText("Sem avisos")).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("button", { name: "Voltar a notificar Carlos" }));

    await waitFor(() => expect(setParticipantNotify).toHaveBeenLastCalledWith("b1", "u1", true));
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Avisos reativados para Carlos.")).toBeOnTheScreen();
    expect(screen.queryByText("Sem avisos")).toBeNull();
  });

  it("heads a registro with its counterpart and hides the invite and the payment links", async () => {
    const salary = charge({
      id: "c8",
      name: "Empresa X",
      recipient: { userId: null, name: "Empresa X", email: null },
      debtorId: null,
      pix: null,
      sharingState: SharingState.Closed,
      kind: BillingKind.Record,
      counterpartLabel: "Empresa X",
    });
    const detail = billing({ kind: BillingKind.Record, paymentMethodId: undefined, split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: "u1" }] }, charges: [salary] });

    await open(makeClient(detail));

    expect(screen.getByText("De Empresa X")).toBeOnTheScreen();
    expect(screen.getByText("Registro")).toBeOnTheScreen();
    expect(screen.getByText("Cobranças")).toBeOnTheScreen();
    expect(screen.queryByText("Participantes")).toBeNull();
    expect(screen.getByRole("button", { name: "Marcar Empresa X como pago" })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Convidar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Compartilhar link de Empresa X" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Compartilhar link de pagamento" })).toBeNull();
  });

  it("heads a registro a pagar with Para and names its rows after the counterpart", async () => {
    const rent = charge({
      id: "c9",
      name: "Imobiliária",
      direction: Direction.Payable,
      ownedByViewer: true,
      recipient: { userId: null, name: "Imobiliária", email: null },
      debtorId: null,
      pix: null,
      kind: BillingKind.Record,
      counterpartLabel: "Imobiliária",
    });

    await open(makeClient(billing({ type: Direction.Payable, kind: BillingKind.Record, contact: { id: "c2", userId: "u2", name: "Imobiliária", avatar: null }, paymentMethodId: undefined, charges: [rent] })));

    expect(screen.getByText("Para Imobiliária")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Abrir cobrança de Imobiliária" })).toBeOnTheScreen();
  });
});
