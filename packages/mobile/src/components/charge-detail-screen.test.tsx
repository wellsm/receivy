import { fireEvent, render, screen } from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";
import { ChargeDetailScreen } from "./charge-detail-screen";

jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn().mockResolvedValue(true) }));

describe("ChargeDetailScreen", () => {
  it("keeps debtor finance read-only and copies the literal Pix key", async () => {
    const client = { charge: jest.fn().mockResolvedValue({ id: "charge", direction: "payable", description: "Aluguel", amount: { amountCents: 2500, currency: "BRL" }, dueDate: "2026-09-10", state: "pending", source: "expense", installment: 1, installmentCount: 1, recipient: { name: "Ana", email: null }, pix: { keyType: "email", key: "pix@example.com", label: "Principal" }, payment: null, cancelledAt: null, paidAt: null, createdAt: "2026-09-01" }), cancel: jest.fn(), pay: jest.fn(), publicLink: jest.fn(), publicChargeUrl: jest.fn() };
    await render(<ChargeDetailScreen id="charge" client={client} onBack={jest.fn()} />);
    expect(await screen.findByText("Aluguel")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Marcar como paga" })).toBeNull();
    fireEvent.press(screen.getByRole("button", { name: "Copiar chave Pix" }));
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith("pix@example.com");
  });

  it.each([
    ["paid" as const, "Esta cobrança já foi paga. Nenhuma nova transferência é necessária."],
    ["cancelled" as const, "Esta cobrança foi cancelada e não deve ser paga."],
  ])("does not instruct payment for a %s payable charge", async (state, guidance) => {
    const client = { charge: jest.fn().mockResolvedValue({ id: "charge", direction: "payable", description: "Aluguel", amount: { amountCents: 2500, currency: "BRL" }, dueDate: "2026-09-10", state, source: "expense", installment: 1, installmentCount: 1, recipient: { name: "Ana", email: null }, pix: { keyType: "email", key: "pix@example.com", label: "Principal" }, payment: null, cancelledAt: state === "cancelled" ? "2026-09-01" : null, paidAt: state === "paid" ? "2026-09-01" : null, createdAt: "2026-09-01" }), cancel: jest.fn(), pay: jest.fn(), publicLink: jest.fn(), publicChargeUrl: jest.fn() };
    await render(<ChargeDetailScreen id="charge" client={client} />);
    expect(await screen.findByText(guidance)).toBeOnTheScreen();
    expect(screen.queryByText(/antes de transferir|Pague usando/)).toBeNull();
  });
});
