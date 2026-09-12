import type { ChargeDetail, Person, PersonLedger } from "@receivy/common";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Share } from "react-native";
import { PersonLedgerScreen } from "@/components/screens/person-ledger-screen";

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

function person(overrides: Partial<Person> = {}): Person {
  return {
    id: "p1",
    name: "Ana Paula Souza",
    nickname: null,
    displayName: "Ana Paula Souza",
    email: null,
    phone: null,
    archivedAt: null,
    createdAt: "2026-09-01T00:00:00Z",
    hasAccount: false,
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
    state: "pending",
    billingId: "b1",
    billingType: "until",
    installment: 2,
    installmentCount: 3,
    counterpartName: "Ana Paula Souza",
    proofState: null,
    direction: "receivable",
    recipient: { name: "Ana Paula Souza", email: null },
    pix: null,
    sharingState: "ready",
    payment: null,
    cancelledAt: null,
    paidAt: null,
    createdAt: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

function ledger(overrides: Partial<Person> = {}, charges: ChargeDetail[] = []): PersonLedger {
  return {
    personId: "p1",
    person: person(overrides),
    balance: { amountCents: 0, currency: "BRL" },
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

describe("PersonLedgerScreen", () => {
  it("shows the display name, the full name and the formatted phone", async () => {
    const client = makeClient(ledger({ nickname: "Aninha", displayName: "Aninha", phone: "+5511987654321" }));

    await render(<PersonLedgerScreen id="p1" client={client} />);

    expect(await screen.findByText("Aninha")).toBeOnTheScreen();
    expect(screen.getByText("Ana Paula Souza")).toBeOnTheScreen();
    expect(screen.getByText("(11) 98765-4321")).toBeOnTheScreen();
  });

  it("reloads on focus so the edit form's save is visible when it pops back", async () => {
    const client = makeClient();

    client.ledger.mockResolvedValueOnce(ledger());
    client.ledger.mockResolvedValue(ledger({ nickname: "Aninha", displayName: "Aninha", phone: "+5511987654321" }));

    await render(<PersonLedgerScreen id="p1" client={client} />);

    expect(await screen.findByText("Ana Paula Souza")).toBeOnTheScreen();

    await refocus();

    expect(await screen.findByText("Aninha")).toBeOnTheScreen();
    expect(screen.getByText("(11) 98765-4321")).toBeOnTheScreen();
    expect(client.ledger).toHaveBeenCalledTimes(2);
  });

  it("reports a ledger failure", async () => {
    const client = makeClient();

    client.ledger.mockRejectedValue(new Error("Sem conexão."));

    await render(<PersonLedgerScreen id="p1" client={client} />);

    expect(await screen.findByText("Sem conexão.")).toBeOnTheScreen();
  });

  it("splits active charges from the history and sums the balance", async () => {
    const paid = charge({ id: "c0", description: "Churrasco", state: "paid", paidAt: "2026-09-28T15:00:00Z", payment: { id: "pay", chargeId: "c0", amount: { amountCents: 12_000, currency: "BRL" }, method: "pix", paidAt: "2026-09-28T15:00:00Z", createdAt: "" }, amount: { amountCents: 12_000, currency: "BRL" } });
    const waiting = charge({ id: "c2", description: "Futebol", proofState: "pending", installmentCount: 1, installment: 1 });
    const client = makeClient(ledger({}, [charge({ id: "c1" }), waiting, paid]));

    await render(<PersonLedgerScreen id="p1" client={client} onEdit={jest.fn()} onNewCharge={jest.fn()} />);

    expect(await screen.findByText("2 cobranças ativas")).toBeOnTheScreen();
    expect(screen.getByText("Balanço com Ana")).toBeOnTheScreen();
    expect(screen.getByText("3 cobranças no total")).toBeOnTheScreen();
    expect(screen.getByText("2 pendências")).toBeOnTheScreen();
    expect(screen.getAllByText("R$ 120,00")).toHaveLength(3);
    expect(screen.getByText("1 quitada")).toBeOnTheScreen();
    expect(screen.getByText("Parcela 2 de 3 • Vencimento em 15/01/2099")).toBeOnTheScreen();
    expect(screen.getByText("Pendente")).toBeOnTheScreen();
    expect(screen.getByText("Aguardando comprovante")).toBeOnTheScreen();
    expect(screen.getByText("Pago em 28/09/2026 via Pix")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Cobrar" })).toBeOnTheScreen();
  });

  it("shares the payment link and reminds from an active charge", async () => {
    jest.spyOn(Share, "share").mockResolvedValue({ action: Share.sharedAction });
    const notifications = { remind: jest.fn().mockResolvedValue({ queued: true }) };
    const client = makeClient(ledger({}, [charge({ id: "c1" })]));

    await render(<PersonLedgerScreen id="p1" client={client} notifications={notifications} />);

    await fireEvent.press(await screen.findByRole("button", { name: "Link de Jantar" }));
    await waitFor(() => expect(client.publicLink).toHaveBeenCalledWith("c1"));
    expect(Share.share).toHaveBeenCalledWith(expect.objectContaining({ message: "http://localhost:3000/pay/tk" }));

    await fireEvent.press(screen.getByRole("button", { name: "Lembrar Jantar" }));
    await waitFor(() => expect(notifications.remind).toHaveBeenCalledWith("c1"));
    expect(await screen.findByText("Lembrete enviado.")).toBeOnTheScreen();

    jest.restoreAllMocks();
  });

  it("removes the contact only after the confirmation and hides the actions afterwards", async () => {
    const people = { archive: jest.fn().mockResolvedValue(undefined) };
    const client = makeClient();

    client.ledger.mockResolvedValueOnce(ledger()).mockResolvedValue(ledger({ archivedAt: "2026-10-01T00:00:00Z" }));

    await render(<PersonLedgerScreen id="p1" client={client} people={people} onEdit={jest.fn()} onNewCharge={jest.fn()} />);

    await fireEvent.press(await screen.findByRole("button", { name: "Remover" }));

    expect(people.archive).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole("button", { name: "Confirmar remoção" }));

    await waitFor(() => expect(people.archive).toHaveBeenCalledWith("p1"));
    expect(await screen.findByText("Contato removido")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Editar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cobrar" })).toBeNull();
  });
});
