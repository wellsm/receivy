import { render, screen } from "@testing-library/react-native";
import { BillingRecurrence, ChargeState, type ChargeSummary, DropReason, NoticeChannel } from "@receivy/common";
import { RemindSheet } from "./remind-sheet";

function summary(overrides: Partial<ChargeSummary> = {}): ChargeSummary {
  return {
    id: "c1",
    description: "Aluguel",
    amount: { amountCents: 25_000, currency: "BRL" },
    dueDate: "2026-09-20",
    state: ChargeState.Pending,
    billingId: "b1",
    recurrence: BillingRecurrence.Once,
    installment: null,
    installmentCount: null,
    counterpartName: "Ana",
    proofState: null,
    ...overrides,
  };
}

describe("RemindSheet", () => {
  it("shows the channels from the preview and the drops with a reason", async () => {
    await render(<RemindSheet charge={summary()} today="2026-10-01" loading={false} preview={{ channels: [NoticeChannel.Push], dropped: [{ channel: NoticeChannel.Email, reason: DropReason.NoEmail }] }} onSend={jest.fn()} onClose={jest.fn()} />);

    expect(screen.getByText("Vai por: notificação no app")).toBeTruthy();
    expect(screen.getByText("E-mail: sem e-mail")).toBeTruthy();
  });

  it("disables sending when nobody is reachable", async () => {
    await render(<RemindSheet charge={summary()} today="2026-10-01" loading={false} preview={{ channels: [], dropped: [] }} onSend={jest.fn()} onClose={jest.fn()} />);

    expect(screen.getByText("Ninguém alcançável. Compartilhe o link direto.")).toBeTruthy();
    expect(screen.getByLabelText("Enviar lembrete").props.accessibilityState.disabled).toBe(true);
  });
});
