import { act, fireEvent, render, screen } from "@testing-library/react-native";
import type { ComponentType, ReactElement } from "react";
import { Alert } from "react-native";
import { BillingRecurrence, calendarDate, ChargeState, currentMonth, Direction, monthLabel, ProofState, shiftMonth, type ChargeSummary, type TimelinePage } from "@receivy/common";
import { FeedScreen } from "@/components/screens/feed-screen";

/** Declared outside the factory: babel-jest rejects any identifier inside it, type parameters included, unless prefixed `mock`. */
type MockShow = (node: unknown) => void;

/** The filters button lives in the native header: the mock hands `right` to a slot rendered beside the screen. */
jest.mock("@/navigation/tab-header", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot close over module imports
  const react = require("react");
  const slots = new Set<MockShow>();
  let current: unknown = null;

  return {
    useTabHeader: ({ right }: { right?: unknown }) => {
      react.useEffect(() => {
        current = right ?? null;
        slots.forEach((show) => show(current));
      }, [right]);
    },
    HeaderSlot: () => {
      const [node, setNode] = react.useState(null);

      react.useEffect(() => {
        slots.add(setNode);
        setNode(current);

        return () => {
          slots.delete(setNode);
        };
      }, []);

      return node;
    },
  };
});

const { HeaderSlot } = jest.requireMock("@/navigation/tab-header") as { HeaderSlot: ComponentType };

function renderFeed(ui: ReactElement) {
  return render(
    <>
      {ui}
      <HeaderSlot />
    </>,
  );
}
jest.mock("expo-router", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot close over module imports
  const react = require("react");

  return { useFocusEffect: (callback: () => void | (() => void)) => react.useEffect(() => callback(), [callback]) };
});

const today = calendarDate();

const summary: TimelinePage["summary"] = {
  receivable: { amountCents: 74250, currency: "BRL" },
  payable: { amountCents: 38000, currency: "BRL" },
  overdue: { amountCents: 0, currency: "BRL" },
  pending: { amountCents: 112250, currency: "BRL" },
  proofsToReview: 1,
  receivableCount: 4,
  payableCount: 2,
  receivedTotal: { amountCents: 20000, currency: "BRL" },
  paidTotal: { amountCents: 5000, currency: "BRL" },
};

const empty: TimelinePage["summary"] = { ...summary, receivableCount: 0, payableCount: 0, proofsToReview: 0 };

function charge(overrides: Partial<ChargeSummary> & { id: string }): ChargeSummary {
  return {
    description: "Mercado semanal",
    amount: { amountCents: 8742, currency: "BRL" },
    dueDate: today,
    state: ChargeState.Pending,
    billingId: "b1",
    recurrence: BillingRecurrence.Once,
    installment: 1,
    installmentCount: 1,
    counterpartName: "Maria",
    proofState: null,
    ...overrides,
  };
}

function item(charge: ChargeSummary, direction: Direction = Direction.Receivable): TimelinePage["items"][number] {
  return { kind: "charge", direction, charge };
}

function page(items: TimelinePage["items"], nextCursor: string | null = null, overrides: Partial<TimelinePage["summary"]> = {}): TimelinePage {
  return { summary: { ...summary, ...overrides }, items, nextCursor };
}

const deferred = () => {
  let resolve!: (value: TimelinePage) => void;
  const promise = new Promise<TimelinePage>((done) => {
    resolve = done;
  });

  return { promise, resolve };
};

