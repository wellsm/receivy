import { addCalendarDays, BillingCategory, BillingFrequency, BillingKind, BillingState, BillingRecurrence, calendarDate, ChargeState, Direction, EMPTY_BILLING_DRAFT, endOfMonthOptions, PixKeyType, SharingState, SplitMode, SplitPartKind, UserStatus, type BillingDetail, type ChargeDetail, type Contact } from "@receivy/common";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { FinancialRequestError } from "@/financial/client";
import { clearDraft, patchDraft, saveDraft, takeDraft } from "@/financial/draft-store";
import { BillingFormScreen } from "@/components/forms/billing-form-screen";

let mockKeys = 0;
let mockFocus: { callback: () => void | (() => void); cleanup: void | (() => void) }[] = [];
let mockRemoveListeners: (() => void)[] = [];

jest.mock("expo-crypto", () => ({ randomUUID: () => `key-${++mockKeys}` }));

// The native calendar is replaced by a button that answers with a fixed day.
jest.mock("@react-native-community/datetimepicker", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot close over module imports
  const react = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot close over module imports
  const { Pressable, Text } = require("react-native");

  return {
    __esModule: true,
    default: ({ onValueChange }: { onValueChange: (event: unknown, date: Date) => void }) =>
      react.createElement(
        Pressable,
        { accessibilityRole: "button", accessibilityLabel: "Escolher 25/12/2026", onPress: () => onValueChange({}, new Date(2026, 11, 25)) },
        react.createElement(Text, null, "Calendário"),
      ),
  };
});

// The route stays mounted across the side trip, so the focus callbacks are kept
// here and replayed by the test instead of remounting the screen — the screen
// registers one per thing it reloads on focus. `beforeRemove` listeners are
// collected the same way, to stand in for the native pop.
jest.mock("expo-router", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot close over module imports
  const react = require("react");

  return {
    useFocusEffect: (callback: () => void | (() => void)) => {
      react.useEffect(() => {
        const entry = { callback, cleanup: callback() };

        mockFocus.push(entry);

        return () => {
          mockFocus = mockFocus.filter((known) => known !== entry);
          entry.cleanup?.();
        };
      }, [callback]);
    },
    useNavigation: () => ({
      addListener: (event: string, listener: () => void) => {
        if (event === "beforeRemove") {
          mockRemoveListeners.push(listener);
        }

        return () => {
          mockRemoveListeners = mockRemoveListeners.filter((known) => known !== listener);
        };
      },
    }),
  };
});

/**
 * Replays the screen's focus effects, the way expo-router does on `router.back()`:
 * the blur that started the side trip cleans each one up before the focus runs it
 * again, so a request left behind can no longer land on the screen.
 */
async function refocus() {
  await act(async () => {
    for (const entry of [...mockFocus]) {
      entry.cleanup?.();
      entry.cleanup = entry.callback();
    }
  });
}

/** Fires the navigator's `beforeRemove`, the way the native header does on a pop. */
async function popScreen() {
  await act(async () => {
    for (const listener of mockRemoveListeners) {
      listener();
    }
  });
}

/** The agenda entry and the account behind it carry different ids on purpose: the draft must seat the latter. */
function contact(id: string, userId: string, name: string, lastBilledAt: string | null = null): Contact {
  return {
    id,
    userId,
    name,
    nickname: null,
    displayName: name,
    email: `${name.toLowerCase()}@example.com`,
    phone: null,
    status: UserStatus.Active,
    archivedAt: null,
    createdAt: "2026-09-01T00:00:00Z",
    lastBilledAt,
    activeCharges: 0,
  };
}

// The hint the carousel renders is relative to the wall clock, so the fixture has to be too.
const TIMEZONE = "America/Sao_Paulo";
const yesterday = () => addCalendarDays(calendarDate(new Date(), TIMEZONE), -1);

const ana = contact("p1", "u1", "Ana", `${yesterday()}T12:00:00.000Z`);
const bruno = contact("p2", "u2", "Bruno");
/** No e-mail and no phone: a placeholder contact nobody can notify. */
const carla: Contact = { ...contact("p3", "u3", "Carla"), email: "" };

function contactsApi(pages: { contacts: Contact[]; nextCursor: string | null }[] = [{ contacts: [ana, bruno], nextCursor: null }]) {
  const list = jest.fn();

  for (const page of pages) {
    list.mockResolvedValueOnce(page);
  }

  list.mockResolvedValue(pages.at(-1) ?? { contacts: [], nextCursor: null });

  return { list };
}

const nubank = { id: "pix-1", label: "Nubank", pixKey: "ana@example.com", pixKeyType: "email", isDefault: true, contactId: null, archivedAt: null };

/** Block 9.1: the keys the owner filed under each contact; a conta a pagar only picks among the seated contact's. */
const anaKey = { id: "pix-ana", label: "Nubank da Ana", pixKey: "ana@example.com", pixKeyType: "email", isDefault: true, contactId: "p1", archivedAt: null };
const anaSecondKey = { ...anaKey, id: "pix-ana-2", label: "Itaú da Ana", pixKey: "52998224725", pixKeyType: "cpf", isDefault: false };
const brunoKey = { ...anaKey, id: "pix-bruno", label: "Bruno", pixKey: "bruno@example.com", contactId: "p2" };
const CONTACT_KEYS: Record<string, unknown[]> = { p1: [anaKey, anaSecondKey], p2: [brunoKey] };

/** Wallets without a key gate the form, so the shared fixture carries one. */
function emptyWallet() {
  return financialApi({ paymentMethods: jest.fn().mockResolvedValue({ paymentMethods: [] }) });
}

/** The contact whose keys nobody registered yet: every lookup answers an empty list. */
function keylessContacts() {
  return financialApi({ paymentMethods: jest.fn((contactId?: string) => Promise.resolve({ paymentMethods: contactId ? [] : [nubank] })) });
}

function financialApi(overrides: Record<string, unknown> = {}) {
  return {
    paymentMethods: jest.fn((contactId?: string) => Promise.resolve({ paymentMethods: contactId ? (CONTACT_KEYS[contactId] ?? []) : [nubank] })),
    profile: jest.fn().mockResolvedValue({ user: { timezone: TIMEZONE } }),
    createBilling: jest.fn().mockResolvedValue({ id: "b1", charges: [{ id: "c1" }] }),
    patchBilling: jest.fn(),
    ...overrides,
  };
}

async function quickForm(client = financialApi(), contacts = contactsApi(), props: Record<string, unknown> = {}) {
  const onSaved = jest.fn();

  await render(<BillingFormScreen client={client as never} contacts={contacts} onSaved={onSaved} {...props} />);
  await screen.findByRole("button", { name: "Adicionar" });

  return { client, contacts, onSaved };
}

/** Contacts only enter through the agenda sheet: open it, tick Ana, close it. */
async function pickAna() {
  await fireEvent.press(screen.getByRole("button", { name: "Adicionar" }));
  await fireEvent.press(await screen.findByRole("checkbox", { name: "Ana" }));
  await fireEvent.press(screen.getByRole("button", { name: "Concluir" }));
  await waitFor(() => expect(screen.queryByLabelText("Buscar contatos")).toBeNull());
}

/** The counterpart seat has its own sheet, and picking closes it. */
async function seatAna() {
  await fireEvent.press(screen.getByRole("button", { name: "Escolher contato" }));
  await fireEvent.press(await screen.findByRole("checkbox", { name: "Ana" }));
  await waitFor(() => expect(screen.queryByLabelText("Buscar contatos")).toBeNull());
}

/** The contact form lives inside the agenda sheet, so the side trip starts there. */
async function pressNewContact() {
  await fireEvent.press(screen.getByRole("button", { name: "Adicionar" }));
  await fireEvent.press(await screen.findByRole("button", { name: "Novo contato" }));
}

async function fillQuickBilling() {
  await pickAna();
  await fireEvent.changeText(screen.getByLabelText("Valor"), "10000");
  await fireEvent.changeText(screen.getByLabelText("Título"), "Mercado QA");
}

