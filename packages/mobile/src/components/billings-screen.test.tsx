import { fireEvent, render, screen } from "@testing-library/react-native";
import { BillingsScreen } from "./billings-screen";

const summary = { id: "b1", type: "indefinite" as const, description: "Internet", total: { amountCents: 10000, currency: "BRL" as const }, startDate: "2026-09-07", state: "active" as const, nextDueDate: "2026-09-30", createdAt: "2026-09-01T00:00:00Z" };
const detail = { ...summary, updatedAt: summary.createdAt, timezone: "America/Sao_Paulo", reminders: [], split: { mode: "equal" as const, parts: [{ kind: "owner" as const }] }, allocations: [], charges: [], previews: [], nextMaterialization: null };

it("ends only after confirmation and hides edit afterwards", async () => {
  const client = {
    billings: jest.fn().mockResolvedValue({ billings: [summary], nextCursor: null }),
    billing: jest.fn().mockResolvedValue(detail),
    patchBilling: jest.fn().mockResolvedValue({ ...detail, state: "ended" }),
    paymentMethods: jest.fn(),
    profile: jest.fn(),
    createBilling: jest.fn(),
  };
  await render(<BillingsScreen client={client} />);
  await fireEvent.press(await screen.findByRole("button", { name: "Abrir Internet" }));
  await fireEvent.press(await screen.findByRole("button", { name: "Encerrar" }));
  expect(client.patchBilling).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Confirmar encerramento" }));
  expect(client.patchBilling).toHaveBeenCalledWith("b1", { state: "ended" });
  expect(await screen.findByText(/Encerrada/)).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Editar" })).toBeNull();
});
