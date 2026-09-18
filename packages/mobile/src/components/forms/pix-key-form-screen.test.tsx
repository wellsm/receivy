import { EMPTY_BILLING_DRAFT, UserStatus, type AuthUser, type PaymentMethod } from "@receivy/common";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";
import { clearDraft, saveDraft, takeDraft } from "@/financial/draft-store";
import { PixKeyFormScreen } from "@/components/forms/pix-key-form-screen";

jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn().mockResolvedValue(true), getStringAsync: jest.fn().mockResolvedValue("") }));

function method(overrides: Partial<PaymentMethod> = {}): PaymentMethod {
  return {
    id: "pix-1",
    label: "",
    pixKey: "ana@example.com",
    pixKeyType: "email",
    isDefault: false,
    archivedAt: null,
    ...overrides,
  } as PaymentMethod;
}

function client(items: PaymentMethod[] = []) {
  return {
    paymentMethods: jest.fn().mockResolvedValue({ paymentMethods: items }),
    savePaymentMethod: jest.fn().mockResolvedValue(method({ id: "saved" })),
    defaultPaymentMethod: jest.fn().mockResolvedValue(method()),
  };
}

function profile(email = "conta@example.com", phone: string | null = null) {
  const user = {
    id: "u1",
    email,
    name: null,
    phone,
    avatar: null,
    status: UserStatus.Active,
    locale: "pt-BR",
    timezone: "America/Sao_Paulo",
    country: "BR",
    currency: "BRL",
  } satisfies AuthUser;

  return { load: jest.fn().mockResolvedValue(user) };
}

const TIMEZONE = "America/Sao_Paulo";
const TODAY = "2026-09-10";