describe("FeedScreen", () => {
  it("shows the month totals and balance, groups charges by day and offers one action per card", async () => {
    const timeline = jest.fn().mockResolvedValue(
      page([
        item(charge({ id: "c1", proofState: ProofState.Pending })),
        item(charge({ id: "c2", description: "Netflix", counterpartName: "Netflix", amount: { amountCents: 2790, currency: "BRL" } }), Direction.Payable),
        item(charge({ id: "c3", description: "Claude Team", counterpartName: "João", dueDate: "2020-01-01", recurrence: BillingRecurrence.Indefinite, installment: null, installmentCount: null })),
        item(charge({ id: "c4", description: "Internet", counterpartName: "Pedro", dueDate: "2099-01-01", counterpartReachable: false })),
      ]),
    );
    const remind = jest.fn().mockResolvedValue({ queued: true });
    const openCharge = jest.fn();
    await renderFeed(<FeedScreen client={{ timeline }} notifications={{ remind }} onOpenCharge={openCharge} />);

    expect(await screen.findByText(/742,50/)).toBeOnTheScreen();
    expect(screen.getByText(/200,00 recebido/)).toBeOnTheScreen();
    expect(screen.getByText(/50,00 pago/)).toBeOnTheScreen();
    // Previsto: 742,50 − 380,00 + 200,00 − 50,00; Realizado: 200,00 − 50,00.
    expect(screen.getByText(/^\+ R\$\s512,50$/)).toBeOnTheScreen();
    expect(screen.getByText(/^\+ R\$\s150,00$/)).toBeOnTheScreen();
    expect(screen.getAllByText("Hoje").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("1 de janeiro de 2020")).toBeOnTheScreen();
    expect(screen.getByText("Comprovante enviado")).toBeOnTheScreen();
    expect(screen.getAllByText("Vence hoje")).toHaveLength(2);
    expect(screen.getByText("Atrasado")).toBeOnTheScreen();
    expect(screen.getByText("Recorrente")).toBeOnTheScreen();
    expect(screen.queryByText(/WhatsApp/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Nova cobrança" })).toBeNull();

    expect(screen.queryByRole("button", { name: "Pagar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Ver cobrança" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Ver comprovante" })).toBeNull();

    await fireEvent.press(screen.getByRole("button", { name: "Abrir cobrança Netflix" }));
    expect(openCharge).toHaveBeenCalledWith("c2");

    await fireEvent.press(screen.getByRole("button", { name: "Lembrar" }));
    expect(screen.getByText("Lembrar João")).toBeOnTheScreen();
    expect(screen.getByText(/Claude Team · R\$\s87,42 · atrasado\. Avisa por notificação no app ou por e-mail/)).toBeOnTheScreen();
    expect(screen.getByText("inclui link público e chave Pix")).toBeOnTheScreen();
    expect(remind).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole("button", { name: "Enviar lembrete" }));
    expect(remind).toHaveBeenCalledWith("c3");
    expect(screen.queryByText("Lembrar João")).toBeNull();
    expect(await screen.findByText("Lembrete enviado")).toBeOnTheScreen();
  });

  it("marks the owner's own bill without Pix as paid after confirming and reloads quietly", async () => {
    const own = charge({ id: "own", description: "Aluguel", ownedByViewer: true, hasPix: false });
    const timeline = jest
      .fn()
      .mockResolvedValueOnce(page([item(own, Direction.Payable)]))
      .mockResolvedValueOnce(page([item({ ...own, state: ChargeState.Paid }, Direction.Payable)]));
    const pay = jest.fn().mockResolvedValue({});
    jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons) => buttons?.find((button) => button.text === "Marcar paga")?.onPress?.());
    await renderFeed(<FeedScreen client={{ timeline, pay }} />);

    await fireEvent.press(await screen.findByRole("button", { name: "Marcar pago" }));
    expect(Alert.alert).toHaveBeenCalledWith("Marcar como paga?", expect.stringContaining("pagamento integral"), expect.any(Array));
    expect(pay).toHaveBeenCalledWith("own");
    expect(await screen.findByText("Liquidado")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Marcar pago" })).toBeNull();
    expect(timeline).toHaveBeenCalledTimes(2);
  });

  it("declares the owner's own bill to a payee who confirms", async () => {
    const own = charge({ id: "own", description: "Aluguel", ownedByViewer: true, hasPix: false, confirmationRequired: true });
    const timeline = jest
      .fn()
      .mockResolvedValueOnce(page([item(own, Direction.Payable)]))
      .mockResolvedValueOnce(page([item({ ...own, proofState: ProofState.Pending }, Direction.Payable)]));
    const declarePayment = jest.fn().mockResolvedValue({});
    const pay = jest.fn();
    jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons) => buttons?.find((button) => button.text === "Marcar pago")?.onPress?.());

    await renderFeed(<FeedScreen client={{ timeline, pay, declarePayment }} />);
    await fireEvent.press(await screen.findByRole("button", { name: "Marcar pago" }));

    expect(Alert.alert).toHaveBeenCalledWith("Marcar como pago?", "Maria vai receber um aviso para confirmar o recebimento.", expect.any(Array));
    expect(declarePayment).toHaveBeenCalledWith("own");
    expect(pay).not.toHaveBeenCalled();
    // The quiet reload shows the charge sitting em análise, and the action is gone until it is confirmed.
    expect(await screen.findByText("Em análise")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Marcar pago" })).toBeNull();
  });

  const CURRENT_MONTH = currentMonth(new Date());
const NEXT_MONTH = shiftMonth(CURRENT_MONTH, 1);
const PREV_MONTH = shiftMonth(CURRENT_MONTH, -1);

  /** The feed opens on the default filters: every status but cancelled, on the current month. */
const BASE_QUERY = `status=pending%2Coverdue%2Cpaid&month=${CURRENT_MONTH}`;

async function pickDirection(label: string) {
  await fireEvent.press(screen.getByRole("button", { name: "Filtros" }));
  await fireEvent.press(screen.getByRole("button", { name: `Direção ${label}` }));
  await fireEvent.press(screen.getByRole("button", { name: "Aplicar" }));
}

  it("filters by direction through the sheet and keeps the latest response", async () => {
    const receivable = deferred();
    const payable = deferred();
    const timeline = jest
      .fn()
      .mockResolvedValueOnce(page([], null, empty))
      .mockImplementation((query: string) => (query === `direction=receivable&${BASE_QUERY}` ? receivable.promise : payable.promise));
    await renderFeed(<FeedScreen client={{ timeline }} />);

    await screen.findByText("Sua timeline começa aqui");
    expect(screen.queryByRole("button", { name: "Contatos" })).toBeNull();

    await pickDirection("A receber");
    await pickDirection("A pagar");
    await act(async () => {
      payable.resolve(page([item(charge({ id: "new", description: "Resposta nova" }), Direction.Payable)]));
      await Promise.resolve();
    });
    expect(await screen.findByText(/Resposta nova/)).toBeOnTheScreen();
    await act(async () => {
      receivable.resolve(page([item(charge({ id: "old", description: "Resposta antiga" }))]));
      await Promise.resolve();
    });
    expect(screen.queryByText(/Resposta antiga/)).toBeNull();
    expect(timeline.mock.calls.at(-1)?.[0]).toBe(`direction=receivable%2Cpayable&${BASE_QUERY}`);
  });

  it("pages with the cursor", async () => {
    const timeline = jest
      .fn()
      .mockResolvedValueOnce(page([item(charge({ id: "a", description: "Primeira" }))], "page-2"))
      .mockResolvedValueOnce(page([item(charge({ id: "b", description: "Segunda", state: ChargeState.Paid, proofState: ProofState.Accepted }))]));
    await renderFeed(<FeedScreen client={{ timeline }} />);

    await screen.findByText(/Primeira/);
    await fireEvent.press(screen.getByRole("button", { name: "Carregar mais" }));
    expect(await screen.findByText(/Segunda/)).toBeOnTheScreen();
    expect(screen.getByText("Validado")).toBeOnTheScreen();
    expect(screen.getByText("Liquidado")).toBeOnTheScreen();
    expect(timeline).toHaveBeenNthCalledWith(2, `${BASE_QUERY}&cursor=page-2`);

  });

  it("surfaces filter failures and drops the stale cursor", async () => {
    const timeline = jest
      .fn()
      .mockResolvedValueOnce(page([item(charge({ id: "a", description: "Item do filtro A" }))], "cursor-a"))
      .mockRejectedValueOnce(new Error("Filtro indisponível."));
    await renderFeed(<FeedScreen client={{ timeline }} />);

    await screen.findByText(/Item do filtro A/);
    await pickDirection("A pagar");
    expect(await screen.findByRole("alert")).toHaveTextContent("Filtro indisponível.");
    expect(screen.queryByRole("button", { name: "Carregar mais" })).toBeNull();
    expect(screen.queryByText(/Item do filtro A/)).toBeNull();
  });

  it("keeps the items on screen while a pull to refresh replaces them", async () => {
    const timeline = jest
      .fn()
      .mockResolvedValueOnce(page([item(charge({ id: "a", description: "Antes" }))]))
      .mockResolvedValueOnce(page([item(charge({ id: "b", description: "Depois" }))]));
    await renderFeed(<FeedScreen client={{ timeline }} />);

    await screen.findByText(/Antes/);

    await act(async () => {
      await screen.getByTestId("feed-list").props.refreshControl.props.onRefresh();
    });

    expect(await screen.findByText(/Depois/)).toBeOnTheScreen();
    expect(screen.queryByText(/Antes/)).toBeNull();
    expect(screen.queryByLabelText("Carregando feed")).toBeNull();
    expect(timeline).toHaveBeenCalledTimes(2);
  });

  it("shows three month tabs centered on the current month", async () => {
    const timeline = jest.fn().mockResolvedValue(page([], null, empty));
    await renderFeed(<FeedScreen client={{ timeline }} />);

    await screen.findByText("Sua timeline começa aqui");

    expect(screen.getByRole("tab", { name: monthLabel(PREV_MONTH) })).toBeOnTheScreen();
    expect(screen.getByRole("tab", { name: monthLabel(CURRENT_MONTH) })).toBeSelected();
    expect(screen.getByRole("tab", { name: monthLabel(NEXT_MONTH) })).toBeOnTheScreen();
    expect(timeline).toHaveBeenLastCalledWith(BASE_QUERY);
  });

  it("selects the next month, reloads with month= and re-centers the tabs", async () => {
    const timeline = jest
      .fn()
      .mockResolvedValueOnce(page([], null, empty))
      .mockResolvedValueOnce(page([item(charge({ id: "n1", description: "Mês seguinte" }))]));
    await renderFeed(<FeedScreen client={{ timeline }} />);

    await screen.findByText("Sua timeline começa aqui");

    await fireEvent.press(screen.getByRole("tab", { name: monthLabel(NEXT_MONTH) }));

    expect(await screen.findByText(/Mês seguinte/)).toBeOnTheScreen();
    expect(timeline).toHaveBeenLastCalledWith(`status=pending%2Coverdue%2Cpaid&month=${NEXT_MONTH}`);
    expect(screen.getByRole("tab", { name: monthLabel(NEXT_MONTH) })).toBeSelected();
    expect(screen.getByRole("tab", { name: monthLabel(CURRENT_MONTH) })).toBeOnTheScreen();
    expect(screen.queryByRole("tab", { name: monthLabel(PREV_MONTH) })).toBeNull();
  });
});
