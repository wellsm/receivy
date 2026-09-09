import { EMPTY_BILLING_DRAFT, type BillingDetail, type Person } from "@receivy/common";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { FinancialRequestError } from "@/financial/client";
import { clearDraft, saveDraft, takeDraft } from "@/financial/draft-store";
import { BillingFormScreen } from "./billing-form-screen";

let mockKeys = 0;

jest.mock("expo-crypto", () => ({ randomUUID: () => `key-${++mockKeys}` }));

function person(id: string, name: string, lastBilledAt: string | null = null): Person {
  return { id, name, email: null, phone: null, archivedAt: null, createdAt: "2026-09-01T00:00:00Z", hasAccount: false, lastBilledAt };
}

const ana = person("p1", "Ana", "2026-09-07T12:00:00Z");
const bruno = person("p2", "Bruno");

function peopleApi(pages: { people: Person[]; nextCursor: string | null }[] = [{ people: [ana, bruno], nextCursor: null }]) {
  const list = jest.fn();

  for (const page of pages) {
    list.mockResolvedValueOnce(page);
  }

  list.mockResolvedValue(pages.at(-1) ?? { people: [], nextCursor: null });

  return { list };
}

function financialApi(overrides: Record<string, unknown> = {}) {
  return {
    paymentMethods: jest.fn().mockResolvedValue({ paymentMethods: [] }),
    profile: jest.fn().mockResolvedValue({ user: { timezone: "America/Sao_Paulo" } }),
    createBilling: jest.fn().mockResolvedValue({ id: "b1", charges: [{ id: "c1" }] }),
    patchBilling: jest.fn(),
    ...overrides,
  };
}

async function quickForm(client = financialApi(), people = peopleApi(), props: Record<string, unknown> = {}) {
  const onSaved = jest.fn();

  await render(<BillingFormScreen client={client as never} people={people} onSaved={onSaved} onBack={jest.fn()} {...props} />);
  await screen.findByRole("button", { name: "Ana" });

  return { client, people, onSaved };
}

async function fillQuickBilling() {
  await fireEvent.press(screen.getByRole("button", { name: "Ana" }));
  await fireEvent.changeText(screen.getByLabelText("Valor"), "100,00");
  await fireEvent.changeText(screen.getByLabelText("Descrição"), "Mercado QA");
}

const onceBilling: BillingDetail = {
  id: "b1",
  type: "once",
  description: "Jantar",
  total: { amountCents: 9_000, currency: "BRL" },
  startDate: "2026-10-31",
  state: "active",
  nextDueDate: "2026-10-31",
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
  timezone: "America/Sao_Paulo",
  paymentMethodId: "pix-1",
  reminders: [{ offsetDays: 0, enabled: true }],
  split: { mode: "equal", parts: [{ kind: "person", personId: "p1" }] },
  allocations: [],
  charges: [],
  previews: [],
  nextMaterialization: null,
  category: "food",
  invite: null,
};

