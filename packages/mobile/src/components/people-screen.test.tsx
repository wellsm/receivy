import type { Person } from "@receivy/common";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { PeopleScreen } from "./people-screen";

// The list reloads on focus, so the screen only ever sees expo-router's hook.
jest.mock("expo-router", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot close over module imports
  const react = require("react");

  return {
    useFocusEffect: (callback: () => void | (() => void)) => {
      react.useEffect(() => callback(), [callback]);
    },
  };
});

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

function peopleApi(...pages: { people: Person[]; nextCursor: string | null }[]) {
  const list = jest.fn();

  for (const page of pages) {
    list.mockResolvedValueOnce(page);
  }

  list.mockResolvedValue(pages.at(-1) ?? { people: [], nextCursor: null });

  return { list };
}

describe("PeopleScreen", () => {
  it("shows the display name, the initials, the pending badge and the phone subtitle", async () => {
    const ana = person({ nickname: "Aninha", displayName: "Aninha", phone: "+5511987654321", activeCharges: 2 });
    const client = peopleApi({ people: [ana], nextCursor: null });

    await render(<PeopleScreen client={client} />);

    expect(await screen.findByText("Aninha")).toBeOnTheScreen();
    expect(screen.getByText("AP")).toBeOnTheScreen();
    expect(screen.getByText("2 ativas")).toBeOnTheScreen();
    expect(screen.getByText("(11) 98765-4321")).toBeOnTheScreen();
    expect(screen.getByLabelText("Contato Aninha")).toBeOnTheScreen();
    expect(screen.getByText("1 contato")).toBeOnTheScreen();
  });

  it("falls back to the e-mail and the calm badge when there is no phone or pending charge", async () => {
    const client = peopleApi({ people: [person({ email: "ana@example.com" })], nextCursor: null });

    await render(<PeopleScreen client={client} />);

    expect(await screen.findByText("ana@example.com")).toBeOnTheScreen();
    expect(screen.getByText("Sem pendências")).toBeOnTheScreen();
  });

  it("searches the server agenda after the debounce", async () => {
    const client = peopleApi({ people: [], nextCursor: null }, { people: [person({ displayName: "Ana Paula Souza" })], nextCursor: null });

    await render(<PeopleScreen client={client} />);

    await screen.findByText("Nenhum contato ainda");
    await fireEvent.changeText(screen.getByLabelText("Buscar contatos"), "Ana");

    await waitFor(() => expect(client.list).toHaveBeenLastCalledWith(false, undefined, "Ana"));
    expect(await screen.findByText("Ana Paula Souza")).toBeOnTheScreen();
  });

  it("opens the ledger from the card", async () => {
    const onOpenLedger = jest.fn();
    const client = peopleApi({ people: [person()], nextCursor: null });

    await render(<PeopleScreen client={client} onOpenLedger={onOpenLedger} />);

    await fireEvent.press(await screen.findByLabelText("Contato Ana Paula Souza"));

    expect(onOpenLedger).toHaveBeenCalledWith("p1");
  });

  it("sends the form screen to the dedicated route", async () => {
    const onNewContact = jest.fn();
    const client = peopleApi({ people: [person()], nextCursor: null });

    await render(<PeopleScreen client={client} onNewContact={onNewContact} />);

    await fireEvent.press(await screen.findByLabelText("Novo contato"));

    expect(onNewContact).toHaveBeenCalled();
  });

  it("appends the next page instead of replacing it", async () => {
    const client = peopleApi(
      { people: [person()], nextCursor: "cursor-2" },
      { people: [person({ id: "p2", name: "Bruno Lima", displayName: "Bruno Lima" })], nextCursor: null },
    );

    await render(<PeopleScreen client={client} />);

    await fireEvent.press(await screen.findByLabelText("Carregar mais"));

    expect(await screen.findByText("Bruno Lima")).toBeOnTheScreen();
    expect(screen.getByText("Ana Paula Souza")).toBeOnTheScreen();
    expect(client.list).toHaveBeenLastCalledWith(false, "cursor-2", undefined);
  });

  it("no longer offers an inline form or the archived toggle", async () => {
    const client = peopleApi({ people: [person()], nextCursor: null });

    await render(<PeopleScreen client={client} />);

    await screen.findByText("Ana Paula Souza");

    expect(screen.queryByLabelText("Salvar contato")).toBeNull();
    expect(screen.queryByLabelText("Ver arquivados")).toBeNull();
  });

  it("reports a list failure and retries", async () => {
    const list = jest.fn().mockRejectedValueOnce(new Error("Sem conexão.")).mockResolvedValue({ people: [person()], nextCursor: null });

    await render(<PeopleScreen client={{ list }} />);

    expect(await screen.findByText("Sem conexão.")).toBeOnTheScreen();

    await fireEvent.press(screen.getByLabelText("Tentar novamente"));

    expect(await screen.findByText("Ana Paula Souza")).toBeOnTheScreen();
  });
});
