import { PlanTier, SubscriptionStatus, type PlanSummary } from "@receivy/common";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PlanScreen } from "@/components/screens/plan-screen";

const API = "https://api.test";

vi.mock("@/lib/stripe", () => ({ stripeConfigured: () => false, stripePromise: () => null, PLAN_BASIC_PRICE_CENTS: 0 }));
vi.mock("@/components/app/plan-checkout", () => ({
  PlanCheckout: () => null,
}));

const FREE: PlanSummary = { plan: PlanTier.Free, status: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, usage: { indefinite: { used: 3, limit: 5 } }, checkoutLinks: false, card: null };
const BASIC: PlanSummary = { plan: PlanTier.Basic, status: SubscriptionStatus.Active, currentPeriodEnd: "2026-10-19T12:00:00.000Z", cancelAtPeriodEnd: false, usage: { indefinite: { used: 12, limit: 30 } }, checkoutLinks: true, card: { brand: "visa", last4: "4242" } };

function mockFetch(handler: (path: string) => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(handler));
}

beforeEach(() => {
  vi.stubEnv("VITE_API_URL", API);
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("shows the environment as unavailable and hides the subscribe button when there is no Stripe key", async () => {
  mockFetch(async (path) => {
    if (path === `${API}/plan`) {
      return Response.json(FREE);
    }

    if (path === `${API}/plan/invoices`) {
      return Response.json({ invoices: [] });
    }

    return new Response(null, { status: 204 });
  });

  render(<PlanScreen />);

  expect(await screen.findByText("Assinaturas indisponíveis neste ambiente.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Assinar o Básico" })).not.toBeInTheDocument();
});

it("keeps cancel/resume available on a paid plan without a Stripe key, but hides Trocar cartão", async () => {
  mockFetch(async (path) => {
    if (path === `${API}/plan`) {
      return Response.json(BASIC);
    }

    if (path === `${API}/plan/invoices`) {
      return Response.json({ invoices: [] });
    }

    return new Response(null, { status: 204 });
  });

  render(<PlanScreen />);

  expect(await screen.findByRole("button", { name: "Cancelar ao fim do período" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Trocar cartão" })).not.toBeInTheDocument();
});
