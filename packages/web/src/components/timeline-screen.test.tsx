import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { TimelineScreen } from "./timeline-screen";

vi.mock("@/lib/auth/browser-fetch", () => ({ browserFetch: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("TimelineScreen", () => {
  it("renders persisted totals and explicit charge directions", async () => {
    vi.mocked(browserFetch).mockResolvedValue(Response.json({
      summary: {
        receivable: { amountCents: Number.MAX_SAFE_INTEGER, currency: "BRL" },
        payable: { amountCents: 2500, currency: "BRL" },
        overdue: { amountCents: 0, currency: "BRL" },
        pending: { amountCents: 2500, currency: "BRL" }, proofsToReview: 0,
      },
      items: [{ kind: "charge", direction: "payable", charge: {
        id: "charge-1", description: "Aluguel", amount: { amountCents: 2500, currency: "BRL" },
        dueDate: "2026-09-10", state: "pending", source: "expense", installment: 1, installmentCount: 1,
      }}], nextCursor: null,
    }));
    render(<TimelineScreen />);
    expect(await screen.findByText((_, element) => element?.textContent === "R$ 90.071.992.547.409,91")).toBeInTheDocument();
    expect(screen.getAllByText("A pagar").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /Abrir cobrança Aluguel/ })).toHaveAttribute("href", "/charges/charge-1");
  });

  it("shows the API financial overflow message without replacing it", async () => {
    vi.mocked(browserFetch).mockResolvedValue(Response.json({ message: "O total financeiro deve estar entre limites seguros." }, { status: 422 }));
    render(<TimelineScreen />);
    expect(await screen.findByRole("alert")).toHaveTextContent("O total financeiro deve estar entre limites seguros.");
  });
});
