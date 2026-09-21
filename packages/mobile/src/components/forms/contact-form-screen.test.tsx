import { EMPTY_BILLING_DRAFT, PaymentProvider, PhoneSource, PixKeyType, UserStatus, type Contact, type PaymentMethod } from "@receivy/common";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { clearDraft, saveDraft, takeDraft } from "@/financial/draft-store";
import { ContactsRequestError } from "@/contacts/client";
import { ContactFormScreen } from "@/components/forms/contact-form-screen";

function contact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: "p1",
    userId: "u1",
    name: "Ana Paula Souza",
    nickname: null,
    displayName: "Ana Paula Souza",
    email: "ana@example.com",
    phone: null,
    phoneSource: null,
    whatsappConsentAt: null,
    status: UserStatus.Pending,
    archivedAt: null,
    createdAt: "2026-09-01T00:00:00Z",
    lastBilledAt: null,
    activeCharges: 0,
    ...overrides,
  };
}

function contactsApi(loaded: Contact = contact()) {
  return {
    get: jest.fn().mockResolvedValue(loaded),
    save: jest.fn().mockResolvedValue(contact({ id: "saved", userId: "u-saved" })),
  };
}

/** The keys the owner filed under this contact, the way `GET /payment-methods?contactId=` answers them. */
const nubank: PaymentMethod = {
  id: "pm-1",
  provider: PaymentProvider.Pix,
  label: "Nubank",
  value: "ana@example.com",
  kind: PixKeyType.Email,
  isDefault: true,
  contactId: "p1",
  archivedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
};
const itau: PaymentMethod = { ...nubank, id: "pm-2", label: "Itaú", value: "52998224725", kind: PixKeyType.Cpf, isDefault: false, createdAt: "2026-01-02T00:00:00Z" };

function financialApi(keys: PaymentMethod[] = []) {
  return {
    paymentMethods: jest.fn().mockResolvedValue({ paymentMethods: keys }),
    defaultPaymentMethod: jest.fn().mockResolvedValue(itau),
    archivePaymentMethod: jest.fn().mockResolvedValue(undefined),
  };
}

const TIMEZONE = "America/Sao_Paulo";
const TODAY = "2026-09-10";
const LINKED_NOTE = "Contato vinculado a uma conta: só o apelido pode mudar.";

