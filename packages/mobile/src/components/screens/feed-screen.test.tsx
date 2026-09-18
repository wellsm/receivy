import { act, fireEvent, render, screen } from "@testing-library/react-native";
import type { ComponentType, ReactElement } from "react";
import { Alert } from "react-native";
import {
  BillingKind,
  BillingRecurrence,
  calendarDate,
  ChargeState,
  currentMonth,
  Direction,
  type ListCharge,
  type ListChargeItem,
  monthLabel,
  ProofKind,
  ProofState,
  shiftMonth,
} from "@receivy/common";
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
const CURRENT_MONTH = currentMonth(new Date());
const NEXT_MONTH = shiftMonth(CURRENT_MONTH, 1);
const PREV_MONTH = shiftMonth(CURRENT_MONTH, -1);

function charge(overrides: Partial<ListChargeItem> & { id: string }): ListChargeItem {
  return {
    billingId: "b1",
    description: "Mercado semanal",
    amountCents: 8742,
    dueDate: today,
    state: ChargeState.Pending,
    type: Direction.Receivable,
    ownedByViewer: true,
    hasPayment: true,
    notify: true,
    counterpartReachable: true,
    confirmationRequired: true,
    proof: null,
    billing: { recurrence: BillingRecurrence.Once, kind: BillingKind.Live, contact: null },
    debtor: { name: "Maria" },
    installment: 1,
    installmentCount: 1,
    ...overrides,
  };
}

/** A conta a pagar of the viewer: they sit on the debtor side of their own billing. */
function own(overrides: Partial<ListChargeItem> & { id: string }): ListChargeItem {
  return charge({ type: Direction.Payable, ownedByViewer: true, hasPayment: false, confirmationRequired: false, creditor: { name: "Maria" }, ...overrides });
}

const deferred = () => {
  let resolve!: (value: ListCharge) => void;
  const promise = new Promise<ListCharge>((done) => {
    resolve = done;
  });

  return { promise, resolve };
};

async function pickDirection(label: string) {
  await fireEvent.press(screen.getByRole("button", { name: "Filtros" }));
  await fireEvent.press(screen.getByRole("button", { name: `Direção ${label}` }));
  await fireEvent.press(screen.getByRole("button", { name: "Aplicar" }));
}

