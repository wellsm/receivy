import { PlanTier, SubscriptionStatus, type PlanSummary } from "@receivy/common";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { PlanScreen } from "@/components/screens/plan-screen";

vi.mock("@/lib/auth/browser-fetch", () => ({ browserFetch: vi.fn() }));
vi.mock("@/lib/stripe", () => ({ stripePromise: () => Promise.resolve({}), stripeConfigured: () => true, PLAN_BASIC_PRICE_CENTS: 1990 }));
vi.mock("@/components/app/plan-checkout", () => ({
  PlanCheckout: ({ mode, onDone }: { mode: string; onDone: (id?: string) => void }) => (
    <button type="button" onClick={() => onDone(mode === "setup" ? "pm_9" : undefined)}>{`checkout:${mode}`}</button>
  ),
}));

const FREE: PlanSummary = { plan: PlanTier.Free, status: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, usage: { indefinite: { used: 3, limit: 5 } }, checkoutLinks: false, card: null };
const BASIC: PlanSummary = { plan: PlanTier.Basic, status: SubscriptionStatus.Active, currentPeriodEnd: "2026-10-19T12:00:00.000Z", cancelAtPeriodEnd: false, usage: { indefinite: { used: 12, limit: 30 } }, checkoutLinks: true, card: { brand: "visa", last4: "4242" } };

function api(summaries: PlanSummary[]) {
  const sent: { path: string; init?: RequestInit }[] = [];
  let reads = 0;

  vi.mocked(browserFetch).mockImplementation(async (path, init) => {
    sent.push({ path, init });

    if (path === "/api/financial/plan" && !init?.method) {
      const summary = summaries[Math.min(reads, summaries.length - 1)]!;

      reads += 1;

      return Response.json(summary);
    }

    if (path === "/api/financial/plan/invoices") {
      return Response.json({
        invoices: [
          { id: "in_1", amountCents: 1990, status: "paid", paidAt: "2026-09-19T12:00:00.000Z", pdfUrl: "https://stripe.example/in_1.pdf" },
          { id: "in_2", amountCents: 1990, status: "open", paidAt: null, pdfUrl: null },
        ],
      });
    }

    if (path === "/api/financial/plan/subscribe" || path === "/api/financial/plan/payment-method") {
      return Response.json({ clientSecret: "secret" });
    }

    return new Response(null, { status: 204 });
  });

  return sent;
}

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
});

it("describes the free plan with its usage and a subscribe button", async () => {
  api([FREE]);
  render(<PlanScreen />);

  expect(await screen.findByText("Grátis")).toBeInTheDocument();
  expect(screen.getByText("3 de 5 cobranças indefinidas")).toBeInTheDocument();
  expect(screen.getByText("R$ 19,90/mês")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Assinar o Básico" })).toBeInTheDocument();
});

it("subscribes inline and polls until the plan turns basic", async () => {
  const sent = api([FREE, FREE, BASIC]);

  render(<PlanScreen />);

  await userEvent.click(await screen.findByRole("button", { name: "Assinar o Básico" }));
  await userEvent.click(await screen.findByRole("button", { name: "checkout:subscribe" }));

  expect(await screen.findByText("Confirmando pagamento…")).toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(4_100); });

  expect(await screen.findByText("Plano Básico ativo")).toBeInTheDocument();
  expect(sent.some(({ path, init }) => path === "/api/financial/plan/subscribe" && init?.method === "POST")).toBe(true);
});

it("shows the paid plan with card, renewal, invoices, cancel and card change", async () => {
  const sent = api([BASIC]);

  render(<PlanScreen />);

  expect(await screen.findByText("Básico")).toBeInTheDocument();
  expect(screen.getByText("visa •••• 4242")).toBeInTheDocument();
  expect(screen.getByText(/Renova em/)).toBeInTheDocument();
  expect(await screen.findByRole("link", { name: "PDF" })).toHaveAttribute("href", "https://stripe.example/in_1.pdf");
  expect(screen.getByText("Em aberto")).toBeInTheDocument();
  expect(screen.queryByText("open")).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Cancelar ao fim do período" }));
  expect(sent.some(({ path, init }) => path === "/api/financial/plan/cancel" && init?.method === "POST")).toBe(true);

  await userEvent.click(screen.getByRole("button", { name: "Trocar cartão" }));
  await userEvent.click(await screen.findByRole("button", { name: "checkout:setup" }));
  expect(sent.some(({ path, init }) => path === "/api/financial/plan/payment-method/confirm" && init?.body === JSON.stringify({ paymentMethodId: "pm_9" }))).toBe(true);
});

it("offers Retomar when the cancel is scheduled", async () => {
  api([{ ...BASIC, cancelAtPeriodEnd: true }]);
  render(<PlanScreen />);

  expect(await screen.findByText(/Cancela em/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Retomar" })).toBeInTheDocument();
});

it("keeps the subscribe button hidden and shows a persistent message when the poll limit runs out", async () => {
  api([FREE]);
  render(<PlanScreen />);

  await userEvent.click(await screen.findByRole("button", { name: "Assinar o Básico" }));
  await userEvent.click(await screen.findByRole("button", { name: "checkout:subscribe" }));

  expect(await screen.findByText("Confirmando pagamento…")).toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(30_100); });

  expect(await screen.findByText("Ainda confirmando o pagamento. Recarregue a página em instantes ou confira seu e-mail.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Assinar o Básico" })).not.toBeInTheDocument();
});