describe("BillingFormScreen", () => {
  afterEach(() => clearDraft());

  it("asks the agenda for the most recent contacts and shows the last billing hint", async () => {
    const { people } = await quickForm();

    expect(people.list).toHaveBeenCalledWith(false, undefined, undefined, "recent");
    expect(screen.getByRole("button", { name: "Ana" })).not.toBeSelected();
    expect(screen.getByText("Ontem")).toBeOnTheScreen();
    expect(screen.getByText("Sem cobranças")).toBeOnTheScreen();
  });

  it("creates a billing straight from the quick form, with category and no review step", async () => {
    const { client, onSaved } = await quickForm();

    await fillQuickBilling();
    await fireEvent.press(screen.getByRole("button", { name: "Mercado" }));
    expect(screen.queryByRole("button", { name: "Revisar cobrança" })).toBeNull();

    await fireEvent.press(screen.getByRole("button", { name: "Criar cobrança" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ id: "b1", charges: [{ id: "c1" }] }));

    expect(client.createBilling.mock.calls[0][0]).toMatchObject({
      type: "once",
      totalCents: 10_000,
      description: "Mercado QA",
      category: "groceries",
      timezone: "America/Sao_Paulo",
      split: { mode: "equal", parts: [{ kind: "person", personId: "p1" }, { kind: "owner" }] },
    });
    expect(client.createBilling.mock.calls[0][1]).toEqual(expect.any(String));
  });

  it("sends whole shares when the split is by cotas", async () => {
    const { client } = await quickForm();

    await fillQuickBilling();
    await fireEvent.press(screen.getByRole("button", { name: "Cotas" }));
    await fireEvent.changeText(screen.getByLabelText("Cotas de Ana"), "3");
    expect(screen.getByText("3 cotas · R$ 75,00")).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("button", { name: "Criar cobrança" }));
    await waitFor(() => expect(client.createBilling).toHaveBeenCalled());

    expect(client.createBilling.mock.calls[0][0].split).toEqual({
      mode: "shares",
      parts: [{ kind: "person", personId: "p1", shares: 3 }, { kind: "owner", shares: 1 }],
    });
  });

  it("summarises the split in the fixed footer", async () => {
    await quickForm();
    await fillQuickBilling();

    expect(screen.getByText("2 pessoas · R$ 50,00 cada · vence hoje")).toBeOnTheScreen();
  });

  it("warns about the missing remainder of a fixed split", async () => {
    await quickForm();
    await fillQuickBilling();
    await fireEvent.press(screen.getByRole("button", { name: "Valor fixo" }));
    await fireEvent.changeText(screen.getByLabelText("Valor de Ana"), "40,00");

    expect(screen.getByText("Faltam R$ 60,00")).toBeOnTheScreen();
  });

  it("drops the owner from the split when I do not take part", async () => {
    const { client } = await quickForm();

    await fillQuickBilling();
    await fireEvent(screen.getByLabelText("Eu também participo"), "valueChange", false);
    await fireEvent.press(screen.getByRole("button", { name: "Criar cobrança" }));
    await waitFor(() => expect(client.createBilling).toHaveBeenCalled());

    expect(client.createBilling.mock.calls[0][0].split.parts).toEqual([{ kind: "person", personId: "p1" }]);
  });

  it("turns the parcel count into an end date", async () => {
    const { client } = await quickForm();

    await fillQuickBilling();
    await fireEvent.press(screen.getByRole("button", { name: "Parcelado" }));
    await fireEvent.changeText(screen.getByLabelText("Vencimento"), "2026-01-31");
    await fireEvent.changeText(screen.getByLabelText("Parcelas"), "3");
    await fireEvent.press(screen.getByRole("button", { name: "Criar cobrança" }));
    await waitFor(() => expect(client.createBilling).toHaveBeenCalled());

    expect(client.createBilling.mock.calls[0][0]).toMatchObject({ type: "until", endDate: "2026-03-31" });
  });

  it("moves the due date with the quick buttons", async () => {
    const { client } = await quickForm();

    await fillQuickBilling();
    await fireEvent.press(screen.getByRole("button", { name: "Em 7 dias" }));
    await fireEvent.press(screen.getByRole("button", { name: "Criar cobrança" }));
    await waitFor(() => expect(client.createBilling).toHaveBeenCalled());

    const start = client.createBilling.mock.calls[0][0].startDate as string;

    expect(screen.getByLabelText("Vencimento")).toHaveDisplayValue(start);
  });

  it("adds the quick amounts to the typed value", async () => {
    await quickForm();
    await fireEvent.changeText(screen.getByLabelText("Valor"), "85,00");
    await fireEvent.press(screen.getByRole("button", { name: "+ R$ 10" }));

    expect(screen.getByLabelText("Valor")).toHaveDisplayValue("95,00");
  });

  it("fills an empty description with the category label", async () => {
    await quickForm();
    await fireEvent.press(screen.getByRole("button", { name: "Transporte" }));

    expect(screen.getByLabelText("Descrição")).toHaveDisplayValue("Transporte");
  });

  it("explains inline what is missing instead of sending a broken billing", async () => {
    const { client } = await quickForm();

    await fireEvent.press(screen.getByRole("button", { name: "Criar cobrança" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Selecione ao menos um contato.");
    expect(client.createBilling).not.toHaveBeenCalled();
  });

  it("picks extra contacts from the full agenda sheet", async () => {
    const list = jest.fn(async (_archived: boolean, cursor?: string, search?: string, sort?: "recent") => {
      if (sort === "recent") {
        return { people: [ana, bruno], nextCursor: null };
      }

      if (cursor) {
        return { people: [person("p3", "Carla")], nextCursor: null };
      }

      return search === "Bru" ? { people: [bruno], nextCursor: "c1" } : { people: [ana, bruno], nextCursor: null };
    });
    const people = { list };
    const { client } = await quickForm(financialApi(), people);

    await fireEvent.press(screen.getByRole("button", { name: "Ver todos" }));
    await fireEvent.changeText(await screen.findByLabelText("Buscar contatos"), "Bru");
    await waitFor(() => expect(people.list).toHaveBeenCalledWith(false, undefined, "Bru"));

    await fireEvent.press(await screen.findByRole("checkbox", { name: "Bruno" }));
    expect(screen.getByRole("checkbox", { name: "Bruno" })).toBeChecked();

    await fireEvent.press(screen.getByRole("button", { name: "Carregar mais" }));
    expect(await screen.findByRole("checkbox", { name: "Carla" })).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("button", { name: "Concluir" }));
    await waitFor(() => expect(screen.queryByLabelText("Buscar contatos")).toBeNull());

    await fireEvent.changeText(screen.getByLabelText("Valor"), "100,00");
    await fireEvent.changeText(screen.getByLabelText("Descrição"), "Mercado QA");
    await fireEvent.press(screen.getByRole("button", { name: "Criar cobrança" }));
    await waitFor(() => expect(client.createBilling).toHaveBeenCalled());

    expect(client.createBilling.mock.calls[0][0].split.parts).toEqual([{ kind: "person", personId: "p2" }, { kind: "owner" }]);
  });

  it("parks the draft before leaving to register a contact", async () => {
    const onCreateContact = jest.fn();

    await quickForm(financialApi(), peopleApi(), { onCreateContact });
    await fireEvent.changeText(screen.getByLabelText("Valor"), "85,00");
    await fireEvent.press(screen.getByRole("button", { name: "Novo contato" }));

    expect(onCreateContact).toHaveBeenCalled();
    expect(takeDraft()).toMatchObject({ amount: "85,00" });
  });

  it("parks the draft before leaving to register a Pix key", async () => {
    const onCreatePix = jest.fn();

    await quickForm(financialApi(), peopleApi(), { onCreatePix });
    await fireEvent.changeText(screen.getByLabelText("Valor"), "85,00");
    await fireEvent.press(screen.getByRole("button", { name: "Cadastrar chave" }));

    expect(onCreatePix).toHaveBeenCalled();
    expect(takeDraft()).toMatchObject({ amount: "85,00" });
  });

  it("hides the side trips when the screen cannot navigate", async () => {
    await quickForm();

    expect(screen.queryByRole("button", { name: "Novo contato" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cadastrar chave" })).toBeNull();
  });

  it("restores the draft a side trip came back with", async () => {
    saveDraft({ ...EMPTY_BILLING_DRAFT("America/Sao_Paulo", "2026-09-08"), selected: ["p1"], amount: "85,00", pix: "pix-1" });

    const client = financialApi({
      paymentMethods: jest.fn().mockResolvedValue({ paymentMethods: [{ id: "pix-2", label: "Nubank", pixKey: "a@b.com", isDefault: true, archivedAt: null }] }),
    });

    await quickForm(client, peopleApi(), { onCreateContact: jest.fn(), onCreatePix: jest.fn() });

    expect(screen.getByLabelText("Valor")).toHaveDisplayValue("85,00");
    expect(screen.getByRole("button", { name: "Ana" })).toBeSelected();
    expect(client.profile).not.toHaveBeenCalled();
    expect(takeDraft()).toBeNull();
  });

  it("preselects the default Pix key for a fresh billing", async () => {
    const client = financialApi({
      paymentMethods: jest.fn().mockResolvedValue({ paymentMethods: [{ id: "pix-2", label: "Nubank", pixKey: "ana@example.com", isDefault: true, archivedAt: null }] }),
    });

    await quickForm(client);
    await fillQuickBilling();
    await fireEvent.press(screen.getByRole("button", { name: "Criar cobrança" }));
    await waitFor(() => expect(client.createBilling).toHaveBeenCalled());

    expect(client.createBilling.mock.calls[0][0].paymentMethodId).toBe("pix-2");
  });

  it("replays the frozen body and key after an uncertain result", async () => {
    const createBilling = jest
      .fn()
      .mockRejectedValueOnce(new Error("A resposta não chegou."))
      .mockResolvedValueOnce({ id: "b1", charges: [{ id: "c1" }] });
    const { client } = await quickForm(financialApi({ createBilling }));

    await fillQuickBilling();
    await fireEvent.press(screen.getByRole("button", { name: "Criar cobrança" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("A resposta não chegou.");
    expect(screen.getByLabelText("Descrição")).toBeDisabled();

    await fireEvent.press(screen.getByRole("button", { name: "Tentar criar novamente" }));
    await waitFor(() => expect(client.createBilling).toHaveBeenCalledTimes(2));

    expect(client.createBilling.mock.calls[1]).toEqual(client.createBilling.mock.calls[0]);
  });

  it("unlocks the draft after a definitive rejection", async () => {
    const createBilling = jest.fn().mockRejectedValue(new FinancialRequestError("Contato arquivado.", 422));

    await quickForm(financialApi({ createBilling }));
    await fillQuickBilling();
    await fireEvent.press(screen.getByRole("button", { name: "Criar cobrança" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Contato arquivado.");
    expect(screen.getByLabelText("Descrição")).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Tentar criar novamente" })).toBeNull();
  });

  it("edits a finite billing by sending only category, Pix and reminders", async () => {
    const patchBilling = jest.fn().mockResolvedValue(onceBilling);
    const client = financialApi({ patchBilling });
    const onSaved = jest.fn();

    await render(<BillingFormScreen client={client as never} people={peopleApi()} billing={onceBilling} onSaved={onSaved} onBack={jest.fn()} />);
    await screen.findByText("Editar cobrança");
    expect(screen.getByText("Cobranças já geradas só permitem categoria, Pix e lembretes.")).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("button", { name: "Transporte" }));
    await fireEvent.press(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(patchBilling).toHaveBeenCalled());

    expect(patchBilling).toHaveBeenCalledWith("b1", {
      paymentMethodId: "pix-1",
      clearPaymentMethod: false,
      reminders: [{ offsetDays: 0, enabled: true }],
      category: "transport",
    });
    expect(client.createBilling).not.toHaveBeenCalled();
  });

  it("keeps the schedule read-only on every edit", async () => {
    await render(<BillingFormScreen client={financialApi() as never} people={peopleApi()} billing={onceBilling} onSaved={jest.fn()} onBack={jest.fn()} />);
    await screen.findByText("Editar cobrança");

    expect(screen.getByLabelText("Vencimento")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Parcelado" })).toBeDisabled();
  });
});
