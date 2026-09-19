import { SubscriptionStatus } from '@receivy/common';
import type { StripeClient, StripeSubscriptionState } from './types';

const subscriptions = new Map<string, StripeSubscriptionState>();
let sequence = 0;

/** Test-only: pretend Stripe moved a subscription (a cancel from the dashboard, a failed retry cycle). */
export function fakeStripeSetStatus(subscriptionId: string, status: SubscriptionStatus, currentPeriodEnd: string | null = null): void {
  const current = subscriptions.get(subscriptionId);

  if (current) {
    subscriptions.set(subscriptionId, { ...current, status, currentPeriodEnd });
  }
}

/**
 * Stands in for Stripe on local and test: a subscription is active the moment it is created (the web's
 * Payment Element step is skipped), a webhook is any JSON `{ id, type, created, subscriptionId }` signed
 * with the literal `fake`, and nothing ever leaves the process. Handlers are separate bundles, so the map
 * only holds what this process created; a unknown id reads as active for 30 days.
 */
export function fakeStripe(): StripeClient {
  const periodEnd = () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const stateOf = (id: string): StripeSubscriptionState => subscriptions.get(id) ?? { id, customerId: 'cus_fake', status: SubscriptionStatus.Active, currentPeriodEnd: periodEnd(), cancelAtPeriodEnd: false };

  return {
    async createCustomer(input) {
      return { status: 'ok', customerId: `cus_fake_${input.ownerId}` };
    },

    async createSubscription(input) {
      sequence += 1;

      const id = `sub_fake_${sequence}`;

      subscriptions.set(id, { id, customerId: input.customerId, status: SubscriptionStatus.Active, currentPeriodEnd: periodEnd(), cancelAtPeriodEnd: false });

      return { status: 'ok', subscriptionId: id, clientSecret: `pi_fake_${id}_secret` };
    },

    async getSubscription(id) {
      return { status: 'ok', subscription: stateOf(id) };
    },

    async setCancelAtPeriodEnd(id, cancel) {
      const next = { ...stateOf(id), cancelAtPeriodEnd: cancel };

      subscriptions.set(id, next);

      return { status: 'ok', subscription: next };
    },

    async createSetupIntent() {
      return { status: 'ok', clientSecret: 'seti_fake_secret' };
    },

    async setDefaultPaymentMethod() {
      return { status: 'ok' };
    },

    async defaultCard() {
      return { status: 'ok', card: { brand: 'visa', last4: '4242' } };
    },

    async listInvoices() {
      return { status: 'ok', invoices: [] };
    },

    constructEvent(rawBody, signature) {
      if (signature !== 'fake') {
        return { status: 'invalid' };
      }

      try {
        const parsed = JSON.parse(rawBody) as { id?: string; type?: string; created?: string; subscriptionId?: string | null };

        if (typeof parsed.id !== 'string' || typeof parsed.type !== 'string') {
          return { status: 'invalid' };
        }

        return { status: 'ok', event: { id: parsed.id, type: parsed.type, created: parsed.created ?? new Date().toISOString(), subscriptionId: parsed.subscriptionId ?? null } };
      } catch {
        return { status: 'invalid' };
      }
    }
  };
}
