import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Share } from "react-native";
import * as Clipboard from "expo-clipboard";
import { ChargeDetailScreen } from "./charge-detail-screen";

jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn().mockResolvedValue(true) }));

describe("ChargeDetailScreen", () => {
  it("creates and explicitly selects an owned Pix before sharing", async () => {
    jest.spyOn(Share, "share").mockResolvedValue({ action: Share.sharedAction });
    const client = { charge: jest.fn().mockResolvedValue({ id: "charge", direction: "receivable", description: "Aluguel", amount: { amountCents: 2500, currency: "BRL" }, dueDate: "2026-09-10", state: "pending", recipient: { name: "Ana" }, pix: null, sharingState: "pix_required" }), cancel: jest.fn(), pay: jest.fn(), publicLink: jest.fn().mockResolvedValue({ token: "fixture" }), publicChargeUrl: jest.fn().mockReturnValue("https://receivy.example/pay/fixture"), paymentMethods: jest.fn().mockResolvedValue({ paymentMethods: [] }), savePaymentMethod: jest.fn().mockResolvedValue({ id: "method", pixKeyType: "email", pixKey: "pix@example.com", label: "Pix" }) };
    await render(<ChargeDetailScreen id="charge" client={client} />);
    await fireEvent.changeText(await screen.findByLabelText("Nova chave Pix"), "pix@example.com");
    await fireEvent.press(screen.getByRole("button", { name: "Salvar nova chave" }));
    await screen.findByText("✓ Pix · pix@example.com");
    await fireEvent.press(screen.getByRole("button", { name: "Publicar com este Pix" }));
    await waitFor(() => expect(client.publicLink).toHaveBeenCalledWith("charge", false, "method"));
    expect(client.savePaymentMethod).toHaveBeenCalledWith({ pixKeyType: "email", pixKey: "pix@example.com" });
  });
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
