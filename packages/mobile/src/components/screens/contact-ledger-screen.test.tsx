import { BillingRecurrence, ChargeState, Direction, ProofState, SharingState, UserStatus, type ChargeDetail, type Contact, type ContactLedger } from "@receivy/common";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Share } from "react-native";
import { ContactLedgerScreen } from "@/components/screens/contact-ledger-screen";

let mockFocus: (() => void | (() => void)) | null = null;

// The edit form leaves this route mounted under the Stack, so the focus callback
// is kept here and replayed by the test instead of remounting the screen.
jest.mock("expo-router", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot close over module imports
  const react = require("react");

  return {
    useFocusEffect: (callback: () => void | (() => void)) => {
      mockFocus = callback;
      react.useEffect(() => callback(), [callback]);
    },
  };
});

/** Replays the screen's focus effect, the way expo-router does on `router.back()`. */
async function refocus() {
  await act(async () => {
    mockFocus?.();
  });
}

function contact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: "p1",
    userId: "u1",
    name: "Ana Paula Souza",
    nickname: null,
    displayName: "Ana Paula Souza",
    email: "ana@example.com",
    phone: null,
    status: UserStatus.Active,
    archivedAt: null,
    createdAt: "2026-09-01T00:00:00Z",
    lastBilledAt: null,
    activeCharges: 0,
    ...overrides,
  };
}

