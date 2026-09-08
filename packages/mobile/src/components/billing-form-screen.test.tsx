import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { BillingDetail } from "@receivy/common";
import { FinancialRequestError } from "@/financial/client";
import { BillingFormScreen } from "./billing-form-screen";

const ana = { id: "p1", name: "Ana", email: null, phone: null, archivedAt: null, createdAt: "2026-09-01", hasAccount: false };
const people = { list: jest.fn().mockResolvedValue({ people: [ana], nextCursor: null }) };

function client(createBilling = jest.fn()) {
  return {
    paymentMethods: jest.fn().mockResolvedValue({ paymentMethods: [] }),
    profile: jest.fn().mockResolvedValue({ user: { timezone: "America/Sao_Paulo" } }),
    createBilling,
    patchBilling: jest.fn(),
  };
}

async function draft(api = client(), type: "Uma vez" | "Até uma data" | "Sem fim" = "Uma vez") {
  const onSaved = jest.fn();
  await render(<BillingFormScreen client={api} people={people} onSaved={onSaved} onBack={jest.fn()} />);
  await fireEvent.press(await screen.findByRole("radio", { name: type }));
  await fireEvent.press(await screen.findByRole("checkbox", { name: "Ana" }));
  await fireEvent.changeText(screen.getByLabelText("Valor de cada cobrança"), "100,01");
  return { api, onSaved };
}

describe("BillingFormScreen", () => {
  it("creates a once billing with exact cents and no calendar fields", async () => {
    const createBilling = jest.fn().mockResolvedValue({ id: "b1", charges: [{ id: "c1" }] });
    const { onSaved } = await draft(client(createBilling));
    await fireEvent.press(screen.getByRole("button", { name: "Revisar cobrança" }));
    expect(await screen.findByText(/50,01/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Criar cobrança" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(createBilling.mock.calls[0][0]).toMatchObject({ type: "once", totalCents: 10001, timezone: "America/Sao_Paulo" });
    expect(createBilling.mock.calls[0][0].frequency).toBeUndefined();
  });

  it("turns 'Quantas vezes' into an end date", async () => {
    const createBilling = jest.fn().mockResolvedValue({ id: "b1", charges: [] });
    await draft(client(createBilling), "Até uma data");
    await fireEvent.changeText(screen.getByLabelText("Primeiro vencimento"), "2026-01-31");
    await fireEvent.changeText(screen.getByLabelText("Quantas vezes"), "3");
    await fireEvent.press(screen.getByRole("button", { name: "Revisar cobrança" }));
    await fireEvent.press(screen.getByRole("button", { name: "Criar cobrança" }));
    await waitFor(() => expect(createBilling).toHaveBeenCalled());
    expect(createBilling.mock.calls[0][0]).toMatchObject({ type: "until", endDate: "2026-03-31" });
  });

  it("replays the frozen body and key after an uncertain result", async () => {
    const createBilling = jest.fn().mockRejectedValueOnce(new Error("A resposta não chegou.")).mockResolvedValueOnce({ id: "b1", charges: [{ id: "c1" }] });
    await draft(client(createBilling), "Sem fim");
    await fireEvent.press(screen.getByRole("button", { name: "Revisar cobrança" }));
    await fireEvent.press(screen.getByRole("button", { name: "Criar cobrança" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A resposta não chegou.");
    expect(screen.getByLabelText("Descrição")).toBeDisabled();
    await fireEvent.press(screen.getByRole("button", { name: "Tentar criar novamente" }));
    await waitFor(() => expect(createBilling).toHaveBeenCalledTimes(2));
    expect(createBilling.mock.calls[1]).toEqual(createBilling.mock.calls[0]);
  });

  it("unlocks the draft after a definitive rejection", async () => {
    const createBilling = jest.fn().mockRejectedValue(new FinancialRequestError("Contato arquivado.", 422));
    await draft(client(createBilling));
    await fireEvent.press(screen.getByRole("button", { name: "Revisar cobrança" }));
    await fireEvent.press(screen.getByRole("button", { name: "Criar cobrança" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Contato arquivado.");
    expect(screen.getByLabelText("Descrição")).toBeEnabled();
  });

  it("edits a once billing by sending only reminders and Pix, never the frozen fields", async () => {
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
      reminders: [{ offsetDays: -3, enabled: true }],
      split: { mode: "equal", parts: [{ kind: "person", personId: "p1" }] },
      allocations: [],
      charges: [],
      previews: [],
      nextMaterialization: null,
    };
    const patchBilling = jest.fn().mockResolvedValue(onceBilling);
    const api = { ...client(), patchBilling };
    await render(<BillingFormScreen client={api} people={people} billing={onceBilling} onSaved={jest.fn()} onBack={jest.fn()} />);
    await fireEvent.press(await screen.findByRole("button", { name: "Revisar cobrança" }));
    await fireEvent.press(screen.getByRole("button", { name: "Salvar cobrança" }));
    await waitFor(() => expect(patchBilling).toHaveBeenCalled());
    expect(patchBilling).toHaveBeenCalledWith("b1", { paymentMethodId: "pix-1", clearPaymentMethod: false, reminders: [{ offsetDays: -3, enabled: true }] });
  });
});
