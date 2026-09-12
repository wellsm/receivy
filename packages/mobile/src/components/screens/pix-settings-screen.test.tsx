import type { PaymentMethod } from "@receivy/common";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";
import { PixSettingsScreen } from "@/components/screens/pix-settings-screen";

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
    label: "",
    pixKey: "ana@example.com",
    pixKeyType: "email",
    isDefault: true,
    archivedAt: null,
    ...overrides,
  } as PaymentMethod;
}

function client(items: PaymentMethod[] = [method()]) {
  return {
    paymentMethods: jest.fn().mockResolvedValue({ paymentMethods: items }),
    defaultPaymentMethod: jest.fn().mockResolvedValue(method()),
    archivePaymentMethod: jest.fn().mockResolvedValue(undefined),
  };
}

describe("PixSettingsScreen", () => {
  beforeEach(() => jest.clearAllMocks());

  it("lists the active keys with the type label, the badge and the formatted key", async () => {
    const api = client([method({ pixKeyType: "cpf", pixKey: "12345678901", label: "Nubank" })]);

    await render(<PixSettingsScreen client={api} />);

    expect(await screen.findByText("CPF")).toBeOnTheScreen();
    expect(screen.getByText("123.456.789-01")).toBeOnTheScreen();
    expect(screen.getByText("Padrão")).toBeOnTheScreen();
    expect(screen.getByText("Chaves ativas (1)")).toBeOnTheScreen();
    expect(screen.getByText("Seus dados Pix ficam protegidos e nunca são compartilhados sem sua autorização.")).toBeOnTheScreen();
  });

  it("hides archived keys", async () => {
    const api = client([method(), method({ id: "pix-2", pixKey: "velha@example.com", isDefault: false, archivedAt: "2026-09-01T00:00:00Z" })]);

    await render(<PixSettingsScreen client={api} />);

    expect(await screen.findByText("ana@example.com")).toBeOnTheScreen();
    expect(screen.queryByText("velha@example.com")).toBeNull();
  });

  it("copies the key and announces it", async () => {
    const api = client();

    await render(<PixSettingsScreen client={api} />);

    await fireEvent.press(await screen.findByLabelText("Copiar chave"));

    await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalledWith("ana@example.com"));
    expect(await screen.findByText("Copiado")).toBeOnTheScreen();
  });

  it("reports a refused clipboard instead of announcing a copy that never happened", async () => {
    jest.mocked(Clipboard.setStringAsync).mockResolvedValue(false);

    await render(<PixSettingsScreen client={client()} />);

    await fireEvent.press(await screen.findByLabelText("Copiar chave"));

    expect(await screen.findByText("Não foi possível copiar a chave.")).toBeOnTheScreen();
    expect(screen.queryByText("Copiado")).toBeNull();
  });

  it("promotes another key to the default one", async () => {
    const api = client([method({ isDefault: false })]);

    await render(<PixSettingsScreen client={api} />);

    await fireEvent.press(await screen.findByLabelText("Tornar padrão"));

    await waitFor(() => expect(api.defaultPaymentMethod).toHaveBeenCalledWith("pix-1"));
    expect(api.paymentMethods).toHaveBeenCalledTimes(2);
  });

  it("archives a key only after the confirmation", async () => {
    const api = client();

    await render(<PixSettingsScreen client={api} />);

    await fireEvent.press(await screen.findByLabelText("Excluir"));

    expect(await screen.findByRole("header", { name: "Excluir chave Pix?" })).toBeOnTheScreen();
    expect(api.archivePaymentMethod).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("header", { name: "Excluir chave Pix?" })).toBeNull();

    await fireEvent.press(screen.getByLabelText("Excluir"));
    await fireEvent.press(await screen.findByRole("button", { name: "Remover" }));

    await waitFor(() => expect(api.archivePaymentMethod).toHaveBeenCalledWith("pix-1"));
  });

  it("announces why the Pix key is required when the billing form asked for it", async () => {
    await render(<PixSettingsScreen client={client([])} required />);

    expect(await screen.findByText("Você precisa de uma chave Pix para criar cobranças.")).toBeOnTheScreen();
  });

  it("hides the required notice on a plain visit", async () => {
    await render(<PixSettingsScreen client={client([])} />);

    expect(await screen.findByText("Nenhuma chave ainda")).toBeOnTheScreen();
    expect(screen.queryByText("Você precisa de uma chave Pix para criar cobranças.")).toBeNull();
  });

  it("sends the form screen to the dedicated route and keeps no inline form", async () => {
    const onNewKey = jest.fn();

    await render(<PixSettingsScreen client={client()} onNewKey={onNewKey} />);

    await fireEvent.press(await screen.findByLabelText("Cadastrar nova chave"));

    expect(onNewKey).toHaveBeenCalled();
    expect(screen.queryByLabelText("Salvar chave Pix")).toBeNull();
  });

  it("reports a list failure", async () => {
    const api = client();

    api.paymentMethods.mockRejectedValue(new Error("Sem conexão."));

    await render(<PixSettingsScreen client={api} />);

    expect(await screen.findByText("Sem conexão.")).toBeOnTheScreen();
  });
});