describe("ContactFormScreen", () => {
  afterEach(() => clearDraft());

  it("saves a contact with the name and the e-mail", async () => {
    const client = contactsApi();

    await render(<ContactFormScreen client={client} />);

    await fireEvent.changeText(screen.getByLabelText("Nome completo"), "  Ana Paula Souza  ");
    await fireEvent.changeText(screen.getByLabelText("E-mail (opcional)"), " Ana@Example.com ");
    await fireEvent.press(screen.getByLabelText("Salvar contato"));

    await waitFor(() => expect(client.save).toHaveBeenCalledWith({ name: "Ana Paula Souza", email: "ana@example.com", whatsappConsent: false }, undefined));

    expect(client.get).not.toHaveBeenCalled();
  });

  it("saves a contact without e-mail and has no phone field", async () => {
    const client = contactsApi();

    await render(<ContactFormScreen client={client} />);

    expect(screen.queryByLabelText("WhatsApp / Celular")).toBeNull();
    expect(screen.getByText("E-mail (opcional)")).toBeOnTheScreen();
    expect(screen.getByText("Sem e-mail, a pessoa só recebe pelo link compartilhado. Quando ela entrar por um convite, você confirma quem é.")).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByLabelText("Nome completo"), "Ana");
    await fireEvent.press(screen.getByLabelText("Salvar contato"));

    await waitFor(() => expect(client.save).toHaveBeenCalledWith({ name: "Ana", whatsappConsent: false }, undefined));

    expect(client.save.mock.calls[0]?.[0]).not.toHaveProperty("email");
  });

  it("still rejects an e-mail that does not look like an address", async () => {
    const client = contactsApi();

    await render(<ContactFormScreen client={client} />);

    await fireEvent.changeText(screen.getByLabelText("Nome completo"), "Ana");
    await fireEvent.changeText(screen.getByLabelText("E-mail (opcional)"), "ana");
    await fireEvent.press(screen.getByLabelText("Salvar contato"));

    expect(await screen.findByText("Informe um e-mail válido.")).toBeOnTheScreen();
    expect(client.save).not.toHaveBeenCalled();
  });

  it("sends the nickname the person prefers", async () => {
    const client = contactsApi();

    await render(<ContactFormScreen client={client} />);

    await fireEvent.changeText(screen.getByLabelText("Nome completo"), "Ana Paula Souza");
    await fireEvent.changeText(screen.getByLabelText("Apelido"), "Aninha");
    await fireEvent.changeText(screen.getByLabelText("E-mail (opcional)"), "ana@example.com");
    await fireEvent.press(screen.getByLabelText("Salvar contato"));

    await waitFor(() => expect(client.save).toHaveBeenCalledWith({ name: "Ana Paula Souza", nickname: "Aninha", email: "ana@example.com", whatsappConsent: false }, undefined));
  });

  it("loads the contact being edited and keeps its fields editable while pending", async () => {
    const client = contactsApi(contact({ nickname: "Aninha" }));

    await render(<ContactFormScreen contactId="p1" client={client} financial={financialApi()} />);

    await waitFor(() => expect(screen.getByLabelText("Nome completo")).toHaveDisplayValue("Ana Paula Souza"));

    expect(screen.getByLabelText("Apelido")).toHaveDisplayValue("Aninha");
    expect(screen.getByLabelText("E-mail (opcional)")).toHaveDisplayValue("ana@example.com");
    expect(screen.getByLabelText("Nome completo")).toBeEnabled();
    expect(screen.getByLabelText("E-mail (opcional)")).toBeEnabled();
    expect(screen.queryByText(LINKED_NOTE)).toBeNull();

    await fireEvent.changeText(screen.getByLabelText("Apelido"), "Ana P.");
    await fireEvent.press(screen.getByLabelText("Salvar contato"));

    await waitFor(() => expect(client.save).toHaveBeenCalledWith({ name: "Ana Paula Souza", nickname: "Ana P.", email: "ana@example.com", whatsappConsent: false }, "p1"));
  });

  it("freezes the name and the e-mail of an active contact", async () => {
    const client = contactsApi(contact({ status: UserStatus.Active }));

    await render(<ContactFormScreen contactId="p1" client={client} financial={financialApi()} />);

    expect(await screen.findByText(LINKED_NOTE)).toBeOnTheScreen();
    expect(screen.getByLabelText("Nome completo")).toBeDisabled();
    expect(screen.getByLabelText("E-mail (opcional)")).toBeDisabled();
    expect(screen.getByLabelText("Apelido")).toBeEnabled();
  });

  it("blames the link, not a duplicate e-mail, when an active contact conflicts", async () => {
    const client = contactsApi(contact({ status: UserStatus.Active }));

    client.save.mockRejectedValue(new ContactsRequestError("Já existe um contato com esse e-mail.", 409));

    await render(<ContactFormScreen contactId="p1" client={client} financial={financialApi()} />);

    await screen.findByText(LINKED_NOTE);
    await fireEvent.changeText(screen.getByLabelText("Apelido"), "Aninha");
    await fireEvent.press(screen.getByLabelText("Salvar contato"));

    // Once as the standing note, once as the failure reason.
    await waitFor(() => expect(screen.getAllByText(LINKED_NOTE)).toHaveLength(2));

    expect(screen.queryByText("Já existe um contato com esse e-mail.")).toBeNull();
  });

  it("explains a taken e-mail when a pending contact conflicts on edit", async () => {
    const client = contactsApi();

    client.save.mockRejectedValue(new ContactsRequestError("Já existe um contato com esse e-mail.", 409));

    await render(<ContactFormScreen contactId="p1" client={client} financial={financialApi()} />);

    await waitFor(() => expect(screen.getByLabelText("E-mail (opcional)")).toHaveDisplayValue("ana@example.com"));
    await fireEvent.changeText(screen.getByLabelText("E-mail (opcional)"), "bruno@example.com");
    await fireEvent.press(screen.getByLabelText("Salvar contato"));

    expect(await screen.findByText("Esse e-mail já pertence a outra conta ou contato.")).toBeOnTheScreen();
  });

  it("keeps the typed data when the save fails", async () => {
    const client = contactsApi();

    client.save.mockRejectedValue(new Error("Já existe um contato com esse e-mail."));

    await render(<ContactFormScreen client={client} />);

    await fireEvent.changeText(screen.getByLabelText("Nome completo"), "Ana");
    await fireEvent.changeText(screen.getByLabelText("E-mail (opcional)"), "ana@example.com");
    await fireEvent.press(screen.getByLabelText("Salvar contato"));

    expect(await screen.findByText("Já existe um contato com esse e-mail.")).toBeOnTheScreen();
    expect(screen.getByLabelText("Nome completo")).toHaveDisplayValue("Ana");
  });

  it("files the typed Pix key under the new contact", async () => {
    const client = contactsApi();
    const financial = financialApi();

    await render(<ContactFormScreen client={client} financial={financial} />);

    expect(screen.getByText("Chave Pix (opcional)")).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByLabelText("Nome completo"), "Ana Souza");
    await fireEvent.press(screen.getByRole("radio", { name: "Celular" }));
    await fireEvent.changeText(screen.getByLabelText("Telefone celular"), "11987654321");
    await fireEvent.changeText(screen.getByLabelText("Rótulo da chave"), "Nubank");

    expect(screen.getByLabelText("Telefone celular")).toHaveDisplayValue("(11) 98765-4321");

    await fireEvent.press(screen.getByLabelText("Salvar contato"));

    await waitFor(() =>
      expect(client.save).toHaveBeenCalledWith({ name: "Ana Souza", whatsappConsent: false, paymentMethod: { provider: "pix", kind: "phone", value: "+5511987654321", label: "Nubank" } }, undefined),
    );

    expect(financial.paymentMethods).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Definir padrão")).toBeNull();
  });

  it("leaves the label out when only the key was typed", async () => {
    const client = contactsApi();

    await render(<ContactFormScreen client={client} financial={financialApi()} />);

    await fireEvent.changeText(screen.getByLabelText("Nome completo"), "Ana Souza");
    await fireEvent.changeText(screen.getByLabelText("E-mail Pix"), " Ana@Example.com ");
    await fireEvent.press(screen.getByLabelText("Salvar contato"));

    await waitFor(() => expect(client.save).toHaveBeenCalledWith({ name: "Ana Souza", whatsappConsent: false, paymentMethod: { provider: "pix", kind: "email", value: "Ana@Example.com" } }, undefined));
  });

  it("files a new key under the contact being edited", async () => {
    const client = contactsApi();

    await render(<ContactFormScreen contactId="p1" client={client} financial={financialApi([nubank])} />);

    await waitFor(() => expect(screen.getByLabelText("Nome completo")).toHaveDisplayValue("Ana Paula Souza"));

    await fireEvent.press(screen.getByRole("radio", { name: "CPF" }));
    await fireEvent.changeText(screen.getByLabelText("CPF do titular"), "52998224725");
    await fireEvent.press(screen.getByLabelText("Salvar contato"));

    await waitFor(() =>
      expect(client.save).toHaveBeenCalledWith(
        { name: "Ana Paula Souza", email: "ana@example.com", whatsappConsent: false, paymentMethod: { provider: "pix", kind: "cpf", value: "52998224725" } },
        "p1",
      ),
    );
  });

  it("lists the contact's Pix keys on edit and promotes the one the owner picks", async () => {
    const financial = financialApi([nubank, itau]);

    await render(<ContactFormScreen contactId="p1" client={contactsApi()} financial={financial} />);

    expect(await screen.findByText("Itaú")).toBeOnTheScreen();
    expect(financial.paymentMethods).toHaveBeenCalledWith("p1");
    expect(screen.getByText("Padrão")).toBeOnTheScreen();
    expect(screen.getAllByLabelText("Definir padrão")).toHaveLength(1);

    await fireEvent.press(screen.getByLabelText("Definir padrão"));

    await waitFor(() => expect(financial.defaultPaymentMethod).toHaveBeenCalledWith("pm-2"));

    expect(financial.paymentMethods).toHaveBeenCalledTimes(2);
  });

  it("archives one of the contact's keys only after the owner confirms, then reloads the list", async () => {
    const financial = financialApi([nubank, itau]);

    await render(<ContactFormScreen contactId="p1" client={contactsApi()} financial={financial} />);

    expect(await screen.findByText("Itaú")).toBeOnTheScreen();

    await fireEvent.press(screen.getAllByLabelText("Arquivar")[1]!);

    expect(screen.getByRole("header", { name: "Arquivar chave Pix?" })).toBeOnTheScreen();
    // The row and the dialog both name the key about to leave.
    expect(screen.getAllByText("529.982.247-25")).toHaveLength(2);
    expect(financial.archivePaymentMethod).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByLabelText("Arquivar chave Pix"));

    await waitFor(() => expect(financial.archivePaymentMethod).toHaveBeenCalledWith("pm-2"));

    expect(financial.paymentMethods).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("header", { name: "Arquivar chave Pix?" })).toBeNull();
  });

  it("closes the dialog and says why an archive failed", async () => {
    const financial = financialApi([nubank, itau]);

    financial.archivePaymentMethod.mockRejectedValue(new Error("Não foi possível arquivar a chave."));

    await render(<ContactFormScreen contactId="p1" client={contactsApi()} financial={financial} />);

    expect(await screen.findByText("Itaú")).toBeOnTheScreen();

    await fireEvent.press(screen.getAllByLabelText("Arquivar")[1]!);
    await fireEvent.press(screen.getByLabelText("Arquivar chave Pix"));

    expect(await screen.findByText("Não foi possível arquivar a chave.")).toBeOnTheScreen();
    expect(screen.queryByRole("header", { name: "Arquivar chave Pix?" })).toBeNull();
    expect(financial.archivePaymentMethod).toHaveBeenCalledTimes(1);
    // The list is only worth reloading when something actually changed.
    expect(financial.paymentMethods).toHaveBeenCalledTimes(1);
  });

  it("keeps the key when the archive confirmation is cancelled", async () => {
    const financial = financialApi([nubank, itau]);

    await render(<ContactFormScreen contactId="p1" client={contactsApi()} financial={financial} />);

    expect(await screen.findByText("Itaú")).toBeOnTheScreen();

    await fireEvent.press(screen.getAllByLabelText("Arquivar")[1]!);
    await fireEvent.press(screen.getByLabelText("Cancelar"));

    expect(screen.queryByRole("header", { name: "Arquivar chave Pix?" })).toBeNull();
    expect(financial.archivePaymentMethod).not.toHaveBeenCalled();
    expect(screen.getByText("Itaú")).toBeOnTheScreen();
  });

  it("never asks the API for keys while the contact does not exist yet", async () => {
    const financial = financialApi([nubank]);

    await render(<ContactFormScreen client={contactsApi()} financial={financial} />);

    await screen.findByLabelText("Salvar contato");

    expect(financial.paymentMethods).not.toHaveBeenCalled();
    expect(screen.queryByText("Nubank")).toBeNull();
    expect(screen.queryByLabelText("Arquivar")).toBeNull();
  });

  it("hands the new contact's user id to the billing draft when it came from there", async () => {
    const client = contactsApi();
    const onSaved = jest.fn();

    saveDraft(EMPTY_BILLING_DRAFT(TIMEZONE, TODAY));

    await render(<ContactFormScreen client={client} returnTo="new-billing" onSaved={onSaved} />);

    await fireEvent.changeText(screen.getByLabelText("Nome completo"), "Ana");
    await fireEvent.changeText(screen.getByLabelText("E-mail (opcional)"), "ana@example.com");
    await fireEvent.press(screen.getByLabelText("Salvar contato"));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(contact({ id: "saved", userId: "u-saved" })));

    expect(takeDraft()?.selected).toEqual(["u-saved"]);
  });

  it("leaves the billing draft alone on a plain visit", async () => {
    const client = contactsApi();
    const onSaved = jest.fn();

    saveDraft(EMPTY_BILLING_DRAFT(TIMEZONE, TODAY));

    await render(<ContactFormScreen client={client} onSaved={onSaved} />);

    await fireEvent.changeText(screen.getByLabelText("Nome completo"), "Ana");
    await fireEvent.changeText(screen.getByLabelText("E-mail (opcional)"), "ana@example.com");
    await fireEvent.press(screen.getByLabelText("Salvar contato"));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());

    expect(takeDraft()?.selected).toEqual([]);
  });

  it("saves the typed WhatsApp number and consent", async () => {
    const client = contactsApi();

    await render(<ContactFormScreen client={client} />);

    await fireEvent.changeText(screen.getByLabelText("Nome completo"), "Ana");
    await fireEvent.changeText(screen.getByLabelText("WhatsApp"), "11987654321");
    await fireEvent(screen.getByLabelText("Essa pessoa concordou em receber cobranças por WhatsApp"), "valueChange", true);
    await fireEvent.press(screen.getByLabelText("Salvar contato"));

    await waitFor(() => expect(client.save).toHaveBeenCalledWith({ name: "Ana", phone: "+5511987654321", whatsappConsent: true }, undefined));
  });

  it("freezes the WhatsApp number the person filed themselves", async () => {
    const client = contactsApi(contact({ phone: "+5511987654321", phoneSource: PhoneSource.Person }));

    await render(<ContactFormScreen contactId="p1" client={client} financial={financialApi()} />);

    const field = await screen.findByLabelText("WhatsApp");

    expect(field).toHaveDisplayValue("+5511987654321");
    expect(field).toBeDisabled();
    expect(screen.getByText("Número informado pela própria pessoa")).toBeOnTheScreen();
  });
});
