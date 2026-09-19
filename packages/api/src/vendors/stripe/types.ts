import type { PlanCard, PlanInvoice, SubscriptionStatus } from '@receivy/common';

export type StripeSubscriptionState = {
  id: string;
  customerId: string;
  status: SubscriptionStatus;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

export type StripeCustomerResult = { status: 'ok'; customerId: string } | { status: 'unavailable' };
export type StripeSubscribeResult = { status: 'ok'; subscriptionId: string; clientSecret: string } | { status: 'unavailable' };
export type StripeSubscriptionResult = { status: 'ok'; subscription: StripeSubscriptionState } | { status: 'not_found' } | { status: 'unavailable' };
export type StripeSetupResult = { status: 'ok'; clientSecret: string } | { status: 'unavailable' };
export type StripeDoneResult = { status: 'ok' } | { status: 'unavailable' };
export type StripeCardResult = { status: 'ok'; card: PlanCard | null } | { status: 'unavailable' };
export type StripeInvoicesResult = { status: 'ok'; invoices: PlanInvoice[] } | { status: 'unavailable' };
export type StripeEvent = { id: string; type: string; created: string; subscriptionId: string | null };
export type StripeEventResult = { status: 'ok'; event: StripeEvent } | { status: 'invalid' };

/** Every method answers a result union; the SDK's exceptions never escape this boundary. */
export interface StripeClient {
  createCustomer(input: { ownerId: string; email?: string; name?: string }): Promise<StripeCustomerResult>;
  createSubscription(input: { customerId: string; priceId: string }): Promise<StripeSubscribeResult>;
  getSubscription(subscriptionId: string): Promise<StripeSubscriptionResult>;
  setCancelAtPeriodEnd(subscriptionId: string, cancel: boolean): Promise<StripeSubscriptionResult>;
  createSetupIntent(customerId: string): Promise<StripeSetupResult>;
  setDefaultPaymentMethod(input: { customerId: string; subscriptionId: string | null; paymentMethodId: string }): Promise<StripeDoneResult>;
  defaultCard(customerId: string): Promise<StripeCardResult>;
  listInvoices(customerId: string, limit: number): Promise<StripeInvoicesResult>;
  constructEvent(rawBody: string, signature: string | undefined, secret: string): StripeEventResult;
}