function charge(overrides: Partial<ChargeDetail> & { id: string }): ChargeDetail {
  return {
    description: "Jantar",
    amount: { amountCents: 6_000, currency: "BRL" },
    dueDate: "2099-01-15",
    state: ChargeState.Pending,
    billingId: "b1",
    recurrence: BillingRecurrence.Until,
    installment: 2,
    installmentCount: 3,
    counterpartName: "Ana Paula Souza",
    proofState: null,
    direction: Direction.Receivable,
    recipient: { userId: "u1", name: "Ana Paula Souza", email: "ana@example.com" },
    debtorId: "u1",
    payment: null,
    paymentLink: null,
    receiptUrl: null,
    sharingState: SharingState.Ready,
    proof: null,
    cancelledAt: null,
    paidAt: null,
    createdAt: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

function ledger(overrides: Partial<Contact> = {}, charges: ChargeDetail[] = []): ContactLedger {
  return {
    contactId: "p1",
    contact: contact(overrides),
    receivable: { amountCents: charges.filter((item) => item.state === "pending").reduce((sum, item) => sum + item.amount.amountCents, 0), currency: "BRL" },
    payable: { amountCents: 0, currency: "BRL" },
    charges,
    nextCursor: null,
  };
}

function makeClient(page = ledger()) {
  return {
    ledger: jest.fn().mockResolvedValue(page),
    publicLink: jest.fn().mockResolvedValue({ token: "tk" }),
    publicChargeUrl: (token: string) => `http://localhost:3000/pay/${token}`,
  };
}

describe("ContactLedgerScreen", () => {
  it("shows the display name, the full name, the e-mail and the formatted phone", async () => {
    const client = makeClient(ledger({ nickname: "Aninha", displayName: "Aninha", phone: "+5511987654321" }));

    await render(<ContactLedgerScreen id="p1" client={client} />);

    expect(await screen.findByText("Aninha")).toBeOnTheScreen();
    expect(screen.getByText("Ana Paula Souza")).toBeOnTheScreen();
    expect(screen.getByText("ana@example.com")).toBeOnTheScreen();
    expect(screen.getByText("(11) 98765-4321")).toBeOnTheScreen();
    expect(screen.queryByText("Ainda não entrou")).toBeNull();
  });

  it("tells when the person has not signed in yet", async () => {
    const client = makeClient(ledger({ status: UserStatus.Pending }));

    await render(<ContactLedgerScreen id="p1" client={client} />);

    expect(await screen.findByText("Ainda não entrou")).toBeOnTheScreen();
  });

  it("reloads on focus so the edit form's save is visible when it pops back", async () => {
    const client = makeClient();

    client.ledger.mockResolvedValueOnce(ledger());
    client.ledger.mockResolvedValue(ledger({ nickname: "Aninha", displayName: "Aninha", phone: "+5511987654321" }));

    await render(<ContactLedgerScreen id="p1" client={client} />);

    expect(await screen.findByText("Ana Paula Souza")).toBeOnTheScreen();

    await refocus();

    expect(await screen.findByText("Aninha")).toBeOnTheScreen();
    expect(screen.getByText("(11) 98765-4321")).toBeOnTheScreen();
    expect(client.ledger).toHaveBeenCalledTimes(2);
  });

  it("reports a ledger failure", async () => {
    const client = makeClient();

    client.ledger.mockRejectedValue(new Error("Sem conexão."));

    await render(<ContactLedgerScreen id="p1" client={client} />);

    expect(await screen.findByText("Sem conexão.")).toBeOnTheScreen();
  });

  it("splits active charges from the history and sums the balance", async () => {
    const paid = charge({ id: "c0", description: "Churrasco", state: ChargeState.Paid, paidAt: "2026-09-28T15:00:00Z", amount: { amountCents: 12_000, currency: "BRL" } });
    const waiting = charge({ id: "c2", description: "Futebol", proofState: ProofState.Pending, installmentCount: 1, installment: 1 });
    const client = makeClient(ledger({}, [charge({ id: "c1" }), waiting, paid]));

    await render(<ContactLedgerScreen id="p1" client={client} onEdit={jest.fn()} onNewCharge={jest.fn()} />);

    expect(await screen.findByText("2 cobranças ativas")).toBeOnTheScreen();
    expect(screen.getByText("Balanço com Ana")).toBeOnTheScreen();
    expect(screen.getByText("3 cobranças no total")).toBeOnTheScreen();
    expect(screen.getByText("2 pendências")).toBeOnTheScreen();
    expect(screen.getAllByText("R$ 120,00")).toHaveLength(3);
    expect(screen.getByText("1 quitada")).toBeOnTheScreen();
    expect(screen.getByText("Parcela 2 de 3 • Vencimento em 15/01/2099")).toBeOnTheScreen();
    expect(screen.getByText("Pendente")).toBeOnTheScreen();
    expect(screen.getByText("Aguardando comprovante")).toBeOnTheScreen();
    expect(screen.getByText("Pago em 28/09/2026")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Cobrar" })).toBeOnTheScreen();
  });

  it("hands the whole contact to a new charge so the draft can seat the user id", async () => {
    const onNewCharge = jest.fn();
    const client = makeClient(ledger({ userId: "u9" }));

    await render(<ContactLedgerScreen id="p1" client={client} onNewCharge={onNewCharge} />);

    await fireEvent.press(await screen.findByRole("button", { name: "Cobrar" }));

    expect(onNewCharge).toHaveBeenCalledWith(expect.objectContaining({ id: "p1", userId: "u9" }));
  });

  it("shares the payment link and reminds from an active charge", async () => {
    jest.spyOn(Share, "share").mockResolvedValue({ action: Share.sharedAction });

    const notifications = { remind: jest.fn().mockResolvedValue({ channels: ["push"], dropped: [] }) };
    const client = makeClient(ledger({}, [charge({ id: "c1" })]));

    await render(<ContactLedgerScreen id="p1" client={client} notifications={notifications} />);

    await fireEvent.press(await screen.findByRole("button", { name: "Link de Jantar" }));
    await waitFor(() => expect(client.publicLink).toHaveBeenCalledWith("c1"));

    expect(Share.share).toHaveBeenCalledWith(expect.objectContaining({ message: "http://localhost:3000/pay/tk" }));

    await fireEvent.press(screen.getByRole("button", { name: "Lembrar Jantar" }));
    await waitFor(() => expect(notifications.remind).toHaveBeenCalledWith("c1"));

    expect(await screen.findByText("Lembrete enviado.")).toBeOnTheScreen();

    jest.restoreAllMocks();
  });

  it("removes the contact only after the confirmation and hides the actions afterwards", async () => {
    const contacts = { archive: jest.fn().mockResolvedValue(undefined) };
    const client = makeClient();

    client.ledger.mockResolvedValueOnce(ledger()).mockResolvedValue(ledger({ archivedAt: "2026-10-01T00:00:00Z" }));

    await render(<ContactLedgerScreen id="p1" client={client} contacts={contacts} onEdit={jest.fn()} onNewCharge={jest.fn()} />);

    await fireEvent.press(await screen.findByRole("button", { name: "Remover" }));

    expect(contacts.archive).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole("button", { name: "Confirmar remoção" }));

    await waitFor(() => expect(contacts.archive).toHaveBeenCalledWith("p1"));

    expect(await screen.findByText("Contato removido")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Editar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cobrar" })).toBeNull();
  });
});