describe("FeedScreen", () => {
  it("sums the month locally, groups charges by day and offers one action per card", async () => {
    const charges = jest.fn().mockResolvedValue([
      charge({ id: "c1", proof: { state: ProofState.Pending, kind: ProofKind.File } }),
      charge({ id: "c2", description: "Netflix", type: Direction.Payable, ownedByViewer: false, creditor: { name: "Netflix" }, amountCents: 2790 }),
      charge({ id: "c3", description: "Claude Team", debtor: { name: "João" }, dueDate: "2020-01-01", billing: { recurrence: BillingRecurrence.Indefinite, kind: BillingKind.Live, contact: null }, installment: undefined, installmentCount: undefined }),
      charge({ id: "c4", description: "Internet", debtor: { name: "Pedro" }, dueDate: "2099-01-01", counterpartReachable: false }),
      charge({ id: "c5", description: "Consultoria", amountCents: 20000, state: ChargeState.Paid }),
      charge({ id: "c6", description: "Luz", type: Direction.Payable, ownedByViewer: false, amountCents: 5000, state: ChargeState.Paid }),
    ]);
    const remind = jest.fn().mockResolvedValue({ queued: true });
    const openCharge = jest.fn();

    await renderFeed(<FeedScreen client={{ charges }} notifications={{ remind }} onOpenCharge={openCharge} />);

    // A receber: 3 × 87,42 still open; a pagar: 27,90 open. Realizado: 200,00 received − 50,00 paid.
    expect(await screen.findByText(/262,26/)).toBeOnTheScreen();
    expect(screen.getAllByText(/27,90/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/^\+ R\$\s384,36$/)).toBeOnTheScreen();
    expect(screen.getByText(/^\+ R\$\s150,00$/)).toBeOnTheScreen();
    expect(charges).toHaveBeenCalledWith(CURRENT_MONTH);
    expect(screen.getAllByText("Hoje").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("1 de janeiro de 2020")).toBeOnTheScreen();
    expect(screen.getByText("Comprovante enviado")).toBeOnTheScreen();
    expect(screen.getAllByText("Vence hoje").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Atrasado")).toBeOnTheScreen();
    expect(screen.getByText("Recorrente")).toBeOnTheScreen();
    expect(screen.getAllByText("Liquidado")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Pagar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Ver cobrança" })).toBeNull();

    await fireEvent.press(screen.getByRole("button", { name: "Abrir cobrança Netflix" }));

    expect(openCharge).toHaveBeenCalledWith("c2");

    // Only the overdue charge of João can be reminded: c1 is under review and Pedro has no address on file.
    await fireEvent.press(screen.getByRole("button", { name: "Lembrar" }));

    expect(screen.getByText("Lembrar João")).toBeOnTheScreen();
    expect(screen.getByText(/Claude Team · R\$\s87,42 · atrasado\. Avisa por notificação no app ou por e-mail/)).toBeOnTheScreen();
    expect(remind).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole("button", { name: "Enviar lembrete" }));

    expect(remind).toHaveBeenCalledWith("c3");
    expect(screen.queryByText("Lembrar João")).toBeNull();
    expect(await screen.findByText("Lembrete enviado")).toBeOnTheScreen();
  });

  it("marks the owner's own bill without Pix as paid after confirming and reloads quietly", async () => {
    const bill = own({ id: "own", description: "Aluguel" });
    const charges = jest
      .fn()
      .mockResolvedValueOnce([bill])
      .mockResolvedValueOnce([{ ...bill, state: ChargeState.Paid }]);
    const pay = jest.fn().mockResolvedValue({});

    jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons) => buttons?.find((button) => button.text === "Marcar paga")?.onPress?.());

    await renderFeed(<FeedScreen client={{ charges, pay }} />);

    await fireEvent.press(await screen.findByRole("button", { name: "Marcar pago" }));

    expect(Alert.alert).toHaveBeenCalledWith("Marcar como paga?", expect.stringContaining("pagamento integral"), expect.any(Array));
    expect(pay).toHaveBeenCalledWith("own");
    expect(await screen.findByText("Liquidado")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Marcar pago" })).toBeNull();
    expect(charges).toHaveBeenCalledTimes(2);
  });

  it("declares the owner's own bill to a payee who confirms", async () => {
    const bill = own({ id: "own", description: "Aluguel", confirmationRequired: true });
    const charges = jest
      .fn()
      .mockResolvedValueOnce([bill])
      .mockResolvedValueOnce([{ ...bill, proof: { state: ProofState.Pending, kind: ProofKind.Declaration } }]);
    const declarePayment = jest.fn().mockResolvedValue({});
    const pay = jest.fn();

    jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons) => buttons?.find((button) => button.text === "Marcar pago")?.onPress?.());

    await renderFeed(<FeedScreen client={{ charges, pay, declarePayment }} />);
    await fireEvent.press(await screen.findByRole("button", { name: "Marcar pago" }));

    expect(Alert.alert).toHaveBeenCalledWith("Marcar como pago?", "Maria vai receber um aviso para confirmar o recebimento.", expect.any(Array));
    expect(declarePayment).toHaveBeenCalledWith("own");
    expect(pay).not.toHaveBeenCalled();
    // The quiet reload shows the charge sitting em análise, and the action is gone until it is confirmed.
    expect(await screen.findByText("Em análise")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Marcar pago" })).toBeNull();
  });

  it("filters the month on screen without asking the API again", async () => {
    const charges = jest.fn().mockResolvedValue([
      charge({ id: "in", description: "Recebo" }),
      charge({ id: "out", description: "Pago", type: Direction.Payable, ownedByViewer: false }),
    ]);

    await renderFeed(<FeedScreen client={{ charges }} />);

    await screen.findByText(/Recebo/);

    expect(screen.getByText(/Pago/)).toBeOnTheScreen();

    await pickDirection("A pagar");

    expect(screen.queryByText(/Recebo/)).toBeNull();
    expect(screen.getByText(/Pago/)).toBeOnTheScreen();
    expect(screen.getByText(/^\+ R\$\s0,00$|^− R\$\s87,42$/)).toBeOnTheScreen();

    await pickDirection("A receber");

    expect(screen.getByText(/Recebo/)).toBeOnTheScreen();
    expect(charges).toHaveBeenCalledTimes(1);
  });

  it("keeps the latest month's answer when tabs are switched quickly", async () => {
    const next = deferred();
    const current = deferred();
    const charges = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockImplementation((month: string) => (month === NEXT_MONTH ? next.promise : current.promise));

    await renderFeed(<FeedScreen client={{ charges }} />);

    await screen.findByText("Sua timeline começa aqui");

    // The carousel re-centers on the next month, so the way back is the (now previous) current month.
    await fireEvent.press(screen.getByRole("tab", { name: monthLabel(NEXT_MONTH) }));
    await fireEvent.press(screen.getByRole("tab", { name: monthLabel(CURRENT_MONTH) }));
    await act(async () => {
      current.resolve([charge({ id: "new", description: "Resposta nova" })]);

      await Promise.resolve();
    });

    expect(await screen.findByText(/Resposta nova/)).toBeOnTheScreen();

    await act(async () => {
      next.resolve([charge({ id: "old", description: "Resposta antiga" })]);

      await Promise.resolve();
    });

    expect(screen.queryByText(/Resposta antiga/)).toBeNull();
    expect(charges).toHaveBeenLastCalledWith(CURRENT_MONTH);
  });

  it("surfaces a failed load and offers to retry", async () => {
    const charges = jest
      .fn()
      .mockResolvedValueOnce([charge({ id: "a", description: "Antes da falha" })])
      .mockRejectedValueOnce(new Error("Mês indisponível."))
      .mockResolvedValueOnce([charge({ id: "b", description: "Depois da falha" })]);

    await renderFeed(<FeedScreen client={{ charges }} />);

    await screen.findByText(/Antes da falha/);
    await fireEvent.press(screen.getByRole("tab", { name: monthLabel(NEXT_MONTH) }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Mês indisponível.");
    expect(screen.queryByText(/Antes da falha/)).toBeNull();

    await fireEvent.press(screen.getByRole("button", { name: "Tentar novamente" }));

    expect(await screen.findByText(/Depois da falha/)).toBeOnTheScreen();
    expect(charges).toHaveBeenLastCalledWith(NEXT_MONTH);
  });

  it("keeps the items on screen while a pull to refresh replaces them", async () => {
    const charges = jest
      .fn()
      .mockResolvedValueOnce([charge({ id: "a", description: "Antes" })])
      .mockResolvedValueOnce([charge({ id: "b", description: "Depois" })]);

    await renderFeed(<FeedScreen client={{ charges }} />);

    await screen.findByText(/Antes/);

    await act(async () => {
      await screen.getByTestId("feed-list").props.refreshControl.props.onRefresh();
    });

    expect(await screen.findByText(/Depois/)).toBeOnTheScreen();
    expect(screen.queryByText(/Antes/)).toBeNull();
    expect(screen.queryByLabelText("Carregando feed")).toBeNull();
    expect(charges).toHaveBeenCalledTimes(2);
  });

  it("shows three month tabs centered on the current month", async () => {
    const charges = jest.fn().mockResolvedValue([]);

    await renderFeed(<FeedScreen client={{ charges }} />);

    await screen.findByText("Sua timeline começa aqui");

    expect(screen.getByRole("tab", { name: monthLabel(PREV_MONTH) })).toBeOnTheScreen();
    expect(screen.getByRole("tab", { name: monthLabel(CURRENT_MONTH) })).toBeSelected();
    expect(screen.getByRole("tab", { name: monthLabel(NEXT_MONTH) })).toBeOnTheScreen();
    expect(charges).toHaveBeenLastCalledWith(CURRENT_MONTH);
  });

  it("selects the next month, reloads it and re-centers the tabs", async () => {
    const charges = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([charge({ id: "n1", description: "Mês seguinte", dueDate: `${NEXT_MONTH}-05` })]);

    await renderFeed(<FeedScreen client={{ charges }} />);

    await screen.findByText("Sua timeline começa aqui");

    await fireEvent.press(screen.getByRole("tab", { name: monthLabel(NEXT_MONTH) }));

    expect(await screen.findByText(/Mês seguinte/)).toBeOnTheScreen();
    expect(charges).toHaveBeenLastCalledWith(NEXT_MONTH);
    expect(screen.getByRole("tab", { name: monthLabel(NEXT_MONTH) })).toBeSelected();
    expect(screen.getByRole("tab", { name: monthLabel(CURRENT_MONTH) })).toBeOnTheScreen();
    expect(screen.queryByRole("tab", { name: monthLabel(PREV_MONTH) })).toBeNull();
  });
});
