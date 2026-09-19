import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@stripe/stripe-js", () => ({ loadStripe: vi.fn(async () => ({ id: "stripe" })) }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("stripe loader", () => {
  it("is off without a publishable key", async () => {
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "");

    const { stripeConfigured, stripePromise } = await import("./stripe");

    expect(stripeConfigured()).toBe(false);
    expect(stripePromise()).toBeNull();
  });

  it("loads Stripe.js once with the key", async () => {
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_x");

    const { loadStripe } = await import("@stripe/stripe-js");
    const { stripePromise } = await import("./stripe");

    expect(stripePromise()).toBe(stripePromise());
    expect(loadStripe).toHaveBeenCalledWith("pk_test_x", { locale: "pt-BR" });
  });

  it("reads the display price as an integer of cents", async () => {
    vi.stubEnv("NEXT_PUBLIC_PLAN_BASIC_PRICE_CENTS", "1990");

    const { PLAN_BASIC_PRICE_CENTS } = await import("./stripe");

    expect(PLAN_BASIC_PRICE_CENTS).toBe(1990);
  });
});
