import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { ChargeDetailScreen } from "./charge-detail-screen";

vi.mock("@/lib/auth/browser-fetch", () => ({ browserFetch: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

const detail = (state: "paid" | "cancelled") => ({ id: "charge", direction: "payable", description: "Aluguel", amount: { amountCents: 2500, currency: "BRL" }, dueDate: "2026-09-10", state, billingId: "b1", billingType: "once", installment: 1, installmentCount: 1, recipient: { name: "Ana", email: null }, pix: { keyType: "email", key: "pix@example.com", label: "Principal" }, payment: state === "paid" ? { id: "payment", amount: { amountCents: 2500, currency: "BRL" }, method: "pix", paidAt: "2026-09-01", createdAt: "2026-09-01" } : null, cancelledAt: state === "cancelled" ? "2026-09-01" : null, paidAt: state === "paid" ? "2026-09-01" : null, createdAt: "2026-09-01" });

describe("ChargeDetailScreen terminal guidance", () => {
  it("selects an owned Pix explicitly before first publication", async () => {
    vi.mocked(browserFetch).mockImplementation(async path => String(path).endsWith("payment-methods") ? Response.json({ paymentMethods: [{ id: "method", label: "Principal", pixKey: "pix@example.com", pixKeyType: "email" }] }) : String(path).endsWith("public-link") ? Response.json({ token: "fixture", expiresAt: "2030-01-01" }) : Response.json({ ...detail("paid"), state: "pending", direction: "receivable", pix: null, sharingState: "pix_required" }));
    render(<ChargeDetailScreen id="charge" />);
    await screen.findByRole("option", { name: "Principal · pix@example.com" });
    fireEvent.change(await screen.findByLabelText("Pix para esta cobrança"), { target: { value: "method" } });
    fireEvent.click(screen.getByRole("button", { name: "Publicar com este Pix" }));
    await waitFor(() => expect(browserFetch).toHaveBeenCalledWith("/api/financial/charges/charge/public-link", expect.objectContaining({ body: JSON.stringify({ paymentMethodId: "method" }) })));
  });
  it("shows honest manual-history guidance for a legacy published null snapshot", async () => {
    vi.mocked(browserFetch).mockResolvedValue(Response.json({ ...detail("paid"), state: "pending", direction: "receivable", pix: null, sharingState: "legacy_without_pix" }));
    render(<ChargeDetailScreen id="charge" />);
    expect(await screen.findByText(/publicada sem Pix/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Criar link" })).not.toBeInTheDocument();
  });
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
