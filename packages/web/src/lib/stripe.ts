import { loadStripe, type Stripe } from "@stripe/stripe-js";

const KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";

/** Display only: the charge is whatever the Stripe price says. Zero hides the amount. */
export const PLAN_BASIC_PRICE_CENTS = Number.parseInt(process.env.NEXT_PUBLIC_PLAN_BASIC_PRICE_CENTS ?? "0", 10) || 0;

let promise: Promise<Stripe | null> | null = null;

export function stripeConfigured(): boolean {
  return KEY.length > 0;
}

/** One Stripe.js load per page; null when this environment has no key (local without Stripe, tests). */
export function stripePromise(): Promise<Stripe | null> | null {
  if (!stripeConfigured()) {
    return null;
  }

  if (!promise) {
    promise = loadStripe(KEY, { locale: "pt-BR" });
  }

  return promise;
}
