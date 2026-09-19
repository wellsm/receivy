import { PlanTier, SubscriptionStatus, type PlanSummary } from "@receivy/common";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { browserFetch } from "@/lib/auth/browser-fetch";
import { PlanScreen } from "@/components/screens/plan-screen";

vi.mock("@/lib/auth/browser-fetch", () => ({ browserFetch: vi.fn() }));
vi.mock("@/lib/stripe", () => ({ stripeConfigured: () => false, stripePromise: () => null, PLAN_BASIC_PRICE_CENTS: 0 }));
vi.mock("@/components/app/plan-checkout", () => ({
  PlanCheckout: () => null,
}));

const FREE: PlanSummary = { plan: PlanTier.Free, status: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, usage: { indefinite: { used: 3, limit: 5 } }, checkoutLinks: false, card: null };
const BASIC: PlanSummary = { plan: PlanTier.Basic, status: SubscriptionStatus.Active, currentPeriodEnd: "2026-10-19T12:00:00.000Z", cancelAtPeriodEnd: false, usage: { indefinite: { used: 12, limit: 30 } }, checkoutLinks: true, card: { brand: "visa", last4: "4242" } };

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
});

it("shows the environment as unavailable and hides the subscribe button when there is no Stripe key", async () => {
  vi.mocked(browserFetch).mockImplementation(async (path) => {
    if (path === "/api/financial/plan") {
      return Response.json(FREE);
    }

    if (path === "/api/financial/plan/invoices") {
      return Response.json({ invoices: [] });
    }

    return new Response(null, { status: 204 });
  });

  render(<PlanScreen />);

  expect(await screen.findByText("Assinaturas indisponíveis neste ambiente.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Assinar o Básico" })).not.toBeInTheDocument();
});

it("keeps cancel/resume available on a paid plan without a Stripe key, but hides Trocar cartão", async () => {
  vi.mocked(browserFetch).mockImplementation(async (path) => {
    if (path === "/api/financial/plan") {
      return Response.json(BASIC);
    }

    if (path === "/api/financial/plan/invoices") {
      return Response.json({ invoices: [] });
    }

    return new Response(null, { status: 204 });
  });

  render(<PlanScreen />);

  expect(await screen.findByRole("button", { name: "Cancelar ao fim do período" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Trocar cartão" })).not.toBeInTheDocument();
});
