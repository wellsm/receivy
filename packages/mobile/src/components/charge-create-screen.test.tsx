import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import { ChargeCreateScreen } from "./charge-create-screen";
import { FinancialRequestError } from "@/financial/client";

const ana = { id: "person-1", name: "Ana", email: "ana@example.com", phone: null, archivedAt: null, createdAt: "2026-09-01" };
const zelia = { id: "person-51", name: "Zélia", email: "zelia@example.com", phone: null, archivedAt: null, createdAt: "2026-09-01" };

function client(createExpense = jest.fn()) {
  return { paymentMethods: jest.fn().mockResolvedValue({ paymentMethods: [] }), createExpense };
}

describe("ChargeCreateScreen", () => {
  it("replays the frozen body and key after an uncertain result", async () => {
    const createExpense = jest.fn().mockRejectedValueOnce(new Error("A resposta não chegou.")).mockResolvedValueOnce({ charges: [{ id: "charge-1" }] });
    await render(<ChargeCreateScreen client={client(createExpense)} people={{ list: jest.fn().mockResolvedValue({ people: [ana], nextCursor: null }) }} />);
    await fireEvent.press(await screen.findByRole("checkbox", { name: "Ana" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Ana" })).toBeChecked());
    await fireEvent.changeText(screen.getByLabelText("Valor total"), "100,00");
    await fireEvent.changeText(screen.getByLabelText("Descrição"), "Mercado");
    await waitFor(() => expect(screen.getByLabelText("Descrição")).toHaveDisplayValue("Mercado"));
    await fireEvent.press(screen.getByRole("button", { name: "Revisar cobrança" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Criar cobrança" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A resposta não chegou.");
    expect(screen.getByLabelText("Descrição")).toBeDisabled();
    expect(screen.getByLabelText("Quantidade de parcelas")).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText("Descrição"), "Mercado alterado");
    await fireEvent.changeText(screen.getByLabelText("Quantidade de parcelas"), "4");
    expect(screen.getByLabelText("Quantidade de parcelas")).toHaveDisplayValue("1");
    await fireEvent.press(screen.getByRole("button", { name: "Tentar criar novamente" }));
    expect(createExpense).toHaveBeenCalledTimes(2);
    expect(createExpense.mock.calls[1]).toEqual(createExpense.mock.calls[0]);
  });

  it("loads a later contacts page without losing the earlier selection", async () => {
    const list = jest.fn().mockResolvedValueOnce({ people: [ana], nextCursor: "page-2" }).mockResolvedValueOnce({ people: [zelia], nextCursor: null });
    await render(<ChargeCreateScreen client={client()} people={{ list }} />);
    await fireEvent.press(await screen.findByRole("checkbox", { name: "Ana" }));
    await fireEvent.press(screen.getByRole("button", { name: "Carregar mais contatos" }));
    expect(await screen.findByRole("checkbox", { name: "Zélia" })).toBeOnTheScreen();
    expect(screen.getByRole("checkbox", { name: "Ana" })).toBeChecked();
    expect(list).toHaveBeenLastCalledWith(false, "page-2");
  });

  it("shows each exact installment amount including residual cents", async () => {
    await render(<ChargeCreateScreen client={client()} people={{ list: jest.fn().mockResolvedValue({ people: [ana], nextCursor: null }) }} />);
    await fireEvent.press(await screen.findByRole("checkbox", { name: "Ana" }));
    await fireEvent.changeText(screen.getByLabelText("Valor total"), "100,01");
    await fireEvent.changeText(screen.getByLabelText("Quantidade de parcelas"), "3");
    await waitFor(() => expect(screen.getByLabelText("Quantidade de parcelas")).toHaveDisplayValue("3"));
    await fireEvent.press(screen.getByRole("button", { name: "Revisar cobrança" }));
    expect(screen.getByText("R$ 16,67 · R$ 16,67 · R$ 16,66")).toBeOnTheScreen();
  });

  it("unlocks the draft after a definitive API rejection", async () => {
    const createExpense = jest.fn().mockRejectedValue(new FinancialRequestError("Contato arquivado.", 422));
    await render(<ChargeCreateScreen client={client(createExpense)} people={{ list: jest.fn().mockResolvedValue({ people: [ana], nextCursor: null }) }} />);
    await fireEvent.press(await screen.findByRole("checkbox", { name: "Ana" }));
    await fireEvent.changeText(screen.getByLabelText("Valor total"), "10,00");
    await fireEvent.press(screen.getByRole("button", { name: "Revisar cobrança" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Criar cobrança" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Contato arquivado.");
    expect(screen.getByLabelText("Descrição")).not.toBeDisabled();
    expect(screen.queryByRole("button", { name: "Tentar criar novamente" })).toBeNull();
  });

  it("accepts pt-BR percentage input without rounding excess precision", async () => {
    await render(<ChargeCreateScreen client={client()} people={{ list: jest.fn().mockResolvedValue({ people: [ana], nextCursor: null }) }} />);
    await fireEvent.press(await screen.findByRole("checkbox", { name: "Ana" }));
    await fireEvent.changeText(screen.getByLabelText("Valor total"), "100,00");
    await fireEvent.press(screen.getByRole("button", { name: "Percentuais" }));
    await fireEvent.changeText(screen.getByLabelText("Percentual de Ana"), "33,333");
    await fireEvent.changeText(screen.getByLabelText("Percentual de Minha parte"), "66,667");
    await fireEvent.press(screen.getByRole("button", { name: "Revisar cobrança" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Confira valor/);
    await fireEvent.changeText(screen.getByLabelText("Percentual de Ana"), "33,33");
    await fireEvent.changeText(screen.getByLabelText("Percentual de Minha parte"), "66,67");
    await fireEvent.press(screen.getByRole("button", { name: "Revisar cobrança" }));
    expect(await screen.findByText("Revisão exata")).toBeOnTheScreen();
  });

  it.each([401, 429])("retains an uncertain attempt through replay status %s", async status => {
    let rejectReplay!: (reason: unknown) => void;
    const replay = new Promise<never>((_, reject) => { rejectReplay = reject; });
    const createExpense = jest.fn().mockRejectedValueOnce(new Error("Resposta perdida.")).mockImplementationOnce(() => replay).mockResolvedValueOnce({ charges: [{ id: "charge-1" }] });
    const onCreated = jest.fn();
    await render(<ChargeCreateScreen client={client(createExpense)} people={{ list: jest.fn().mockResolvedValue({ people: [ana], nextCursor: null }) }} onCreated={onCreated} />);
    await fireEvent.press(await screen.findByRole("checkbox", { name: "Ana" }));
    await fireEvent.changeText(screen.getByLabelText("Valor total"), "10,00");
    await fireEvent.changeText(screen.getByLabelText("Descrição"), "Original");
    await fireEvent.press(screen.getByRole("button", { name: "Revisar cobrança" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Criar cobrança" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Tentar criar novamente" }));
    expect(screen.getByLabelText("Descrição")).toBeDisabled();
    await act(async () => { rejectReplay(new FinancialRequestError("Reautentique ou aguarde.", status)); await Promise.resolve(); });
    expect(await screen.findByRole("alert")).toHaveTextContent("Reautentique ou aguarde.");
    expect(screen.getByLabelText("Descrição")).toBeDisabled();
    await fireEvent.press(screen.getByRole("button", { name: "Tentar criar novamente" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("charge-1"));
    expect(createExpense).toHaveBeenCalledTimes(3);
    expect(createExpense.mock.calls[2]).toEqual(createExpense.mock.calls[0]);
  });
});
