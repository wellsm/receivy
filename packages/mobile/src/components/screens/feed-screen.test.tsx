import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Alert } from "react-native";
import { calendarDate, type ChargeSummary, type TimelinePage } from "@receivy/common";
import { FeedScreen } from "@/components/screens/feed-screen";

jest.mock("@/navigation/tab-header", () => ({ useTabHeader: () => {} }));
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
};

const empty: TimelinePage["summary"] = { ...summary, receivableCount: 0, payableCount: 0, proofsToReview: 0 };

function charge(overrides: Partial<ChargeSummary> & { id: string }): ChargeSummary {
  return {
    description: "Mercado semanal",
    amount: { amountCents: 8742, currency: "BRL" },
    dueDate: today,
    state: "pending",
    billingId: "b1",
    billingType: "once",
    installment: 1,
    installmentCount: 1,
    counterpartName: "Maria",
    proofState: null,
    ...overrides,
  };
}

function item(charge: ChargeSummary, direction: "receivable" | "payable" = "receivable"): TimelinePage["items"][number] {
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
  it("shows totals with counts, groups charges by day and offers one action per card", async () => {
    const timeline = jest.fn().mockResolvedValue(
      page([
        item(charge({ id: "c1", proofState: "pending" })),
        item(charge({ id: "c2", description: "Netflix", counterpartName: "Netflix", amount: { amountCents: 2790, currency: "BRL" } }), "payable"),
        item(charge({ id: "c3", description: "Claude Team", counterpartName: "João", dueDate: "2020-01-01", billingType: "indefinite", installment: null, installmentCount: null })),
        item(charge({ id: "c4", description: "Internet", counterpartName: "Pedro", dueDate: "2099-01-01", counterpartReachable: false })),
      ]),
    );
    jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons) => buttons?.find((button) => button.text === "Enviar lembrete")?.onPress?.());
    const remind = jest.fn().mockResolvedValue({ queued: true });
    const openCharge = jest.fn();
    await render(<FeedScreen client={{ timeline }} notifications={{ remind }} onOpenCharge={openCharge} />);

    expect(await screen.findByText(/742,50/)).toBeOnTheScreen();
    expect(screen.getByText("4 pendências")).toBeOnTheScreen();
    expect(screen.getByText("2 pendências")).toBeOnTheScreen();
    expect(screen.getAllByText("Hoje").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("1 de janeiro de 2020")).toBeOnTheScreen();
    expect(screen.getByText("Comprovante enviado")).toBeOnTheScreen();
    expect(screen.getAllByText("Vence hoje")).toHaveLength(2);
    expect(screen.getByText("Atrasado")).toBeOnTheScreen();
    expect(screen.getByText("Recorrente")).toBeOnTheScreen();
    expect(screen.queryByText(/WhatsApp/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Nova cobrança" })).toBeNull();

    await fireEvent.press(screen.getByRole("button", { name: "Pagar via Pix" }));
    expect(openCharge).toHaveBeenCalledWith("c2");

    await fireEvent.press(screen.getByRole("button", { name: "Ver cobrança" }));
    expect(openCharge).toHaveBeenCalledWith("c4");

    await fireEvent.press(screen.getByRole("button", { name: "Lembrar" }));
    expect(Alert.alert).toHaveBeenCalledWith("Enviar lembrete?", expect.stringContaining("Avisa João por notificação no app ou por e-mail"), expect.any(Array));
    expect(remind).toHaveBeenCalledWith("c3");
    expect(await screen.findByText("Lembrete enviado")).toBeOnTheScreen();
  });

  /** The feed opens on the default filters: every status but cancelled. */
const BASE_QUERY = "status=pending%2Coverdue%2Cpaid";

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
    await render(<FeedScreen client={{ timeline }} />);

    await screen.findByText("Sua timeline começa aqui");
    expect(screen.queryByRole("button", { name: "Contatos" })).toBeNull();

    await pickDirection("A receber");
    await pickDirection("A pagar");
    await act(async () => {
      payable.resolve(page([item(charge({ id: "new", description: "Resposta nova" }), "payable")]));
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
      .mockResolvedValueOnce(page([item(charge({ id: "b", description: "Segunda", state: "paid", proofState: "accepted" }))]));
    await render(<FeedScreen client={{ timeline }} />);

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
    await render(<FeedScreen client={{ timeline }} />);

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
    await render(<FeedScreen client={{ timeline }} />);

    await screen.findByText(/Antes/);

    await act(async () => {
      await screen.getByTestId("feed-list").props.refreshControl.props.onRefresh();
    });

    expect(await screen.findByText(/Depois/)).toBeOnTheScreen();
    expect(screen.queryByText(/Antes/)).toBeNull();
    expect(screen.queryByLabelText("Carregando feed")).toBeNull();
    expect(timeline).toHaveBeenCalledTimes(2);
  });
});
