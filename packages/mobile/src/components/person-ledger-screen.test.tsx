import type { Person, PersonLedger } from "@receivy/common";
import { act, render, screen } from "@testing-library/react-native";
import { PersonLedgerScreen } from "./person-ledger-screen";

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

function ledger(overrides: Partial<Person> = {}): PersonLedger {
  return {
    personId: "p1",
    person: person(overrides),
    balance: { amountCents: 0, currency: "BRL" },
    receivable: { amountCents: 0, currency: "BRL" },
    payable: { amountCents: 0, currency: "BRL" },
    charges: [],
    nextCursor: null,
  };
}

describe("PersonLedgerScreen", () => {
  it("shows the display name, the full name and the formatted phone", async () => {
    const client = { ledger: jest.fn().mockResolvedValue(ledger({ nickname: "Aninha", displayName: "Aninha", phone: "+5511987654321" })) };

    await render(<PersonLedgerScreen id="p1" client={client} />);

    expect(await screen.findByText("Aninha")).toBeOnTheScreen();
    expect(screen.getByText("Ana Paula Souza")).toBeOnTheScreen();
    expect(screen.getByText("(11) 98765-4321")).toBeOnTheScreen();
  });

  it("reloads on focus so the edit form's save is visible when it pops back", async () => {
    const client = { ledger: jest.fn() };

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
    const client = { ledger: jest.fn().mockRejectedValue(new Error("Sem conexão.")) };

    await render(<PersonLedgerScreen id="p1" client={client} />);

    expect(await screen.findByText("Sem conexão.")).toBeOnTheScreen();
  });
});
