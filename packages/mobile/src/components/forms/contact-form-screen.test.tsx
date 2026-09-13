import { EMPTY_BILLING_DRAFT, UserStatus, type Contact } from "@receivy/common";
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

const TIMEZONE = "America/Sao_Paulo";
const TODAY = "2026-09-10";
const LINKED_NOTE = "Contato vinculado a uma conta: só o apelido pode mudar.";

describe("ContactFormScreen", () => {
  afterEach(() => clearDraft());

  it("saves a contact with the name and the e-mail", async () => {
    const client = contactsApi();

    await render(<ContactFormScreen client={client} />);

    await fireEvent.changeText(screen.getByLabelText("Nome completo"), "  Ana Paula Souza  ");
    await fireEvent.changeText(screen.getByLabelText("E-mail"), " Ana@Example.com ");
    await fireEvent.press(screen.getByLabelText("Salvar contato"));

    await waitFor(() => expect(client.save).toHaveBeenCalledWith({ name: "Ana Paula Souza", email: "ana@example.com" }, undefined));
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

    await waitFor(() => expect(client.save).toHaveBeenCalledWith({ name: "Ana" }, undefined));
    expect(client.save.mock.calls[0]?.[0]).not.toHaveProperty("email");
  });

  it("still rejects an e-mail that does not look like an address", async () => {
    const client = contactsApi();

    await render(<ContactFormScreen client={client} />);

    await fireEvent.changeText(screen.getByLabelText("Nome completo"), "Ana");
    await fireEvent.changeText(screen.getByLabelText("E-mail"), "ana");
    await fireEvent.press(screen.getByLabelText("Salvar contato"));

    expect(await screen.findByText("Informe um e-mail válido.")).toBeOnTheScreen();
    expect(client.save).not.toHaveBeenCalled();
  });

  it("sends the nickname the person prefers", async () => {
    const client = contactsApi();

    await render(<ContactFormScreen client={client} />);

    await fireEvent.changeText(screen.getByLabelText("Nome completo"), "Ana Paula Souza");
    await fireEvent.changeText(screen.getByLabelText("Apelido"), "Aninha");
    await fireEvent.changeText(screen.getByLabelText("E-mail"), "ana@example.com");
    await fireEvent.press(screen.getByLabelText("Salvar contato"));

    await waitFor(() => expect(client.save).toHaveBeenCalledWith({ name: "Ana Paula Souza", nickname: "Aninha", email: "ana@example.com" }, undefined));
  });

  it("loads the contact being edited and keeps its fields editable while pending", async () => {
    const client = contactsApi(contact({ nickname: "Aninha" }));

    await render(<ContactFormScreen contactId="p1" client={client} />);

    await waitFor(() => expect(screen.getByLabelText("Nome completo")).toHaveDisplayValue("Ana Paula Souza"));
    expect(screen.getByLabelText("Apelido")).toHaveDisplayValue("Aninha");
    expect(screen.getByLabelText("E-mail")).toHaveDisplayValue("ana@example.com");
    expect(screen.getByLabelText("Nome completo")).toBeEnabled();
    expect(screen.getByLabelText("E-mail")).toBeEnabled();
    expect(screen.queryByText(LINKED_NOTE)).toBeNull();

    await fireEvent.changeText(screen.getByLabelText("Apelido"), "Ana P.");
    await fireEvent.press(screen.getByLabelText("Salvar contato"));

    await waitFor(() => expect(client.save).toHaveBeenCalledWith({ name: "Ana Paula Souza", nickname: "Ana P.", email: "ana@example.com" }, "p1"));
  });

  it("freezes the name and the e-mail of an active contact", async () => {
    const client = contactsApi(contact({ status: UserStatus.Active }));

    await render(<ContactFormScreen contactId="p1" client={client} />);

    expect(await screen.findByText(LINKED_NOTE)).toBeOnTheScreen();
    expect(screen.getByLabelText("Nome completo")).toBeDisabled();
    expect(screen.getByLabelText("E-mail")).toBeDisabled();
    expect(screen.getByLabelText("Apelido")).toBeEnabled();
  });

  it("blames the link, not a duplicate e-mail, when an active contact conflicts", async () => {
    const client = contactsApi(contact({ status: UserStatus.Active }));

    client.save.mockRejectedValue(new ContactsRequestError("Já existe um contato com esse e-mail.", 409));

    await render(<ContactFormScreen contactId="p1" client={client} />);

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

    await render(<ContactFormScreen contactId="p1" client={client} />);

    await waitFor(() => expect(screen.getByLabelText("E-mail")).toHaveDisplayValue("ana@example.com"));
    await fireEvent.changeText(screen.getByLabelText("E-mail"), "bruno@example.com");
    await fireEvent.press(screen.getByLabelText("Salvar contato"));

    expect(await screen.findByText("Esse e-mail já pertence a outra conta ou contato.")).toBeOnTheScreen();
  });

  it("keeps the typed data when the save fails", async () => {
    const client = contactsApi();
    client.save.mockRejectedValue(new Error("Já existe um contato com esse e-mail."));

    await render(<ContactFormScreen client={client} />);

    await fireEvent.changeText(screen.getByLabelText("Nome completo"), "Ana");
    await fireEvent.changeText(screen.getByLabelText("E-mail"), "ana@example.com");
    await fireEvent.press(screen.getByLabelText("Salvar contato"));

    expect(await screen.findByText("Já existe um contato com esse e-mail.")).toBeOnTheScreen();
    expect(screen.getByLabelText("Nome completo")).toHaveDisplayValue("Ana");
  });

  it("hands the new contact's user id to the billing draft when it came from there", async () => {
    const client = contactsApi();
    const onSaved = jest.fn();

    saveDraft(EMPTY_BILLING_DRAFT(TIMEZONE, TODAY));
    await render(<ContactFormScreen client={client} returnTo="new-billing" onSaved={onSaved} />);

    await fireEvent.changeText(screen.getByLabelText("Nome completo"), "Ana");
    await fireEvent.changeText(screen.getByLabelText("E-mail"), "ana@example.com");
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
    await fireEvent.changeText(screen.getByLabelText("E-mail"), "ana@example.com");
    await fireEvent.press(screen.getByLabelText("Salvar contato"));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(takeDraft()?.selected).toEqual([]);
  });
});