const onceBilling: BillingDetail = {
  id: "b1",
  recurrence: BillingRecurrence.Once,
  type: Direction.Receivable,
  contact: null,
  counterpart: null,
  pix: null,
  description: "Jantar",
  total: { amountCents: 9_000, currency: "BRL" },
  startDate: "2026-10-31",
  state: BillingState.Active,
  nextDueDate: "2026-10-31",
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
  timezone: "America/Sao_Paulo",
  paymentMethodId: "pix-1",
  reminders: [{ offsetDays: 0, enabled: true }],
  split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: "u1" }] },
  allocations: [],
  charges: [],
  previews: [],
  nextMaterialization: null,
  category: BillingCategory.Food,
  invite: null,
  guests: [],
  linkableContacts: [],
};

const untilBilling: BillingDetail = { ...onceBilling, id: "b5", recurrence: BillingRecurrence.Until, endDate: "2026-12-31", installmentCount: 3, total: { amountCents: 3_334, currency: "BRL" } };

const payableBilling: BillingDetail = {
  ...onceBilling,
  type: Direction.Payable,
  contact: { id: "p1", userId: "u1", name: "Ana", avatar: null },
  pix: { keyType: PixKeyType.Cpf, key: "52998224725", label: "Itaú da Ana" },
  paymentMethodId: "pix-ana-2",
  split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.Owner }] },
};

/** Flips the form to a conta a pagar; the participants and the split leave the screen. */
async function chooseToPay() {
  await fireEvent.press(screen.getByRole("button", { name: "Vou pagar" }));
  await waitFor(() => expect(screen.queryByText("Participantes")).toBeNull());
}

