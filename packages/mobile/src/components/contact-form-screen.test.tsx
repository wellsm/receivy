import { EMPTY_BILLING_DRAFT, type Person } from "@receivy/common";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { clearDraft, saveDraft, takeDraft } from "@/financial/draft-store";
import { PeopleRequestError } from "@/people/client";
import { ContactFormScreen } from "./contact-form-screen";

function person(overrides: Partial<Person> = {}): Person {
  return {
    id: "p1",
    name: "Ana Paula Souza",
    nickname: null,
    displayName: "Ana Paula Souza",
    email: null,
    phone: null,
    archivedAt: null,
    createdAt: "2026-09-01T00:00:00Z",
    hasAccount: false,
    lastBilledAt: null,
    activeCharges: 0,
    ...overrides,
  };
}

function peopleApi(loaded: Person = person()) {
  return {
    get: jest.fn().mockResolvedValue(loaded),
    save: jest.fn().mockResolvedValue(person({ id: "saved" })),
  };
}

const TIMEZONE = "America/Sao_Paulo";
const TODAY = "2026-09-10";

describe("ContactFormScreen", () => {
  afterEach(() => clearDraft());

  it("saves a contact with only the name", async () => {
    const client = peopleApi();

    await render(<ContactFormScreen client={client} />);

    await fireEvent.changeText(screen.getByLabelText("Nome completo"), "  Ana Paula Souza  ");
    await fireEvent.press(screen.getByLabelText("Salvar contato"));

    await waitFor(() => expect(client.save).toHaveBeenCalledWith({ name: "Ana Paula Souza" }, undefined));
    expect(client.get).not.toHaveBeenCalled();
  });

  it("masks the phone while typing and sends the canonical shape", async () => {
    const client = peopleApi();

    await render(<ContactFormScreen client={client} />);

    await fireEvent.changeText(screen.getByLabelText("Nome completo"), "Ana");
    await fireEvent.changeText(screen.getByLabelText("WhatsApp / Celular"), "11987654321");

    expect(screen.getByLabelText("WhatsApp / Celular")).toHaveDisplayValue("(11) 98765-4321");

    await fireEvent.press(screen.getByLabelText("Salvar contato"));

    await waitFor(() => expect(client.save).toHaveBeenCalledWith({ name: "Ana", phone: "+5511987654321" }, undefined));
  });

  it("sends the nickname the person prefers", async () => {
    const client = peopleApi();

    await render(<ContactFormScreen client={client} />);

    await fireEvent.changeText(screen.getByLabelText("Nome completo"), "Ana Paula Souza");
    await fireEvent.changeText(screen.getByLabelText("Apelido"), "Aninha");
    await fireEvent.press(screen.getByLabelText("Salvar contato"));

    await waitFor(() => expect(client.save).toHaveBeenCalledWith({ name: "Ana Paula Souza", nickname: "Aninha" }, undefined));
  });

  it("loads the contact being edited and masks its stored phone", async () => {
    const client = peopleApi(person({ nickname: "Aninha", phone: "+5511987654321", email: "ana@example.com" }));

    await render(<ContactFormScreen personId="p1" client={client} />);

    await waitFor(() => expect(screen.getByLabelText("Nome completo")).toHaveDisplayValue("Ana Paula Souza"));
    expect(screen.getByLabelText("Apelido")).toHaveDisplayValue("Aninha");
    expect(screen.getByLabelText("WhatsApp / Celular")).toHaveDisplayValue("(11) 98765-4321");
    expect(screen.getByLabelText("E-mail")).toHaveDisplayValue("ana@example.com");

    await fireEvent.changeText(screen.getByLabelText("Apelido"), "Ana P.");
    await fireEvent.press(screen.getByLabelText("Salvar contato"));

    await waitFor(() =>
      expect(client.save).toHaveBeenCalledWith(
        { name: "Ana Paula Souza", nickname: "Ana P.", email: "ana@example.com", phone: "+5511987654321" },
        "p1",
      ),
    );
  });

  it("freezes every field but the nickname on a linked contact", async () => {
    const client = peopleApi(person({ hasAccount: true, email: "ana@example.com" }));

    await render(<ContactFormScreen personId="p1" client={client} />);

    expect(await screen.findByText("Contato vinculado a uma conta: só o apelido pode mudar.")).toBeOnTheScreen();
    expect(screen.getByLabelText("Nome completo")).toBeDisabled();
    expect(screen.getByLabelText("E-mail")).toBeDisabled();
    expect(screen.getByLabelText("WhatsApp / Celular")).toBeDisabled();
    expect(screen.getByLabelText("Apelido")).toBeEnabled();
  });

  it("blames the link, not a duplicate e-mail, when a linked contact conflicts", async () => {
    const client = peopleApi(person({ hasAccount: true }));

    client.save.mockRejectedValue(new PeopleRequestError("Já existe um contato ativo com esse e-mail.", 409));

    await render(<ContactFormScreen personId="p1" client={client} />);

    await screen.findByText("Contato vinculado a uma conta: só o apelido pode mudar.");
    await fireEvent.changeText(screen.getByLabelText("Apelido"), "Aninha");
    await fireEvent.press(screen.getByLabelText("Salvar contato"));

    // Once as the standing note, once as the failure reason.
    await waitFor(() => expect(screen.getAllByText("Contato vinculado a uma conta: só o apelido pode mudar.")).toHaveLength(2));
    expect(screen.queryByText("Já existe um contato ativo com esse e-mail.")).toBeNull();
  });

  it("keeps the typed data when the save fails", async () => {
    const client = peopleApi();
    client.save.mockRejectedValue(new Error("Já existe um contato ativo com esse e-mail."));

    await render(<ContactFormScreen client={client} />);

    await fireEvent.changeText(screen.getByLabelText("Nome completo"), "Ana");
    await fireEvent.changeText(screen.getByLabelText("E-mail"), "ana@example.com");
    await fireEvent.press(screen.getByLabelText("Salvar contato"));

    expect(await screen.findByText("Já existe um contato ativo com esse e-mail.")).toBeOnTheScreen();
    expect(screen.getByLabelText("Nome completo")).toHaveDisplayValue("Ana");
  });

  it("hands the new contact to the billing draft when it came from there", async () => {
    const client = peopleApi();
    const onSaved = jest.fn();

    saveDraft(EMPTY_BILLING_DRAFT(TIMEZONE, TODAY));
    await render(<ContactFormScreen client={client} returnTo="new-billing" onSaved={onSaved} />);

    await fireEvent.changeText(screen.getByLabelText("Nome completo"), "Ana");
    await fireEvent.press(screen.getByLabelText("Salvar contato"));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(person({ id: "saved" })));
    expect(takeDraft()?.selected).toEqual(["saved"]);
  });

  it("leaves the billing draft alone on a plain visit", async () => {
    const client = peopleApi();
    const onSaved = jest.fn();

    saveDraft(EMPTY_BILLING_DRAFT(TIMEZONE, TODAY));
    await render(<ContactFormScreen client={client} onSaved={onSaved} />);

    await fireEvent.changeText(screen.getByLabelText("Nome completo"), "Ana");
    await fireEvent.press(screen.getByLabelText("Salvar contato"));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(takeDraft()?.selected).toEqual([]);
  });
});
