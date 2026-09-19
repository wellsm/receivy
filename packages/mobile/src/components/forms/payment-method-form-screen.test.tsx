import { EMPTY_BILLING_DRAFT, PaymentProvider, PixKeyType, UserStatus, type AuthUser, type PaymentMethod } from "@receivy/common";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";
import { Linking } from "react-native";
import { clearDraft, saveDraft, takeDraft } from "@/financial/draft-store";
import { FinancialRequestError } from "@/financial/client";
import { PaymentMethodFormScreen } from "@/components/forms/payment-method-form-screen";

jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn().mockResolvedValue(true), getStringAsync: jest.fn().mockResolvedValue("") }));

function method(overrides: Partial<PaymentMethod> = {}): PaymentMethod {
  return {
    id: "pix-1",
    provider: PaymentProvider.Pix,
    kind: PixKeyType.Email,
    value: "ana@example.com",
    label: "",
    isDefault: false,
    contactId: null,
    archivedAt: null,
    createdAt: "2026-09-01T00:00:00Z",
    ...overrides,
  };
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

describe("PaymentMethodFormScreen", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => clearDraft());

  it("prefills the e-mail key with the account e-mail and keeps it editable", async () => {
    await render(<PaymentMethodFormScreen client={client()} profile={profile()} />);

    await waitFor(() => expect(screen.getByLabelText("E-mail Pix")).toHaveDisplayValue("conta@example.com"));

    await fireEvent.changeText(screen.getByLabelText("E-mail Pix"), "outra@example.com");

    expect(screen.getByLabelText("E-mail Pix")).toHaveDisplayValue("outra@example.com");
  });

  it("prefills the phone key with the account phone once that type is picked", async () => {
    await render(<PaymentMethodFormScreen client={client()} profile={profile("conta@example.com", "+5511987654321")} />);

    await waitFor(() => expect(screen.getByLabelText("E-mail Pix")).toHaveDisplayValue("conta@example.com"));

    await fireEvent.press(screen.getByRole("radio", { name: "Celular" }));

    expect(screen.getByLabelText("Telefone celular")).toHaveDisplayValue("(11) 98765-4321");
  });

  it("swaps the field label, placeholder and mask when the type changes", async () => {
    await render(<PaymentMethodFormScreen client={client()} profile={profile("")} />);

    await fireEvent.press(screen.getByLabelText("CPF"));

    const field = screen.getByLabelText("CPF do titular");

    expect(field.props.placeholder).toBe("000.000.000-00");

    await fireEvent.changeText(field, "12345678901");

    expect(screen.getByLabelText("CPF do titular")).toHaveDisplayValue("123.456.789-01");
  });

  it("sends the unmasked key the API expects", async () => {
    const api = client();

    await render(<PaymentMethodFormScreen client={api} profile={profile("")} />);

    await fireEvent.press(screen.getByLabelText("Celular"));
    await fireEvent.changeText(screen.getByLabelText("Telefone celular"), "11987654321");
    await fireEvent.press(screen.getByRole("button", { name: "Salvar meio de pagamento" }));

    await waitFor(() => expect(api.savePaymentMethod).toHaveBeenCalledWith({ provider: "pix", kind: "phone", value: "+5511987654321" }));
  });

  it("pastes the clipboard already formatted", async () => {
    jest.mocked(Clipboard.getStringAsync).mockResolvedValue("123.456.789-01");

    await render(<PaymentMethodFormScreen client={client()} profile={profile("")} />);

    await fireEvent.press(screen.getByLabelText("CPF"));
    await fireEvent.press(screen.getByLabelText("Colar"));

    await waitFor(() => expect(screen.getByLabelText("CPF do titular")).toHaveDisplayValue("123.456.789-01"));
  });

  it("turns the paste button into a clear button while the field has focus", async () => {
    await render(<PaymentMethodFormScreen client={client()} profile={profile("")} />);

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

    await render(<PaymentMethodFormScreen client={api} profile={profile("")} />);

    // An account that already has a key does not steal its main slot by default.
    await waitFor(() => expect(screen.getByLabelText("Definir como meio principal").props.value).toBe(false));

    await fireEvent(screen.getByLabelText("Definir como meio principal"), "valueChange", true);
    await fireEvent.changeText(screen.getByLabelText("E-mail Pix"), "nova@example.com");
    await fireEvent.press(screen.getByRole("button", { name: "Salvar meio de pagamento" }));

    await waitFor(() => expect(api.defaultPaymentMethod).toHaveBeenCalledWith("saved"));
  });

  it("leaves the first key alone: the API already made it the main one", async () => {
    const api = client();

    api.savePaymentMethod.mockResolvedValue(method({ id: "saved", isDefault: true }));

    await render(<PaymentMethodFormScreen client={api} profile={profile("")} />);

    await waitFor(() => expect(screen.getByLabelText("Definir como meio principal").props.value).toBe(true));

    await fireEvent.changeText(screen.getByLabelText("E-mail Pix"), "nova@example.com");
    await fireEvent.press(screen.getByRole("button", { name: "Salvar meio de pagamento" }));

    await waitFor(() => expect(api.savePaymentMethod).toHaveBeenCalled());

    expect(api.defaultPaymentMethod).not.toHaveBeenCalled();
  });

  it("hands the new key to the billing draft when it came from there", async () => {
    const api = client();
    const onSaved = jest.fn();

    saveDraft(EMPTY_BILLING_DRAFT(TIMEZONE, TODAY));

    await render(<PaymentMethodFormScreen client={api} profile={profile("")} returnTo="new-billing" required onSaved={onSaved} />);

    expect(screen.getByText("Você precisa de um meio de pagamento para criar cobranças.")).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByLabelText("E-mail Pix"), "nova@example.com");
    await fireEvent.press(screen.getByRole("button", { name: "Salvar meio de pagamento" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());

    expect(takeDraft()?.pix).toBe("saved");
  });

  it("refuses an empty key instead of letting the API answer for it", async () => {
    const api = client();

    await render(<PaymentMethodFormScreen client={api} profile={profile("")} />);

    await fireEvent.press(screen.getByRole("button", { name: "Salvar meio de pagamento" }));

    expect(await screen.findByText("Informe a chave Pix.")).toBeOnTheScreen();
    expect(api.savePaymentMethod).not.toHaveBeenCalled();
  });

  it("keeps the typed key when the save fails", async () => {
    const api = client();

    api.savePaymentMethod.mockRejectedValue(new Error("Chave inválida."));

    await render(<PaymentMethodFormScreen client={api} profile={profile("")} />);

    await fireEvent.changeText(screen.getByLabelText("E-mail Pix"), "nova@example.com");
    await fireEvent.press(screen.getByRole("button", { name: "Salvar meio de pagamento" }));

    expect(await screen.findByText("Chave inválida.")).toBeOnTheScreen();
    expect(screen.getByLabelText("E-mail Pix")).toHaveDisplayValue("nova@example.com");
  });

  it("saves an InfiniteTag", async () => {
    const api = client([]);

    await render(<PaymentMethodFormScreen client={api} profile={profile()} />);
    await fireEvent.press(screen.getByRole("radio", { name: "InfinitePay" }));
    await fireEvent.changeText(screen.getByLabelText("InfiniteTag"), "$Minha.Loja");
    await fireEvent.press(screen.getByRole("button", { name: "Salvar meio de pagamento" }));

    await waitFor(() => expect(api.savePaymentMethod).toHaveBeenCalledWith({ provider: "infinitepay", value: "$Minha.Loja" }));
  });

  it("refuses an empty InfiniteTag instead of letting the API answer for it", async () => {
    const api = client([]);

    await render(<PaymentMethodFormScreen client={api} profile={profile()} />);
    await fireEvent.press(screen.getByRole("radio", { name: "InfinitePay" }));
    await fireEvent.press(screen.getByRole("button", { name: "Salvar meio de pagamento" }));

    expect(await screen.findByText("Informe a InfiniteTag.")).toBeOnTheScreen();
    expect(api.savePaymentMethod).not.toHaveBeenCalled();
  });

  it("shows the InfinitePay switch when the checkout is off", async () => {
    const api = client([]);

    api.savePaymentMethod.mockRejectedValue(new FinancialRequestError("Ative o checkout externo no app da InfinitePay e tente de novo.", 422));
    await render(<PaymentMethodFormScreen client={api} profile={profile()} />);
    await fireEvent.press(screen.getByRole("radio", { name: "InfinitePay" }));
    await fireEvent.changeText(screen.getByLabelText("InfiniteTag"), "loja");
    await fireEvent.press(screen.getByRole("button", { name: "Salvar meio de pagamento" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Ative o checkout externo no app da InfinitePay e tente de novo.");

    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true as never);

    await fireEvent.press(screen.getByRole("button", { name: "Abrir configurações da InfinitePay" }));

    expect(open).toHaveBeenCalledWith("https://app.infinitepay.io/external-checkout");
  });

  it("clears the 422 switch when the provider chip is toggled away and back", async () => {
    const api = client([]);

    api.savePaymentMethod.mockRejectedValue(new FinancialRequestError("Ative o checkout externo no app da InfinitePay e tente de novo.", 422));
    await render(<PaymentMethodFormScreen client={api} profile={profile()} />);
    await fireEvent.press(screen.getByRole("radio", { name: "InfinitePay" }));
    await fireEvent.changeText(screen.getByLabelText("InfiniteTag"), "loja");
    await fireEvent.press(screen.getByRole("button", { name: "Salvar meio de pagamento" }));

    expect(await screen.findByRole("alert")).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("radio", { name: "Pix" }));
    await fireEvent.press(screen.getByRole("radio", { name: "InfinitePay" }));

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Abrir configurações da InfinitePay" })).toBeNull();
  });

  it("shows the PagBank token field with a hidden input", async () => {
    await render(<PaymentMethodFormScreen client={client()} profile={profile()} />);

    await fireEvent.press(screen.getByRole("radio", { name: "PagBank" }));

    expect(screen.getByLabelText("Token do PagBank").props.secureTextEntry).toBe(true);
  });

  it("saves a PagBank token and label", async () => {
    const api = client([]);

    await render(<PaymentMethodFormScreen client={api} profile={profile()} />);
    await fireEvent.press(screen.getByRole("radio", { name: "PagBank" }));
    await fireEvent.changeText(screen.getByLabelText("Token do PagBank"), "tok");
    await fireEvent.changeText(screen.getByLabelText("Rótulo"), "Loja");
    await fireEvent.press(screen.getByRole("button", { name: "Salvar meio de pagamento" }));

    await waitFor(() => expect(api.savePaymentMethod).toHaveBeenCalledWith({ provider: "pagseguro", token: "tok", label: "Loja" }));
  });

  it("refuses an empty PagBank token instead of letting the API answer for it", async () => {
    const api = client([]);

    await render(<PaymentMethodFormScreen client={api} profile={profile()} />);
    await fireEvent.press(screen.getByRole("radio", { name: "PagBank" }));
    await fireEvent.press(screen.getByRole("button", { name: "Salvar meio de pagamento" }));

    expect(await screen.findByText("Informe o token do PagBank.")).toBeOnTheScreen();
    expect(api.savePaymentMethod).not.toHaveBeenCalled();
  });

  it("shows only the message on a PagBank 422, without the InfinitePay button", async () => {
    const api = client([]);

    api.savePaymentMethod.mockRejectedValue(new FinancialRequestError("Token do PagBank inválido.", 422));
    await render(<PaymentMethodFormScreen client={api} profile={profile()} />);
    await fireEvent.press(screen.getByRole("radio", { name: "PagBank" }));
    await fireEvent.changeText(screen.getByLabelText("Token do PagBank"), "tok");
    await fireEvent.press(screen.getByRole("button", { name: "Salvar meio de pagamento" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Token do PagBank inválido.");
    expect(screen.queryByRole("button", { name: "Abrir configurações da InfinitePay" })).toBeNull();
  });

  it("pastes the clipboard into the PagBank token field", async () => {
    jest.mocked(Clipboard.getStringAsync).mockResolvedValue("tok-from-clipboard");

    await render(<PaymentMethodFormScreen client={client()} profile={profile()} />);
    await fireEvent.press(screen.getByRole("radio", { name: "PagBank" }));
    await fireEvent.press(screen.getByLabelText("Colar"));

    await waitFor(() => expect(screen.getByLabelText("Token do PagBank")).toHaveDisplayValue("tok-from-clipboard"));
  });
});