describe("BillingFormScreen", () => {
  afterEach(() => clearDraft());

  it("asks the agenda for the most recent contacts and starts with only me on the split", async () => {
    const { contacts } = await quickForm();

    expect(contacts.list).toHaveBeenCalledWith(false, undefined, undefined, "recent");
    expect(screen.queryByRole("button", { name: "Ana" })).toBeNull();
    expect(screen.getByText("1 pessoa")).toBeOnTheScreen();

    await pickAna();

    expect(screen.getByRole("button", { name: "Ana" })).toBeSelected();
    expect(screen.getByText("2 pessoas")).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("button", { name: "Ana" }));

    expect(screen.queryByRole("button", { name: "Ana" })).toBeNull();
  });

  it("creates a billing straight from the quick form, with category and no review step", async () => {
    const { client, onSaved } = await quickForm();

    await fillQuickBilling();
    await fireEvent.press(screen.getByRole("button", { name: "Categoria" }));
    await fireEvent.press(screen.getByRole("button", { name: "Mercado" }));
    expect(screen.queryByRole("button", { name: "Revisar cobrança" })).toBeNull();

    const create = screen.getByRole("button", { name: "Criar conta" });

    await fireEvent.press(create);
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ id: "b1", charges: [{ id: "c1" }] }));

    // Clearing it here would flash the button back to idle while this screen is still on top.
    expect(create).toBeDisabled();

    expect(client.createBilling.mock.calls[0][0]).toMatchObject({
      recurrence: "once",
      totalCents: 10_000,
      description: "Mercado QA",
      category: "groceries",
      timezone: "America/Sao_Paulo",
      split: { mode: "equal", parts: [{ kind: "user", userId: "u1" }, { kind: "owner" }] },
    });
    expect(client.createBilling.mock.calls[0][1]).toEqual(expect.any(String));
  });

  it("sends whole shares when the split is by cotas", async () => {
    const { client } = await quickForm();

    await fillQuickBilling();
    await fireEvent.press(screen.getByRole("button", { name: "Cotas" }));
    await fireEvent.changeText(screen.getByLabelText("Cotas de Ana"), "3");
    // The single-occurrence footer summary shares the same total as Ana's row on this draft:
    // exactly the split row's amount and the footer total, no more, no less.
    expect(screen.getAllByText("R$ 75,00")).toHaveLength(2);
    expect(screen.getByText("4 cotas no total")).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("button", { name: "Criar conta" }));
    await waitFor(() => expect(client.createBilling).toHaveBeenCalled());

    expect(client.createBilling.mock.calls[0][0].split).toEqual({
      mode: "shares",
      parts: [{ kind: "user", userId: "u1", shares: 3 }, { kind: "owner", shares: 1 }],
    });
  });

  it("shows the per-person amount on the split tag", async () => {
    await quickForm();
    await fillQuickBilling();

    expect(screen.getByText("Automático (R$ 50,00 cada)")).toBeOnTheScreen();
  });

  it("warns about the missing remainder of a fixed split only when I do not take part", async () => {
    await quickForm();
    await fillQuickBilling();
    await fireEvent.press(screen.getByRole("button", { name: "Valor fixo" }));
    await fireEvent.changeText(screen.getByLabelText("Valor de Ana"), "40,00");

    expect(screen.queryByText("Faltam R$ 60,00")).toBeNull();

    await fireEvent(screen.getByLabelText("Eu também participo"), "valueChange", false);

    expect(screen.getByText("Faltam R$ 60,00")).toBeOnTheScreen();
  });

  it("drops the owner from the split when I do not take part", async () => {
    const { client } = await quickForm();

    await fillQuickBilling();
    await fireEvent(screen.getByLabelText("Eu também participo"), "valueChange", false);
    await fireEvent.press(screen.getByRole("button", { name: "Criar conta" }));
    await waitFor(() => expect(client.createBilling).toHaveBeenCalled());

    expect(client.createBilling.mock.calls[0][0].split.parts).toEqual([{ kind: "user", userId: "u1" }]);
  });

  it("sends Não notificar on the participant it was switched for", async () => {
    const { client } = await quickForm();

    await fillQuickBilling();

    expect(screen.getByText("Sem avisos automáticos para esta pessoa. Você ainda pode lembrar manualmente.")).toBeOnTheScreen();
    expect(screen.getByLabelText("Não notificar Ana")).toHaveProp("value", false);

    await fireEvent(screen.getByLabelText("Não notificar Ana"), "valueChange", true);
    await fireEvent.press(screen.getByRole("button", { name: "Criar conta" }));
    await waitFor(() => expect(client.createBilling).toHaveBeenCalled());

    expect(client.createBilling.mock.calls[0][0].split).toEqual({ mode: "equal", parts: [{ kind: "user", userId: "u1", notify: false }, { kind: "owner" }] });
  });

  it("renders Não notificar only for a participant who can actually be reached", async () => {
    await quickForm(financialApi(), contactsApi([{ contacts: [ana, carla], nextCursor: null }]));

    await fireEvent.press(screen.getByRole("button", { name: "Adicionar" }));
    await fireEvent.press(await screen.findByRole("checkbox", { name: "Ana" }));
    await fireEvent.press(screen.getByRole("checkbox", { name: "Carla" }));
    await fireEvent.press(screen.getByRole("button", { name: "Concluir" }));

    expect(screen.getByLabelText("Não notificar Ana")).toBeOnTheScreen();
    expect(screen.queryByLabelText("Não notificar Carla")).toBeNull();
    expect(screen.getByText("Sem avisos automáticos para esta pessoa. Você ainda pode lembrar manualmente.")).toBeOnTheScreen();
  });

  it("hides the Não notificar helper entirely when no selected participant can be reached", async () => {
    await quickForm(financialApi(), contactsApi([{ contacts: [carla], nextCursor: null }]));

    await fireEvent.press(screen.getByRole("button", { name: "Adicionar" }));
    await fireEvent.press(await screen.findByRole("checkbox", { name: "Carla" }));
    await fireEvent.press(screen.getByRole("button", { name: "Concluir" }));

    expect(screen.queryByLabelText("Não notificar Carla")).toBeNull();
    expect(screen.queryByText("Sem avisos automáticos para esta pessoa. Você ainda pode lembrar manualmente.")).toBeNull();
  });

  it("never sends a stale Não notificar for a participant the agenda no longer shows as reachable", async () => {
    const silencedBilling: BillingDetail = {
      ...onceBilling,
      id: "b7",
      recurrence: BillingRecurrence.Indefinite,
      frequency: BillingFrequency.Monthly,
      allocations: [{ kind: SplitPartKind.User, userId: "u3", splitMode: SplitMode.Equal, amount: { amountCents: 9_000, currency: "BRL" }, order: 0, notify: false }],
      split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: "u3" }] },
    };
    const patchBilling = jest.fn().mockResolvedValue(silencedBilling);

    await render(
      <BillingFormScreen
        client={financialApi({ patchBilling }) as never}
        contacts={contactsApi([{ contacts: [carla], nextCursor: null }])}
        billing={silencedBilling}
        onSaved={jest.fn()}
        onBack={jest.fn()}
      />,
    );
    await screen.findByText("Editar conta");

    expect(screen.queryByLabelText(/Não notificar/)).toBeNull();

    await fireEvent.press(screen.getByRole("button", { name: "Salvar conta" }));
    await waitFor(() => expect(patchBilling).toHaveBeenCalled());

    expect(patchBilling.mock.calls[0][1].split).toEqual({ mode: "equal", parts: [{ kind: "user", userId: "u3" }] });
  });

  it("seeds Não notificar from the allocations and sends the new value on edit", async () => {
    const silencedBilling: BillingDetail = {
      ...onceBilling,
      id: "b3",
      recurrence: BillingRecurrence.Indefinite,
      frequency: BillingFrequency.Monthly,
      allocations: [{ kind: SplitPartKind.User, userId: "u1", splitMode: SplitMode.Equal, amount: { amountCents: 9_000, currency: "BRL" }, order: 0, notify: false }],
    };
    const patchBilling = jest.fn().mockResolvedValue(silencedBilling);

    await render(<BillingFormScreen client={financialApi({ patchBilling }) as never} contacts={contactsApi()} billing={silencedBilling} onSaved={jest.fn()} onBack={jest.fn()} />);

    const quiet = await screen.findByLabelText("Não notificar Ana");

    expect(quiet).toHaveProp("value", true);

    await fireEvent(quiet, "valueChange", false);
    await fireEvent.press(screen.getByRole("button", { name: "Salvar conta" }));
    await waitFor(() => expect(patchBilling).toHaveBeenCalled());

    expect(patchBilling.mock.calls[0][1].split).toEqual({ mode: "equal", parts: [{ kind: "user", userId: "u1", notify: true }] });
  });

  it("records a registro naming the single contact who paid it, with nobody to split with or pay through", async () => {
    const { client } = await quickForm();

    await fireEvent(screen.getByLabelText("Já recebi"), "valueChange", true);

    expect(screen.getByText("Registro já quitado: ninguém recebe aviso. Cada ocorrência fica paga no vencimento.")).toBeOnTheScreen();
    expect(screen.queryByText("Participantes")).toBeNull();
    expect(screen.queryByText("Divisão da Conta")).toBeNull();
    expect(screen.queryByText("Receber via Pix")).toBeNull();
    expect(screen.getByText("De quem")).toBeOnTheScreen();
    expect(screen.getByText("Escolha quem pagou.")).toBeOnTheScreen();

    await seatAna();
    await fireEvent.changeText(screen.getByLabelText("Valor"), "500000");
    await fireEvent.changeText(screen.getByLabelText("Título"), "Salário");
    await fireEvent.press(screen.getByRole("button", { name: "Criar conta" }));
    await waitFor(() => expect(client.createBilling).toHaveBeenCalled());

    const input = client.createBilling.mock.calls[0][0];

    expect(input).toMatchObject({
      type: "receivable",
      kind: "record",
      totalCents: 500_000,
      split: { mode: "equal", parts: [{ kind: "user", userId: "u1" }] },
    });
    expect(input.counterpartLabel).toBeUndefined();
    expect(input.reminders).toBeUndefined();
    expect(input.paymentMethodId).toBeUndefined();
  });

  it("refuses a registro a receber that names nobody who paid it", async () => {
    const { client } = await quickForm();

    await fireEvent(screen.getByLabelText("Já recebi"), "valueChange", true);
    await fireEvent.changeText(screen.getByLabelText("Valor"), "500000");
    await fireEvent.changeText(screen.getByLabelText("Título"), "Salário");
    await fireEvent.press(screen.getByRole("button", { name: "Criar conta" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Escolha quem pagou.");
    expect(client.createBilling).not.toHaveBeenCalled();
  });

  it("seats a registro a pagar under Para quem", async () => {
    const { client } = await quickForm();

    await fireEvent(screen.getByLabelText("Já recebi"), "valueChange", true);
    await fireEvent.press(screen.getByRole("button", { name: "Vou pagar" }));

    expect(screen.getByText("Para quem")).toBeOnTheScreen();
    expect(screen.queryByText("Chave Pix (opcional)")).toBeNull();

    await seatAna();
    await fireEvent.changeText(screen.getByLabelText("Valor"), "500000");
    await fireEvent.changeText(screen.getByLabelText("Título"), "Aluguel");
    await fireEvent.press(screen.getByRole("button", { name: "Criar conta" }));
    await waitFor(() => expect(client.createBilling).toHaveBeenCalled());

    expect(client.createBilling.mock.calls[0][0]).toMatchObject({ type: "payable", kind: "record", contactId: "p1" });
  });

  it("keeps a recorrente registro from starting before today", async () => {
    const { client } = await quickForm();

    await fireEvent(screen.getByLabelText("Já recebi"), "valueChange", true);
    await seatAna();
    await fireEvent.press(screen.getByRole("button", { name: "Recorrente" }));
    await fireEvent.changeText(screen.getByLabelText("Vencimento"), yesterday());
    await fireEvent.changeText(screen.getByLabelText("Valor"), "500000");
    await fireEvent.press(screen.getByRole("button", { name: "Criar conta" }));

    expect(await screen.findByText("Registro recorrente começa hoje ou depois.")).toBeOnTheScreen();
    expect(client.createBilling).not.toHaveBeenCalled();
  });

  it("keeps the registro switch locked on edit and never moves its counterpart", async () => {
    const registroBilling: BillingDetail = {
      ...onceBilling,
      id: "b4",
      kind: BillingKind.Record,
      paymentMethodId: undefined,
      reminders: [],
      split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: "u1" }] },
    };
    const patchBilling = jest.fn().mockResolvedValue(registroBilling);

    await render(<BillingFormScreen client={financialApi({ patchBilling }) as never} contacts={contactsApi()} billing={registroBilling} onSaved={jest.fn()} onBack={jest.fn()} />);

    const toggle = await screen.findByLabelText("Já recebi");

    expect(toggle).toHaveProp("value", true);
    expect(toggle).toBeDisabled();
    expect(screen.getByText("Não dá para mudar depois de criada.")).toBeOnTheScreen();
    expect(screen.getByText("De quem")).toBeOnTheScreen();
    expect(await screen.findByRole("button", { name: "Ana" })).toBeOnTheScreen();
    // The API answers 409 for a counterpart change on a registro, so the form never offers it.
    expect(screen.queryByRole("button", { name: "Escolher contato" })).toBeNull();

    await fireEvent.press(screen.getByRole("button", { name: "Salvar conta" }));
    await waitFor(() => expect(patchBilling).toHaveBeenCalled());

    expect(patchBilling.mock.calls[0][1]).toEqual({ category: "food" });
  });

  it("turns the parcel count into an end date", async () => {
    const { client } = await quickForm();

    await fillQuickBilling();
    await fireEvent.press(screen.getByRole("button", { name: "Parcelado" }));
    await fireEvent.changeText(screen.getByLabelText("Vencimento"), "2026-01-31");
    await fireEvent.changeText(screen.getByLabelText("Parcelas"), "3");
    await fireEvent.press(screen.getByRole("button", { name: "Criar conta" }));
    await waitFor(() => expect(client.createBilling).toHaveBeenCalled());

    expect(client.createBilling.mock.calls[0][0]).toMatchObject({ recurrence: "until", endDate: "2026-03-31" });
  });

  it("shows the per-installment helper below the typed total and posts the rounded-up per-installment amount", async () => {
    const { client } = await quickForm();

    await pickAna();
    await fireEvent(screen.getByLabelText("Eu também participo"), "valueChange", false);
    await fireEvent.press(screen.getByRole("button", { name: "Parcelado" }));
    await fireEvent.changeText(screen.getByLabelText("Vencimento"), "2026-01-31");
    await fireEvent.changeText(screen.getByLabelText("Parcelas"), "3");
    await fireEvent.changeText(screen.getByLabelText("Valor"), "10000");
    await fireEvent.changeText(screen.getByLabelText("Título"), "Mercado QA");

    expect(screen.getByText("3x de R$ 33,34 · total R$ 100,02")).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("button", { name: "Criar conta" }));
    await waitFor(() => expect(client.createBilling).toHaveBeenCalled());

    expect(client.createBilling.mock.calls[0][0]).toMatchObject({ totalCents: 3334 });
  });

  it("picks the month of a due date on the last day with Final do mês", async () => {
    const { client } = await quickForm();

    await fillQuickBilling();
    await fireEvent.press(screen.getByRole("button", { name: "Final do mês" }));

    expect(screen.queryByLabelText("Vencimento")).toBeNull();
    expect(screen.queryByRole("button", { name: "Abrir calendário" })).toBeNull();

    const next = endOfMonthOptions(calendarDate(new Date(), TIMEZONE), 2)[1]!;

    await fireEvent.press(screen.getByRole("button", { name: "Mês do vencimento" }));
    await fireEvent.press(await screen.findByRole("button", { name: next.label }));
    await fireEvent.press(screen.getByRole("button", { name: "Criar conta" }));
    await waitFor(() => expect(client.createBilling).toHaveBeenCalled());

    expect(client.createBilling.mock.calls[0][0]).toMatchObject({ startDate: next.value, dueRule: "end_of_month" });
  });

  it("hides Final do mês on a yearly billing", async () => {
    await quickForm();

    expect(screen.getByRole("button", { name: "Final do mês" })).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("button", { name: "Recorrente" }));
    await fireEvent.press(screen.getByRole("button", { name: "Anual" }));

    expect(screen.queryByRole("button", { name: "Final do mês" })).toBeNull();
  });

  it("moves the due date with the quick button and the calendar", async () => {
    const { client } = await quickForm();

    await fillQuickBilling();
    await fireEvent.changeText(screen.getByLabelText("Vencimento"), "2026-01-31");
    await fireEvent.press(screen.getByRole("button", { name: "Hoje" }));

    const today = calendarDate(new Date(), TIMEZONE);

    expect(screen.getByLabelText("Vencimento")).toHaveDisplayValue(today);

    await fireEvent.press(screen.getByRole("button", { name: "Abrir calendário" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Escolher 25/12/2026" }));

    expect(screen.getByLabelText("Vencimento")).toHaveDisplayValue("2026-12-25");
    expect(screen.getByRole("button", { name: "Escolher 25/12/2026" })).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("button", { name: "Concluir" }));

    expect(screen.queryByRole("button", { name: "Escolher 25/12/2026" })).toBeNull();

    await fireEvent.press(screen.getByRole("button", { name: "Criar conta" }));
    await waitFor(() => expect(client.createBilling).toHaveBeenCalled());

    expect(client.createBilling.mock.calls[0][0]).toMatchObject({ startDate: "2026-12-25" });
  });

  it("types the amount like a bank keypad and posts the cents", async () => {
    const { client } = await quickForm();
    const amount = screen.getByLabelText("Valor");

    expect(amount).toHaveDisplayValue("0,00");

    await fireEvent.changeText(amount, "1");
    expect(amount).toHaveDisplayValue("0,01");

    await fireEvent.changeText(amount, "0,010");
    expect(amount).toHaveDisplayValue("0,10");

    await fireEvent.changeText(amount, "0,1");
    expect(amount).toHaveDisplayValue("0,01");

    await fireEvent.changeText(amount, "123456");
    expect(amount).toHaveDisplayValue("1.234,56");

    await pickAna();
    await fireEvent.changeText(screen.getByLabelText("Título"), "Mercado QA");
    await fireEvent.press(screen.getByRole("button", { name: "Criar conta" }));
    await waitFor(() => expect(client.createBilling).toHaveBeenCalled());

    expect(client.createBilling.mock.calls[0][0]).toMatchObject({ totalCents: 123_456 });
  });

  it("names the third step Título and drops the old Descrição copy", async () => {
    await quickForm();

    expect(screen.getByLabelText("Título")).toHaveProp("placeholder", "Ex: Aluguel do sítio, Pizzaria...");
    expect(screen.getByText("Título da conta")).toBeOnTheScreen();
    expect(screen.queryByLabelText("Descrição")).toBeNull();
    expect(screen.queryByText("Descrição")).toBeNull();
  });

  it("fills an empty title with the category label", async () => {
    await quickForm();
    await fireEvent.press(screen.getByRole("button", { name: "Categoria" }));
    await fireEvent.press(screen.getByRole("button", { name: "Transporte" }));

    expect(screen.getByLabelText("Título")).toHaveDisplayValue("Transporte");
  });

  it("keeps each mode's split values while the user switches modes", async () => {
    const { client } = await quickForm();

    await fillQuickBilling();
    await fireEvent.press(screen.getByRole("button", { name: "Valor fixo" }));
    await fireEvent.changeText(screen.getByLabelText("Valor de Ana"), "60,00");

    await fireEvent.press(screen.getByRole("button", { name: "Porcentagem" }));
    expect(screen.getByLabelText("Porcentagem de Ana")).toHaveDisplayValue("");

    await fireEvent.press(screen.getByRole("button", { name: "Valor fixo" }));
    expect(screen.getByLabelText("Valor de Ana")).toHaveDisplayValue("60,00");

    await fireEvent.press(screen.getByRole("button", { name: "Cotas" }));
    await fireEvent.press(screen.getByRole("button", { name: "Criar conta" }));
    await waitFor(() => expect(client.createBilling).toHaveBeenCalled());

    expect(client.createBilling.mock.calls[0][0].split).toEqual({
      mode: "shares",
      parts: [{ kind: "user", userId: "u1", shares: 1 }, { kind: "owner", shares: 1 }],
    });
  });

  it("shows the owner remainder as read-only text on a fixed split", async () => {
    await quickForm();
    await fillQuickBilling();
    await fireEvent.press(screen.getByRole("button", { name: "Valor fixo" }));
    await fireEvent.changeText(screen.getByLabelText("Valor de Ana"), "60,00");

    expect(screen.getByText("Você fica com R$ 40,00")).toBeOnTheScreen();
    expect(screen.queryByLabelText("Valor de Eu")).toBeNull();
  });

  it("drops the owner remainder and warns when the fixed split exceeds the total", async () => {
    await quickForm();
    await fillQuickBilling();
    await fireEvent.press(screen.getByRole("button", { name: "Valor fixo" }));
    await fireEvent.changeText(screen.getByLabelText("Valor de Ana"), "160,00");

    expect(screen.getByText("O rateio ultrapassa o total.")).toBeOnTheScreen();
    expect(screen.queryByText(/Você fica com/)).toBeNull();
  });

  it("explains inline what is missing instead of sending a broken billing", async () => {
    const { client } = await quickForm();

    await fireEvent.changeText(screen.getByLabelText("Valor"), "10000");
    await fireEvent.press(screen.getByRole("button", { name: "Criar conta" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Selecione ao menos um contato.");
    expect(client.createBilling).not.toHaveBeenCalled();
  });

  it("picks extra contacts from the full agenda sheet", async () => {
    const list = jest.fn(async (_archived: boolean, cursor?: string, search?: string, sort?: "recent") => {
      if (sort === "recent") {
        return { contacts: [ana, bruno], nextCursor: null };
      }

      if (cursor) {
        return { contacts: [contact("p3", "u3", "Carla")], nextCursor: null };
      }

      return search === "Bru" ? { contacts: [bruno], nextCursor: "c1" } : { contacts: [ana, bruno], nextCursor: null };
    });
    const contacts = { list };
    const { client } = await quickForm(financialApi(), contacts);

    await fireEvent.press(screen.getByRole("button", { name: "Adicionar" }));
    await fireEvent.changeText(await screen.findByLabelText("Buscar contatos"), "Bru");
    await waitFor(() => expect(contacts.list).toHaveBeenCalledWith(false, undefined, "Bru"));

    await fireEvent.press(await screen.findByRole("checkbox", { name: "Bruno" }));
    expect(screen.getByRole("checkbox", { name: "Bruno" })).toBeChecked();

    await fireEvent.press(screen.getByRole("button", { name: "Carregar mais" }));
    expect(await screen.findByRole("checkbox", { name: "Carla" })).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("button", { name: "Concluir" }));
    await waitFor(() => expect(screen.queryByLabelText("Buscar contatos")).toBeNull());

    await fireEvent.changeText(screen.getByLabelText("Valor"), "100,00");
    await fireEvent.changeText(screen.getByLabelText("Título"), "Mercado QA");
    await fireEvent.press(screen.getByRole("button", { name: "Criar conta" }));
    await waitFor(() => expect(client.createBilling).toHaveBeenCalled());

    expect(client.createBilling.mock.calls[0][0].split.parts).toEqual([{ kind: "user", userId: "u2" }, { kind: "owner" }]);
  });

  it("parks the draft before leaving to register a contact", async () => {
    const onCreateContact = jest.fn();

    await quickForm(financialApi(), contactsApi(), { onCreateContact });
    await fireEvent.changeText(screen.getByLabelText("Valor"), "85,00");
    await pressNewContact();

    expect(onCreateContact).toHaveBeenCalled();
    expect(takeDraft()).toMatchObject({ amount: "85,00" });
  });

  it("parks the draft before leaving to register a Pix key", async () => {
    const onCreatePix = jest.fn();

    await quickForm(financialApi(), contactsApi(), { onCreatePix });
    await fireEvent.changeText(screen.getByLabelText("Valor"), "85,00");
    await fireEvent.press(screen.getByRole("button", { name: "Cadastrar chave" }));

    expect(onCreatePix).toHaveBeenCalled();
    expect(takeDraft()).toMatchObject({ amount: "85,00" });
  });

  it("selects the contact a side trip created without remounting the screen", async () => {
    const carla = contact("p-new", "u-new", "Carla");
    let fetches = 0;
    const list = jest.fn(async () => ({ contacts: ++fetches > 1 ? [ana, bruno, carla] : [ana, bruno], nextCursor: null }));
    const onCreateContact = jest.fn();

    await quickForm(financialApi(), { list }, { onCreateContact });
    await fireEvent.changeText(screen.getByLabelText("Valor"), "85,00");
    await pressNewContact();

    // The contact screen saved the new contact and popped back to the still-mounted form.
    patchDraft({ contact: { id: "p-new", userId: "u-new" } });
    await refocus();

    expect(await screen.findByRole("button", { name: "Carla" })).toBeSelected();
    // The recent agenda on load, the sheet's own page, and the refetch on focus.
    expect(list).toHaveBeenCalledTimes(3);
    expect(screen.getByLabelText("Valor")).toHaveDisplayValue("85,00");
    expect(takeDraft()).toBeNull();
  });

  it("keeps the screen as it is when a focus brings no draft back", async () => {
    const { contacts } = await quickForm();

    await fireEvent.changeText(screen.getByLabelText("Valor"), "85,00");
    await refocus();

    expect(contacts.list).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Valor")).toHaveDisplayValue("85,00");
  });

  it("keeps the parked draft while a side trip is on top of the form", async () => {
    const onCreateContact = jest.fn();

    await quickForm(financialApi(), contactsApi(), { onCreateContact });
    await fireEvent.changeText(screen.getByLabelText("Valor"), "8500");
    await pressNewContact();

    expect(takeDraft()).toMatchObject({ amount: "85,00" });
  });

  it("drops the parked draft when the form itself is popped", async () => {
    const onCreateContact = jest.fn();

    await quickForm(financialApi(), contactsApi(), { onCreateContact });
    await fireEvent.changeText(screen.getByLabelText("Valor"), "8500");
    await pressNewContact();
    await popScreen();

    expect(takeDraft()).toBeNull();
  });

  it("shows no manual back link when the native header owns the route", async () => {
    await quickForm();

    expect(screen.queryByRole("button", { name: "Voltar" })).toBeNull();
    expect(screen.queryByText("← Voltar")).toBeNull();
  });

  it("keeps its own way out when the billings screen embeds the form", async () => {
    const onBack = jest.fn();

    await quickForm(financialApi(), contactsApi(), { onBack });
    await fireEvent.press(screen.getByRole("button", { name: "Voltar" }));

    expect(onBack).toHaveBeenCalled();
    expect(takeDraft()).toBeNull();
  });

  it("drops the parked draft after creating the billing", async () => {
    const onCreateContact = jest.fn();
    const { client } = await quickForm(financialApi(), contactsApi(), { onCreateContact });

    await fillQuickBilling();
    await pressNewContact();
    await fireEvent.press(screen.getByRole("button", { name: "Criar conta" }));
    await waitFor(() => expect(client.createBilling).toHaveBeenCalled());

    expect(takeDraft()).toBeNull();
  });

  it("refuses a due date that is not a calendar day", async () => {
    const { client } = await quickForm();

    await fillQuickBilling();
    await fireEvent.changeText(screen.getByLabelText("Vencimento"), "31/01/2026");
    await fireEvent.press(screen.getByRole("button", { name: "Criar conta" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Informe a data como AAAA-MM-DD.");

    await fireEvent.changeText(screen.getByLabelText("Vencimento"), "2026-02-31");
    await fireEvent.press(screen.getByRole("button", { name: "Criar conta" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Informe a data como AAAA-MM-DD.");
    expect(client.createBilling).not.toHaveBeenCalled();
  });

  it("hides the side trips when the screen cannot navigate", async () => {
    await quickForm();

    expect(screen.queryByRole("button", { name: "Novo contato" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cadastrar chave" })).toBeNull();
    expect(screen.queryByLabelText("Dias do lembrete 1")).toBeNull();
  });

  it("restores the draft a side trip came back with", async () => {
    saveDraft({ ...EMPTY_BILLING_DRAFT("America/Sao_Paulo", "2026-09-08"), selected: ["u1"], amount: "85,00", pix: "pix-1" });

    const client = financialApi({
      paymentMethods: jest.fn().mockResolvedValue({ paymentMethods: [{ id: "pix-2", label: "Nubank", pixKey: "a@b.com", isDefault: true, archivedAt: null }] }),
    });

    await quickForm(client, contactsApi(), { onCreateContact: jest.fn(), onCreatePix: jest.fn() });

    expect(screen.getByLabelText("Valor")).toHaveDisplayValue("85,00");
    expect(screen.getByRole("button", { name: "Ana" })).toBeSelected();
    expect(client.profile).not.toHaveBeenCalled();
    expect(takeDraft()).toBeNull();
  });

  it("hides the form behind a single call to action when the account has no key", async () => {
    const onCreatePix = jest.fn();

    await render(<BillingFormScreen client={emptyWallet() as never} contacts={contactsApi()} onSaved={jest.fn()} onCreatePix={onCreatePix} />);

    expect(await screen.findByText("Cadastre uma chave Pix")).toBeOnTheScreen();
    expect(onCreatePix).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Criar conta" })).toBeNull();
    expect(screen.queryByLabelText("Valor")).toBeNull();

    await fireEvent.press(screen.getByRole("button", { name: "Cadastrar chave Pix" }));

    expect(onCreatePix).toHaveBeenCalledWith(true);
    expect(takeDraft()).toMatchObject({ direction: "receivable" });
  });

  it("never gates the form once a key exists", async () => {
    const client = financialApi({
      paymentMethods: jest.fn().mockResolvedValue({ paymentMethods: [{ id: "pix-2", label: "Nubank", pixKey: "a@b.com", pixKeyType: "email", isDefault: true, archivedAt: null }] }),
    });
    const onCreatePix = jest.fn();

    await quickForm(client, contactsApi(), { onCreatePix });

    expect(screen.queryByText("Cadastre uma chave Pix")).toBeNull();
    expect(onCreatePix).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Criar conta" })).toBeEnabled();
  });

  it("preselects the default Pix key for a fresh billing", async () => {
    const client = financialApi({
      paymentMethods: jest.fn().mockResolvedValue({ paymentMethods: [{ id: "pix-2", label: "Nubank", pixKey: "ana@example.com", isDefault: true, archivedAt: null }] }),
    });

    await quickForm(client);
    await fillQuickBilling();
    await fireEvent.press(screen.getByRole("button", { name: "Criar conta" }));
    await waitFor(() => expect(client.createBilling).toHaveBeenCalled());

    expect(client.createBilling.mock.calls[0][0].paymentMethodId).toBe("pix-2");
  });

  it("replays the frozen body and key after an uncertain result", async () => {
    const createBilling = jest
      .fn()
      .mockRejectedValueOnce(new Error("A resposta não chegou."))
      .mockResolvedValueOnce({ id: "b1", charges: [{ id: "c1" }] });
    const { client } = await quickForm(financialApi({ createBilling }));

    await fillQuickBilling();
    await fireEvent.press(screen.getByRole("button", { name: "Criar conta" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("A resposta não chegou.");
    expect(screen.getByLabelText("Título")).toBeDisabled();

    await fireEvent.press(screen.getByRole("button", { name: "Tentar criar novamente" }));
    await waitFor(() => expect(client.createBilling).toHaveBeenCalledTimes(2));

    expect(client.createBilling.mock.calls[1]).toEqual(client.createBilling.mock.calls[0]);
  });

  it("unlocks the draft after a definitive rejection", async () => {
    const createBilling = jest.fn().mockRejectedValue(new FinancialRequestError("Contato arquivado.", 422));

    await quickForm(financialApi({ createBilling }));
    await fillQuickBilling();
    await fireEvent.press(screen.getByRole("button", { name: "Criar conta" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Contato arquivado.");
    expect(screen.getByLabelText("Título")).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Tentar criar novamente" })).toBeNull();
  });

  it("edits a finite billing by sending only category, Pix and reminders", async () => {
    const patchBilling = jest.fn().mockResolvedValue(onceBilling);
    const client = financialApi({ patchBilling });
    const onSaved = jest.fn();

    await render(<BillingFormScreen client={client as never} contacts={contactsApi()} billing={onceBilling} onSaved={onSaved} onBack={jest.fn()} />);
    await screen.findByText("Editar conta");
    expect(screen.getByText("Contas já geradas só permitem categoria, Pix e lembretes.")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Cadastrar chave" })).toBeNull();
    expect(screen.getByRole("button", { name: "Trocar chave Pix" })).toBeDisabled();

    await fireEvent.press(screen.getByRole("button", { name: "Categoria" }));
    await fireEvent.press(screen.getByRole("button", { name: "Transporte" }));
    await fireEvent.press(screen.getByRole("button", { name: "Salvar conta" }));
    await waitFor(() => expect(patchBilling).toHaveBeenCalled());

    expect(patchBilling).toHaveBeenCalledWith("b1", {
      paymentMethodId: "pix-1",
      clearPaymentMethod: false,
      reminders: [{ offsetDays: 0, enabled: true }],
      category: "transport",
    });
    expect(client.createBilling).not.toHaveBeenCalled();
  });

  const monthCharge: ChargeDetail = {
    id: "c9",
    description: "Jantar",
    amount: { amountCents: 9_000, currency: "BRL" },
    dueDate: "2026-09-20",
    state: ChargeState.Pending,
    billingId: "b2",
    recurrence: BillingRecurrence.Indefinite,
    installment: null,
    installmentCount: null,
    counterpartName: "Ana",
    proofState: null,
    direction: Direction.Receivable,
    recipient: { userId: "u1", name: "Ana", email: null },
    debtorId: "u1",
    pix: null,
    sharingState: SharingState.Ready,
    proof: null,
    cancelledAt: null,
    paidAt: null,
    createdAt: "2026-09-01T00:00:00Z",
  };

  const recurringWithCharge: BillingDetail = { ...onceBilling, id: "b2", recurrence: BillingRecurrence.Indefinite, frequency: BillingFrequency.Monthly, startDate: "2026-09-20", nextDueDate: "2026-09-20", charges: [monthCharge] };

  // Only Date is faked: RNTL keeps its real timers for waitFor.
  function onSeptemberTenth() {
    jest.useFakeTimers({
      now: new Date("2026-09-10T15:00:00Z"),
      doNotFake: ["nextTick", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout", "queueMicrotask", "requestAnimationFrame", "cancelAnimationFrame", "requestIdleCallback", "cancelIdleCallback", "hrtime", "performance"],
    });
  }

  afterEach(() => jest.useRealTimers());

  it("asks whether an amount change also reaches this month's charges", async () => {
    onSeptemberTenth();
    const patchBilling = jest.fn().mockResolvedValue(recurringWithCharge);
    const client = financialApi({ patchBilling });

    await render(<BillingFormScreen client={client as never} contacts={contactsApi()} billing={recurringWithCharge} onSaved={jest.fn()} onBack={jest.fn()} />);
    await screen.findByText("Editar conta");

    await fireEvent.changeText(screen.getByLabelText("Valor"), "12000");
    await fireEvent.press(screen.getByRole("button", { name: "Salvar conta" }));

    expect(await screen.findByRole("header", { name: "Aplicar às cobranças deste mês?" })).toBeOnTheScreen();
    expect(screen.getByText("1 cobrança de setembro ainda não venceu.")).toBeOnTheScreen();
    expect(patchBilling).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole("button", { name: "Aplicar também às deste mês" }));

    await waitFor(() => expect(patchBilling).toHaveBeenCalled());
    expect(patchBilling.mock.calls[0][1]).toMatchObject({ totalCents: 12_000, applyTo: "current_month" });
  });

  it("asks for the scope when the key of a recorrente conta a pagar moves to another of the contact's", async () => {
    onSeptemberTenth();
    const recurringPayable: BillingDetail = {
      ...payableBilling,
      id: "b9",
      recurrence: BillingRecurrence.Indefinite,
      frequency: BillingFrequency.Monthly,
      startDate: "2026-09-20",
      nextDueDate: "2026-09-20",
      charges: [{ ...monthCharge, billingId: "b9", direction: Direction.Payable }],
    };
    const patchBilling = jest.fn().mockResolvedValue(recurringPayable);
    const client = financialApi({ patchBilling });

    await render(<BillingFormScreen client={client as never} contacts={contactsApi()} billing={recurringPayable} onSaved={jest.fn()} onBack={jest.fn()} />);
    await screen.findByText("Editar conta");

    await waitFor(() => expect(screen.getByText("Chave secundária")).toBeOnTheScreen());

    await fireEvent.press(screen.getByRole("button", { name: "Trocar chave Pix" }));
    await fireEvent.press(await screen.findByRole("button", { name: "E-mail · ana@example.com" }));
    await fireEvent.press(screen.getByRole("button", { name: "Salvar conta" }));

    expect(await screen.findByRole("header", { name: "Aplicar às cobranças deste mês?" })).toBeOnTheScreen();
    expect(patchBilling).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole("button", { name: "Aplicar também às deste mês" }));

    await waitFor(() => expect(patchBilling).toHaveBeenCalled());
    expect(patchBilling.mock.calls[0][1]).toMatchObject({ paymentMethodId: "pix-ana", applyTo: "current_month" });
  });

  it("sends no scope when the owner keeps this month as it is", async () => {
    onSeptemberTenth();
    const patchBilling = jest.fn().mockResolvedValue(recurringWithCharge);
    const client = financialApi({ patchBilling });

    await render(<BillingFormScreen client={client as never} contacts={contactsApi()} billing={recurringWithCharge} onSaved={jest.fn()} onBack={jest.fn()} />);
    await screen.findByText("Editar conta");

    await fireEvent.changeText(screen.getByLabelText("Valor"), "12000");
    await fireEvent.press(screen.getByRole("button", { name: "Salvar conta" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Só a partir do mês seguinte" }));

    await waitFor(() => expect(patchBilling).toHaveBeenCalled());
    expect(patchBilling.mock.calls[0][1].applyTo).toBeUndefined();
  });

  it("saves an untouched recurring billing without asking", async () => {
    onSeptemberTenth();
    const patchBilling = jest.fn().mockResolvedValue(recurringWithCharge);
    const client = financialApi({ patchBilling });

    await render(<BillingFormScreen client={client as never} contacts={contactsApi()} billing={recurringWithCharge} onSaved={jest.fn()} onBack={jest.fn()} />);
    await screen.findByText("Editar conta");

    await fireEvent.press(screen.getByRole("button", { name: "Salvar conta" }));

    await waitFor(() => expect(patchBilling).toHaveBeenCalled());
    expect(screen.queryByRole("header", { name: "Aplicar às cobranças deste mês?" })).toBeNull();
  });

  it("creates a conta a pagar without participants, naming the contact who receives and one of their keys", async () => {
    const { client } = await quickForm();

    await chooseToPay();

    expect(screen.getByRole("button", { name: "Vou pagar" })).toBeSelected();
    expect(screen.queryByText("Divisão da Conta")).toBeNull();
    expect(screen.queryByText("Receber via Pix")).toBeNull();
    expect(screen.queryByLabelText("Eu também participo")).toBeNull();
    expect(screen.getByText("Valor")).toBeOnTheScreen();
    expect(screen.getByText("Escolha quem recebe.")).toBeOnTheScreen();
    // The key is no longer typed here: it belongs to the contact.
    expect(screen.queryByLabelText("Tipo de chave")).toBeNull();
    expect(screen.queryByLabelText("E-mail Pix")).toBeNull();
    expect(screen.queryByLabelText("Apelido da chave")).toBeNull();
    expect(screen.queryByText("Pagar via Pix")).toBeNull();

    await seatAna();

    expect(screen.getByRole("button", { name: "Ana" })).toBeSelected();
    // The seated contact's default key comes preselected.
    expect(await screen.findByText("Pagar via Pix")).toBeOnTheScreen();
    expect(client.paymentMethods).toHaveBeenCalledWith("p1");
    await waitFor(() => expect(screen.getByText("E-mail: ana@example.com")).toBeOnTheScreen());
    expect(screen.getByText("Chave padrão")).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByLabelText("Valor"), "10000");
    await fireEvent.changeText(screen.getByLabelText("Título"), "Aluguel");
    await fireEvent.press(screen.getByRole("button", { name: "Criar conta" }));
    await waitFor(() => expect(client.createBilling).toHaveBeenCalled());

    const input = client.createBilling.mock.calls[0][0];

    expect(input).toMatchObject({
      type: "payable",
      contactId: "p1",
      totalCents: 10_000,
      description: "Aluguel",
      paymentMethodId: "pix-ana",
    });
    expect(input.pix).toBeUndefined();
    expect(input.payeeUserId).toBeUndefined();
  });

  it("switches the conta a pagar to another key of the same contact", async () => {
    const { client } = await quickForm();

    await chooseToPay();
    await seatAna();

    await waitFor(() => expect(screen.getByText("Chave padrão")).toBeOnTheScreen());

    await fireEvent.press(screen.getByRole("button", { name: "Trocar chave Pix" }));
    await fireEvent.press(await screen.findByRole("button", { name: "CPF · 52998224725" }));

    await fireEvent.changeText(screen.getByLabelText("Valor"), "10000");
    await fireEvent.changeText(screen.getByLabelText("Título"), "Aluguel");
    await fireEvent.press(screen.getByRole("button", { name: "Criar conta" }));
    await waitFor(() => expect(client.createBilling).toHaveBeenCalled());

    expect(client.createBilling.mock.calls[0][0].paymentMethodId).toBe("pix-ana-2");
  });

  it("re-picks the default key when the receiving seat moves to another contact", async () => {
    const { client } = await quickForm();

    await chooseToPay();
    await seatAna();

    await waitFor(() => expect(screen.getByText("E-mail: ana@example.com")).toBeOnTheScreen());

    await fireEvent.press(screen.getByRole("button", { name: "Escolher contato" }));
    await fireEvent.press(await screen.findByRole("checkbox", { name: "Bruno" }));

    await waitFor(() => expect(client.paymentMethods).toHaveBeenCalledWith("p2"));
    await waitFor(() => expect(screen.getByText("E-mail: bruno@example.com")).toBeOnTheScreen());

    await fireEvent.changeText(screen.getByLabelText("Valor"), "10000");
    await fireEvent.changeText(screen.getByLabelText("Título"), "Aluguel");
    await fireEvent.press(screen.getByRole("button", { name: "Criar conta" }));
    await waitFor(() => expect(client.createBilling).toHaveBeenCalled());

    expect(client.createBilling.mock.calls[0][0]).toMatchObject({ contactId: "p2", paymentMethodId: "pix-bruno" });
  });

  it("points at the contact form when the seated contact has no Pix key yet", async () => {
    const onEditContact = jest.fn();
    const { client } = await quickForm(keylessContacts(), contactsApi(), { onEditContact });

    await chooseToPay();
    await seatAna();

    expect(await screen.findByText("Este contato ainda não tem chave Pix. Cadastre no contato.")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Trocar chave Pix" })).toBeNull();

    await fireEvent.changeText(screen.getByLabelText("Valor"), "10000");
    await fireEvent.press(screen.getByRole("button", { name: "Cadastrar chave" }));

    expect(onEditContact).toHaveBeenCalledWith("p1");
    expect(takeDraft()).toMatchObject({ payee: "p1", amount: "100,00" });
    expect(client.createBilling).not.toHaveBeenCalled();
  });

  it("shows the key the contact's form registered while the side trip was on top", async () => {
    // The contact starts with no key and the side trip registers one, the way the contact form would.
    const registered: Record<string, unknown[]> = { p1: [] };
    const client = financialApi({
      paymentMethods: jest.fn((contactId?: string) => Promise.resolve({ paymentMethods: contactId ? (registered[contactId] ?? []) : [nubank] })),
    });
    const onEditContact = jest.fn();

    await quickForm(client, contactsApi(), { onEditContact });
    await chooseToPay();
    await seatAna();

    expect(await screen.findByText("Este contato ainda não tem chave Pix. Cadastre no contato.")).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByLabelText("Valor"), "10000");
    await fireEvent.changeText(screen.getByLabelText("Título"), "Aluguel");
    await fireEvent.press(screen.getByRole("button", { name: "Cadastrar chave" }));

    expect(onEditContact).toHaveBeenCalledWith("p1");

    registered.p1 = [anaKey];
    await refocus();

    expect(await screen.findByText("E-mail: ana@example.com")).toBeOnTheScreen();
    expect(screen.queryByText("Este contato ainda não tem chave Pix. Cadastre no contato.")).toBeNull();

    await fireEvent.press(screen.getByRole("button", { name: "Criar conta" }));
    await waitFor(() => expect(client.createBilling).toHaveBeenCalled());

    expect(client.createBilling.mock.calls[0][0]).toMatchObject({ contactId: "p1", paymentMethodId: "pix-ana" });
  });

  it("never pays a conta a receber through a key of the contact it stopped paying", async () => {
    const { client } = await quickForm();

    await chooseToPay();
    await seatAna();

    await waitFor(() => expect(screen.getByText("E-mail: ana@example.com")).toBeOnTheScreen());

    await fireEvent.press(screen.getByRole("button", { name: "Vou receber" }));
    await screen.findByText("Participantes");
    await pickAna();

    // Back on the owner's own wallet, which the fresh form had already preselected.
    expect(screen.getByText("Receber via Pix")).toBeOnTheScreen();
    expect(screen.getByText("Chave padrão")).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByLabelText("Valor"), "10000");
    await fireEvent.changeText(screen.getByLabelText("Título"), "Jantar");
    await fireEvent.press(screen.getByRole("button", { name: "Criar conta" }));
    await waitFor(() => expect(client.createBilling).toHaveBeenCalled());

    expect(client.createBilling.mock.calls[0][0].paymentMethodId).toBe("pix-1");
  });

  it("sends a conta a pagar with no key at all when the contact has none", async () => {
    const { client } = await quickForm(keylessContacts());

    await chooseToPay();
    await seatAna();
    await screen.findByText("Este contato ainda não tem chave Pix. Cadastre no contato.");

    await fireEvent.changeText(screen.getByLabelText("Valor"), "10000");
    await fireEvent.changeText(screen.getByLabelText("Título"), "Aluguel");
    await fireEvent.press(screen.getByRole("button", { name: "Criar conta" }));
    await waitFor(() => expect(client.createBilling).toHaveBeenCalled());

    const input = client.createBilling.mock.calls[0][0];

    expect(input).toMatchObject({ type: "payable", contactId: "p1" });
    expect(input.paymentMethodId).toBeUndefined();
  });

  it("refuses a conta a pagar whose receiving chip was removed", async () => {
    const { client } = await quickForm();

    await chooseToPay();
    await seatAna();
    await fireEvent.press(await screen.findByRole("button", { name: "Ana" }));

    expect(screen.queryByRole("button", { name: "Ana" })).toBeNull();

    await fireEvent.changeText(screen.getByLabelText("Valor"), "10000");
    await fireEvent.changeText(screen.getByLabelText("Título"), "Aluguel");
    await fireEvent.press(screen.getByRole("button", { name: "Criar conta" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Escolha quem recebe.");
    expect(client.createBilling).not.toHaveBeenCalled();
  });

  it("never offers a Pix selector on a conta a pagar with no seated contact", async () => {
    const { client } = await quickForm();

    await chooseToPay();

    expect(screen.queryByText("Pagar via Pix")).toBeNull();
    expect(screen.getByText("Escolha quem recebe.")).toBeOnTheScreen();
    expect(client.paymentMethods).not.toHaveBeenCalledWith("p1");
  });

  it("does not gate a conta a pagar on the wallet", async () => {
    const onCreatePix = jest.fn();

    await render(<BillingFormScreen client={emptyWallet() as never} contacts={contactsApi()} onSaved={jest.fn()} onCreatePix={onCreatePix} />);

    expect(await screen.findByText("Cadastre uma chave Pix")).toBeOnTheScreen();

    await chooseToPay();

    expect(screen.queryByText("Cadastre uma chave Pix")).toBeNull();
    expect(screen.getByRole("button", { name: "Criar conta" })).toBeEnabled();
    expect(onCreatePix).not.toHaveBeenCalled();
  });

  it("seeds a conta a pagar edit with its receiving contact and key and locks the direction", async () => {
    const patchBilling = jest.fn().mockResolvedValue(payableBilling);
    const client = financialApi({ patchBilling });

    await render(<BillingFormScreen client={client as never} contacts={contactsApi()} billing={payableBilling} onSaved={jest.fn()} onBack={jest.fn()} />);
    await screen.findByText("Editar conta");

    expect(screen.getByRole("button", { name: "Vou pagar" })).toBeSelected();
    expect(screen.getByRole("button", { name: "Vou pagar" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Vou receber" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Ana" })).toBeSelected();
    // The seeded key survives the contact's key list landing: it is one of them.
    expect(await screen.findByText("CPF: 52998224725")).toBeOnTheScreen();
    expect(screen.getByText("Chave secundária")).toBeOnTheScreen();
    expect(screen.queryByLabelText("E-mail Pix")).toBeNull();
    expect(screen.queryByLabelText("Apelido da chave")).toBeNull();
    expect(screen.queryByRole("button", { name: "Convidar" })).toBeNull();

    await fireEvent.press(screen.getByRole("button", { name: "Salvar conta" }));
    await waitFor(() => expect(patchBilling).toHaveBeenCalled());

    // The seat did not move, so the patch leaves the receiving contact alone.
    expect(patchBilling).toHaveBeenCalledWith("b1", {
      paymentMethodId: "pix-ana-2",
      clearPaymentMethod: false,
      reminders: [{ offsetDays: 0, enabled: true }],
      category: "food",
    });
  });

  it("clears the key of a conta a pagar whose contact has none left", async () => {
    const patchBilling = jest.fn().mockResolvedValue(payableBilling);
    const client = keylessContacts();

    client.patchBilling = patchBilling;

    await render(<BillingFormScreen client={client as never} contacts={contactsApi()} billing={payableBilling} onSaved={jest.fn()} onBack={jest.fn()} />);

    expect(await screen.findByText("Este contato ainda não tem chave Pix. Cadastre no contato.")).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("button", { name: "Salvar conta" }));
    await waitFor(() => expect(patchBilling).toHaveBeenCalled());

    expect(patchBilling.mock.calls[0][1]).toMatchObject({ clearPaymentMethod: true });
    expect(patchBilling.mock.calls[0][1].paymentMethodId).toBeUndefined();
  });

  it("names the seated contact from the loaded billing when the agenda no longer lists them", async () => {
    const archived: BillingDetail = { ...payableBilling, id: "b8", contact: { id: "p9", userId: "u9", name: "Padaria", avatar: null } };

    await render(<BillingFormScreen client={financialApi() as never} contacts={contactsApi()} billing={archived} onSaved={jest.fn()} onBack={jest.fn()} />);
    await screen.findByText("Editar conta");

    expect(screen.getByRole("button", { name: "Padaria" })).toBeSelected();
    expect(screen.queryByRole("button", { name: "Contato" })).toBeNull();
  });

  it("keeps the schedule read-only on every edit", async () => {
    await render(<BillingFormScreen client={financialApi() as never} contacts={contactsApi()} billing={onceBilling} onSaved={jest.fn()} onBack={jest.fn()} />);
    await screen.findByText("Editar conta");

    expect(screen.getByLabelText("Vencimento")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Parcelado" })).toBeDisabled();
  });

  it("seeds the amount of a parcelado billing as its total, per-installment × installments", async () => {
    await render(<BillingFormScreen client={financialApi() as never} contacts={contactsApi()} billing={untilBilling} onSaved={jest.fn()} onBack={jest.fn()} />);
    await screen.findByText("Editar conta");

    expect(screen.getByLabelText("Valor")).toHaveDisplayValue("100,02");
  });

  it("orders the new-billing sections as Direção, Valor, Título, Frequência, Divisão and Chave Pix, with Adicionar pessoa below the participant list", async () => {
    await quickForm();
    await pickAna();

    const json = JSON.stringify(screen.toJSON());
    const markers = [
      "Valor total",
      "Título da conta",
      "Modalidade de Pagamento",
      "Divisão da Conta",
      "Adicionar pessoa",
      "Não notificar",
      "Eu também participo da divisão",
      "Receber via Pix",
      "Criar conta",
    ];
    const order = markers.map((marker) => json.indexOf(`"${marker}"`));

    expect(order.every((value) => value >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("moves the Para quem seat and the contact's Pix key to the Divisão slot for a conta a pagar", async () => {
    await quickForm();
    await chooseToPay();
    await seatAna();

    await screen.findByText("Pagar via Pix");

    const json = JSON.stringify(screen.toJSON());
    const order = ["Modalidade de Pagamento", "Para quem", "Pagar via Pix", "Criar conta"].map((marker) => json.indexOf(`"${marker}"`));

    expect(order.every((value) => value >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("hides the summary row above the submit button until the draft is valid", async () => {
    await quickForm();

    expect(screen.queryByText(/^Gera /)).toBeNull();
  });

  it("hides the summary row on every edit, even with an otherwise valid draft", async () => {
    const patchBilling = jest.fn().mockResolvedValue(onceBilling);

    await render(<BillingFormScreen client={financialApi({ patchBilling }) as never} contacts={contactsApi()} billing={onceBilling} onSaved={jest.fn()} onBack={jest.fn()} />);
    await screen.findByText("Editar conta");

    expect(screen.queryByText(/^Gera /)).toBeNull();
  });

  it("shows the draft summary text and total above the submit button for an installment", async () => {
    await quickForm();
    await pickAna();
    await fireEvent(screen.getByLabelText("Eu também participo"), "valueChange", false);
    await fireEvent.press(screen.getByRole("button", { name: "Parcelado" }));
    await fireEvent.changeText(screen.getByLabelText("Vencimento"), "2026-01-31");
    await fireEvent.changeText(screen.getByLabelText("Parcelas"), "3");
    await fireEvent.changeText(screen.getByLabelText("Valor"), "10000");
    await fireEvent.changeText(screen.getByLabelText("Título"), "Mercado QA");

    expect(screen.getByText("Gera 3 cobranças · 1 pessoa × 3 meses")).toBeOnTheScreen();
    // R$ 100,00 typed as the total, over 3 installments, rounds up to R$ 33,34 each.
    expect(screen.getByText("R$ 100,02")).toBeOnTheScreen();
  });

  it("shows the per-month total with /mês above the submit button for an indefinite draft", async () => {
    await quickForm();
    await pickAna();
    await fireEvent(screen.getByLabelText("Eu também participo"), "valueChange", false);
    await fireEvent.press(screen.getByRole("button", { name: "Recorrente" }));
    await fireEvent.changeText(screen.getByLabelText("Valor"), "10000");
    await fireEvent.changeText(screen.getByLabelText("Título"), "Assinatura QA");

    expect(screen.getByText("Gera 1 cobrança por mês · 1 pessoa")).toBeOnTheScreen();
    expect(screen.getByText("R$ 100,00/mês")).toBeOnTheScreen();
  });
});
