import { fireEvent, render, screen } from "@testing-library/react-native";

import { HomeScreen } from "./home-screen";

describe("HomeScreen", () => {
  it("shows live timeline totals and opens persisted charges", async () => {
    const client = { timeline: jest.fn().mockResolvedValue({ summary: { receivable: { amountCents: 12345, currency: "BRL" }, payable: { amountCents: 2500, currency: "BRL" }, overdue: { amountCents: 0, currency: "BRL" }, pending: { amountCents: 2500, currency: "BRL" }, proofsToReview: 0 }, items: [{ kind: "charge", direction: "payable", charge: { id: "charge", description: "Aluguel", amount: { amountCents: 2500, currency: "BRL" }, dueDate: "2026-09-10", state: "pending", source: "expense", installment: 1, installmentCount: 1 } }], nextCursor: null }) };
    const openCharge = jest.fn();
    await render(<HomeScreen client={client} onOpenCharge={openCharge} />);

    expect(
      screen.getByText("O que entra. O que sai. No mesmo lugar."),
    ).toBeOnTheScreen();
    expect(await screen.findByText(/123,45/)).toBeOnTheScreen();
    expect(screen.getByText("Aluguel")).toBeOnTheScreen();
    expect(
      screen.getByRole("button", { name: "Nova cobrança" }),
    ).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: "Abrir cobrança Aluguel" }));
    expect(openCharge).toHaveBeenCalledWith("charge");
  });
});
