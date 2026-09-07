import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { ChargeDetailScreen } from "./charge-detail-screen";

vi.mock("@/lib/auth/browser-fetch", () => ({ browserFetch: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

const detail = (state: "paid" | "cancelled") => ({ id: "charge", direction: "payable", description: "Aluguel", amount: { amountCents: 2500, currency: "BRL" }, dueDate: "2026-09-10", state, source: "expense", installment: 1, installmentCount: 1, recipient: { name: "Ana", email: null }, pix: { keyType: "email", key: "pix@example.com", label: "Principal" }, payment: state === "paid" ? { id: "payment", amount: { amountCents: 2500, currency: "BRL" }, method: "pix", paidAt: "2026-09-01", createdAt: "2026-09-01" } : null, cancelledAt: state === "cancelled" ? "2026-09-01" : null, paidAt: state === "paid" ? "2026-09-01" : null, createdAt: "2026-09-01" });

describe("ChargeDetailScreen terminal guidance", () => {
  it.each([
    ["paid" as const, "Esta cobrança já foi paga. Nenhuma nova transferência é necessária."],
    ["cancelled" as const, "Esta cobrança foi cancelada e não deve ser paga."],
  ])("does not instruct a debtor to pay a %s charge", async (state, guidance) => {
    vi.mocked(browserFetch).mockResolvedValue(Response.json(detail(state)));
    render(<ChargeDetailScreen id="charge" />);
    expect(await screen.findByText(guidance)).toBeInTheDocument();
    expect(screen.queryByText(/antes de transferir|Faça o Pix|Pague usando/)).not.toBeInTheDocument();
  });
});