describe("PixKeyFormScreen", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => clearDraft());

  it("prefills the e-mail key with the account e-mail and keeps it editable", async () => {
    await render(<PixKeyFormScreen client={client()} profile={profile()} />);

    await waitFor(() => expect(screen.getByLabelText("E-mail Pix")).toHaveDisplayValue("conta@example.com"));

    await fireEvent.changeText(screen.getByLabelText("E-mail Pix"), "outra@example.com");

    expect(screen.getByLabelText("E-mail Pix")).toHaveDisplayValue("outra@example.com");
  });

  it("prefills the phone key with the account phone once that type is picked", async () => {
    await render(<PixKeyFormScreen client={client()} profile={profile("conta@example.com", "+5511987654321")} />);

    await waitFor(() => expect(screen.getByLabelText("E-mail Pix")).toHaveDisplayValue("conta@example.com"));

    await fireEvent.press(screen.getByRole("radio", { name: "Celular" }));

    expect(screen.getByLabelText("Telefone celular")).toHaveDisplayValue("(11) 98765-4321");
  });

  it("swaps the field label, placeholder and mask when the type changes", async () => {
    await render(<PixKeyFormScreen client={client()} profile={profile("")} />);

    await fireEvent.press(screen.getByLabelText("CPF"));

    const field = screen.getByLabelText("CPF do titular");

    expect(field.props.placeholder).toBe("000.000.000-00");

    await fireEvent.changeText(field, "12345678901");

    expect(screen.getByLabelText("CPF do titular")).toHaveDisplayValue("123.456.789-01");
  });

  it("sends the unmasked key the API expects", async () => {
    const api = client();

    await render(<PixKeyFormScreen client={api} profile={profile("")} />);

    await fireEvent.press(screen.getByLabelText("Celular"));
    await fireEvent.changeText(screen.getByLabelText("Telefone celular"), "11987654321");
    await fireEvent.press(screen.getByLabelText("Salvar chave Pix"));

    await waitFor(() => expect(api.savePaymentMethod).toHaveBeenCalledWith({ pixKeyType: "phone", pixKey: "+5511987654321" }));
  });

  it("pastes the clipboard already formatted", async () => {
    jest.mocked(Clipboard.getStringAsync).mockResolvedValue("123.456.789-01");

    await render(<PixKeyFormScreen client={client()} profile={profile("")} />);

    await fireEvent.press(screen.getByLabelText("CPF"));
    await fireEvent.press(screen.getByLabelText("Colar"));

    await waitFor(() => expect(screen.getByLabelText("CPF do titular")).toHaveDisplayValue("123.456.789-01"));
  });

  it("turns the paste button into a clear button while the field has focus", async () => {
    await render(<PixKeyFormScreen client={client()} profile={profile("")} />);

    await fireEvent.press(screen.getByLabelText("CPF"));

    const field = screen.getByLabelText("CPF do titular");

    await fireEvent.changeText(field, "12345678901");

    expect(screen.getByLabelText("Colar")).toBeOnTheScreen();

    await fireEvent(field, "focus");

    await fireEvent.press(screen.getByLabelText("Limpar"));

    expect(screen.getByLabelText("CPF do titular")).toHaveDisplayValue("");
  });

  it("promotes the saved key when the main-key switch is on", async () => {
    const api = client([method({ isDefault: true })]);

    await render(<PixKeyFormScreen client={api} profile={profile("")} />);

    // An account that already has a key does not steal its main slot by default.
    await waitFor(() => expect(screen.getByLabelText("Definir como chave principal").props.value).toBe(false));

    await fireEvent(screen.getByLabelText("Definir como chave principal"), "valueChange", true);
    await fireEvent.changeText(screen.getByLabelText("E-mail Pix"), "nova@example.com");
    await fireEvent.press(screen.getByLabelText("Salvar chave Pix"));

    await waitFor(() => expect(api.defaultPaymentMethod).toHaveBeenCalledWith("saved"));
  });

  it("leaves the first key alone: the API already made it the main one", async () => {
    const api = client();

    api.savePaymentMethod.mockResolvedValue(method({ id: "saved", isDefault: true }));

    await render(<PixKeyFormScreen client={api} profile={profile("")} />);

    await waitFor(() => expect(screen.getByLabelText("Definir como chave principal").props.value).toBe(true));

    await fireEvent.changeText(screen.getByLabelText("E-mail Pix"), "nova@example.com");
    await fireEvent.press(screen.getByLabelText("Salvar chave Pix"));

    await waitFor(() => expect(api.savePaymentMethod).toHaveBeenCalled());

    expect(api.defaultPaymentMethod).not.toHaveBeenCalled();
  });

  it("hands the new key to the billing draft when it came from there", async () => {
    const api = client();
    const onSaved = jest.fn();

    saveDraft(EMPTY_BILLING_DRAFT(TIMEZONE, TODAY));

    await render(<PixKeyFormScreen client={api} profile={profile("")} returnTo="new-billing" required onSaved={onSaved} />);

    expect(screen.getByText("Você precisa de uma chave Pix para criar cobranças.")).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByLabelText("E-mail Pix"), "nova@example.com");
    await fireEvent.press(screen.getByLabelText("Salvar chave Pix"));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());

    expect(takeDraft()?.pix).toBe("saved");
  });

  it("refuses an empty key instead of letting the API answer for it", async () => {
    const api = client();

    await render(<PixKeyFormScreen client={api} profile={profile("")} />);

    await fireEvent.press(screen.getByLabelText("Salvar chave Pix"));

    expect(await screen.findByText("Informe a chave Pix.")).toBeOnTheScreen();
    expect(api.savePaymentMethod).not.toHaveBeenCalled();
  });

  it("keeps the typed key when the save fails", async () => {
    const api = client();

    api.savePaymentMethod.mockRejectedValue(new Error("Chave inválida."));

    await render(<PixKeyFormScreen client={api} profile={profile("")} />);

    await fireEvent.changeText(screen.getByLabelText("E-mail Pix"), "nova@example.com");
    await fireEvent.press(screen.getByLabelText("Salvar chave Pix"));

    expect(await screen.findByText("Chave inválida.")).toBeOnTheScreen();
    expect(screen.getByLabelText("E-mail Pix")).toHaveDisplayValue("nova@example.com");
  });
});
