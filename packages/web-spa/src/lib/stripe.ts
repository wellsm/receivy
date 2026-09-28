import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { readEnv } from "@/lib/env";

/** Display only: the charge is whatever the Stripe price says. Zero hides the amount. */
export const PLAN_BASIC_PRICE_CENTS = readEnv().planBasicPriceCents ?? 0;

let promise: Promise<Stripe | null> | null = null;

export function stripeConfigured(): boolean {
  return readEnv().stripePublishableKey.length > 0;
}

/** One Stripe.js load per page; null when this environment has no key (local without Stripe, tests). */
export function stripePromise(): Promise<Stripe | null> | null {
  if (!stripeConfigured()) {
    return null;
  }

  if (!promise) {
    promise = loadStripe(readEnv().stripePublishableKey, { locale: "pt-BR" });
  }

  return promise;
}
