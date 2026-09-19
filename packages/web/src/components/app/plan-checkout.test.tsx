import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { PlanCheckout } from "@/components/app/plan-checkout";

const confirmPayment = vi.fn();
const confirmSetup = vi.fn();

vi.mock("@/lib/stripe", () => ({ stripePromise: () => Promise.resolve({}), stripeConfigured: () => true, PLAN_BASIC_PRICE_CENTS: 1990 }));
vi.mock("@stripe/react-stripe-js", () => ({
  Elements: ({ children }: { children: React.ReactNode }) => <div data-testid="elements">{children}</div>,
  PaymentElement: () => <div data-testid="payment-element" />,
  useStripe: () => ({ confirmPayment, confirmSetup }),
  useElements: () => ({}),
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it("confirms a subscription without leaving the page and reports success", async () => {
  confirmPayment.mockResolvedValue({ paymentIntent: { status: "succeeded" } });

  const onDone = vi.fn();

  render(<PlanCheckout mode="subscribe" clientSecret="pi_secret" onDone={onDone} onCancel={() => undefined} />);
  await userEvent.click(screen.getByRole("button", { name: "Confirmar assinatura" }));

  expect(confirmPayment).toHaveBeenCalledWith({ elements: {}, redirect: "if_required" });
  expect(onDone).toHaveBeenCalledWith(undefined);
});

it("hands the saved payment method back after a setup", async () => {
  confirmSetup.mockResolvedValue({ setupIntent: { status: "succeeded", payment_method: "pm_1" } });

  const onDone = vi.fn();

  render(<PlanCheckout mode="setup" clientSecret="seti_secret" onDone={onDone} onCancel={() => undefined} />);
  await userEvent.click(screen.getByRole("button", { name: "Salvar cartão" }));

  expect(confirmSetup).toHaveBeenCalledWith({ elements: {}, redirect: "if_required" });
  expect(onDone).toHaveBeenCalledWith("pm_1");
});

it("shows Stripe's message on a declined card and keeps the form", async () => {
  confirmPayment.mockResolvedValue({ error: { message: "Seu cartão foi recusado." } });

  render(<PlanCheckout mode="subscribe" clientSecret="pi_secret" onDone={() => undefined} onCancel={() => undefined} />);
  await userEvent.click(screen.getByRole("button", { name: "Confirmar assinatura" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Seu cartão foi recusado.");
  expect(screen.getByTestId("payment-element")).toBeInTheDocument();
});
