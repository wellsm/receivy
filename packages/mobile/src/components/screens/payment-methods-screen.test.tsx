import { PaymentProvider, PixKeyType, type PaymentMethod } from "@receivy/common";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";
import { PaymentMethodsScreen } from "@/components/screens/payment-methods-screen";

jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn().mockResolvedValue(true), getStringAsync: jest.fn().mockResolvedValue("") }));

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

function method(overrides: Partial<PaymentMethod> = {}): PaymentMethod {
  return {
    id: "pix-1",
    provider: PaymentProvider.Pix,
    kind: PixKeyType.Email,
    value: "ana@example.com",
    label: "",
    isDefault: true,
    archivedAt: null,
    contactId: null,
    createdAt: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

function client(items: PaymentMethod[] = [method()]) {
  return {
    paymentMethods: jest.fn().mockResolvedValue({ paymentMethods: items }),
    defaultPaymentMethod: jest.fn().mockResolvedValue(method()),
    archivePaymentMethod: jest.fn().mockResolvedValue(undefined),
  };
}

describe("PaymentMethodsScreen", () => {
  beforeEach(() => jest.clearAllMocks());

  it("lists the active methods with the type label, the badge and the formatted value", async () => {
    const api = client([method({ kind: PixKeyType.Cpf, value: "12345678901", label: "Nubank" })]);

    await render(<PaymentMethodsScreen client={api} />);

    expect(await screen.findByText("CPF")).toBeOnTheScreen();
    expect(screen.getByText("123.456.789-01")).toBeOnTheScreen();
    expect(screen.getByText("Padrão")).toBeOnTheScreen();
    expect(screen.getByText("Meios ativos (1)")).toBeOnTheScreen();
    expect(screen.getByText("Seus dados de recebimento ficam protegidos e nunca são compartilhados sem sua autorização.")).toBeOnTheScreen();
  });

  it("lists an InfinitePay method with its tag", async () => {
    const api = client([method(), method({ id: "ip-1", provider: PaymentProvider.InfinitePay, kind: null, value: "minha.loja", label: "Loja", isDefault: false })]);

    await render(<PaymentMethodsScreen client={api} />);

    expect(await screen.findByText("InfinitePay")).toBeOnTheScreen();
    expect(screen.getByText("$minha.loja")).toBeOnTheScreen();
  });

  it("hides archived methods", async () => {
    const api = client([method(), method({ id: "pix-2", value: "velha@example.com", isDefault: false, archivedAt: "2026-09-01T00:00:00Z" })]);

    await render(<PaymentMethodsScreen client={api} />);

    expect(await screen.findByText("ana@example.com")).toBeOnTheScreen();
    expect(screen.queryByText("velha@example.com")).toBeNull();
  });

  it("copies the value and announces it", async () => {
    const api = client();

    await render(<PaymentMethodsScreen client={api} />);

    await fireEvent.press(await screen.findByLabelText("Copiar valor"));

    await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalledWith("ana@example.com"));

    expect(await screen.findByText("Copiado")).toBeOnTheScreen();
  });

  it("reports a refused clipboard instead of announcing a copy that never happened", async () => {
    jest.mocked(Clipboard.setStringAsync).mockResolvedValue(false);

    await render(<PaymentMethodsScreen client={client()} />);

    await fireEvent.press(await screen.findByLabelText("Copiar valor"));

    expect(await screen.findByText("Não foi possível copiar o valor.")).toBeOnTheScreen();
    expect(screen.queryByText("Copiado")).toBeNull();
  });

  it("promotes another method to the default one", async () => {
    const api = client([method({ isDefault: false })]);

    await render(<PaymentMethodsScreen client={api} />);

    await fireEvent.press(await screen.findByLabelText("Tornar padrão"));

    await waitFor(() => expect(api.defaultPaymentMethod).toHaveBeenCalledWith("pix-1"));

    expect(api.paymentMethods).toHaveBeenCalledTimes(2);
  });

  it("archives a method only after the confirmation", async () => {
    const api = client();

    await render(<PaymentMethodsScreen client={api} />);

    await fireEvent.press(await screen.findByLabelText("Excluir"));

    expect(await screen.findByRole("header", { name: "Excluir meio de pagamento?" })).toBeOnTheScreen();
    expect(api.archivePaymentMethod).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByRole("header", { name: "Excluir meio de pagamento?" })).toBeNull();

    await fireEvent.press(screen.getByLabelText("Excluir"));
    await fireEvent.press(await screen.findByRole("button", { name: "Remover" }));

    await waitFor(() => expect(api.archivePaymentMethod).toHaveBeenCalledWith("pix-1"));
  });

  it("announces why a payment method is required when the billing form asked for it", async () => {
    await render(<PaymentMethodsScreen client={client([])} required />);

    expect(await screen.findByText("Você precisa de um meio de pagamento para criar cobranças.")).toBeOnTheScreen();
  });

  it("hides the required notice on a plain visit", async () => {
    await render(<PaymentMethodsScreen client={client([])} />);

    expect(await screen.findByText("Nenhum meio de pagamento")).toBeOnTheScreen();
    expect(screen.queryByText("Você precisa de um meio de pagamento para criar cobranças.")).toBeNull();
  });

  it("sends the form screen to the dedicated route and keeps no inline form", async () => {
    const onNewMethod = jest.fn();

    await render(<PaymentMethodsScreen client={client()} onNewMethod={onNewMethod} />);

    await fireEvent.press(await screen.findByLabelText("Cadastrar novo meio"));

    expect(onNewMethod).toHaveBeenCalled();
    expect(screen.queryByLabelText("Salvar meio de pagamento")).toBeNull();
  });

  it("hides the copy button on a PagBank row", async () => {
    const api = client([method({ id: "pb-1", provider: PaymentProvider.PagSeguro, kind: null, value: "Conta da loja", label: "PagBank" })]);

    await render(<PaymentMethodsScreen client={api} />);

    expect(await screen.findByText("PagBank")).toBeOnTheScreen();
    expect(screen.getByText("Conta da loja")).toBeOnTheScreen();
    expect(screen.queryByLabelText("Copiar valor")).toBeNull();
  });

  it("reports a list failure", async () => {
    const api = client();

    api.paymentMethods.mockRejectedValue(new Error("Sem conexão."));

    await render(<PaymentMethodsScreen client={api} />);

    expect(await screen.findByText("Sem conexão.")).toBeOnTheScreen();
  });
});
