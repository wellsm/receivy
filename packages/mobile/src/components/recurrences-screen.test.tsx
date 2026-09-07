import { fireEvent, render, screen } from "@testing-library/react-native";
import { RecurrencesScreen } from "./recurrences-screen";
const people = { list: jest.fn().mockResolvedValue({ people: [{ id: "p1", name: "Ana" }], nextCursor: null }) };
function client() { return { recurrences: jest.fn().mockResolvedValue({ recurrences: [] }), paymentMethods: jest.fn().mockResolvedValue({ paymentMethods: [] }),
  recurrenceProfile: jest.fn().mockResolvedValue({ user: { timezone: "America/Sao_Paulo" } }), saveRecurrence: jest.fn(), transitionRecurrence: jest.fn() }; }
it("reviews exact cents and freezes uncertain recurrence retries", async () => {
  const api = client(); api.saveRecurrence.mockRejectedValueOnce(new Error("Resposta perdida")).mockImplementationOnce(async input => ({ ...input, id: "r1", state: "active", previews: [], nextMaterialization: null }));
  await render(<RecurrencesScreen client={api} people={people} />);
  await fireEvent.press(await screen.findByRole("button", { name: "Nova recorrência" }));
  await fireEvent.press(await screen.findByRole("checkbox", { name: "Ana" }));
  await fireEvent.changeText(screen.getByLabelText("Valor total"), "100,01");
  await fireEvent.changeText(screen.getByLabelText("Descrição"), "Internet");
  await fireEvent.press(screen.getByRole("button", { name: "Revisar recorrência" }));
  expect(await screen.findByText(/50,01/)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Salvar recorrência" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Resposta perdida");
  expect(screen.getByLabelText("Descrição")).toBeDisabled();
  await fireEvent.press(screen.getByRole("button", { name: "Tentar salvar novamente" }));
  expect(api.saveRecurrence.mock.calls[1]).toEqual(api.saveRecurrence.mock.calls[0]);
  expect(await screen.findByText("Simulação de 90 dias")).toBeOnTheScreen();
});
it("ends only after confirmation and leaves no edit or payment action", async () => {
  const api = client(); const rule = { id: "r1", description: "Internet", state: "active", totalCents: 1000, frequency: "monthly", timezone: "America/Sao_Paulo", previews: [], nextMaterialization: null };
  api.recurrences.mockResolvedValue({ recurrences: [rule] }); api.transitionRecurrence.mockResolvedValue({ ...rule, state: "ended" });
  await render(<RecurrencesScreen client={api} people={people} />);
  await fireEvent.press(await screen.findByRole("button", { name: "Abrir Internet" }));
  await fireEvent.press(screen.getByRole("button", { name: "Encerrar" }));
  expect(api.transitionRecurrence).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Confirmar encerramento" }));
  expect(await screen.findByText(/Encerrada/)).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Editar" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Pagar" })).toBeNull();
});
