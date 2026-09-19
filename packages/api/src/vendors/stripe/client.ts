import { SubscriptionStatus } from '@receivy/common';
import Stripe from 'stripe';
import type { StripeCardResult, StripeClient, StripeCustomerResult, StripeDoneResult, StripeEventResult, StripeInvoicesResult, StripeResumeResult, StripeSetupResult, StripeSubscribeResult, StripeSubscriptionResult, StripeSubscriptionState } from './types';

/** Stripe's own states collapsed to the plan's: anything unpaid still counts as the paid period until it ends. */
function statusOf(status: string): SubscriptionStatus {
  if (status === 'active') {
    return SubscriptionStatus.Active;
  }

  if (status === 'past_due' || status === 'unpaid') {
    return SubscriptionStatus.PastDue;
  }

  if (status === 'canceled' || status === 'incomplete_expired') {
    return SubscriptionStatus.Canceled;
  }

  return SubscriptionStatus.Incomplete;
}

function isoOf(seconds: number | null | undefined): string | null {
  return typeof seconds === 'number' ? new Date(seconds * 1000).toISOString() : null;
}

function stateOf(subscription: Stripe.Subscription): StripeSubscriptionState {
  const customer = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;

  return {
    id: subscription.id,
    customerId: customer,
    status: statusOf(subscription.status),
    currentPeriodEnd: isoOf(subscription.items.data[0]?.current_period_end),
    cancelAtPeriodEnd: subscription.cancel_at_period_end
  };
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'resource_missing';
}

/** The secret key only lives inside the SDK instance; errors never carry Stripe bodies into logs. */
// `subscribe` calls this while holding the owner's row lock: the SDK's 80s default timeout would hold it far too long.
export function createStripeClient(secretKey: string, sdk: Stripe = new Stripe(secretKey, { timeout: 10_000, maxNetworkRetries: 1 })): StripeClient {
  return {
    async createCustomer(input): Promise<StripeCustomerResult> {
      try {
        const customer = await sdk.customers.create({ ...(input.email ? { email: input.email } : {}), ...(input.name ? { name: input.name } : {}), metadata: { ownerId: input.ownerId } });

        return { status: 'ok', customerId: customer.id };
      } catch {
        return { status: 'unavailable' };
      }
    },

    async createSubscription(input): Promise<StripeSubscribeResult> {
      try {
        const subscription = await sdk.subscriptions.create({
          customer: input.customerId,
          items: [{ price: input.priceId }],
          payment_behavior: 'default_incomplete',
          payment_settings: { save_default_payment_method: 'on_subscription' },
          expand: ['latest_invoice.confirmation_secret']
        });
        const invoice = subscription.latest_invoice;
        const clientSecret = invoice && typeof invoice !== 'string' ? invoice.confirmation_secret?.client_secret : undefined;

        if (!clientSecret) {
          return { status: 'unavailable' };
        }

        return { status: 'ok', subscriptionId: subscription.id, clientSecret };
      } catch {
        return { status: 'unavailable' };
      }
    },

    async resumeSubscription(subscriptionId): Promise<StripeResumeResult> {
      try {
        const subscription = await sdk.subscriptions.retrieve(subscriptionId, { expand: ['latest_invoice.confirmation_secret'] });

        if (subscription.status !== 'incomplete') {
          return { status: 'expired' };
        }

        const invoice = subscription.latest_invoice;
        const clientSecret = invoice && typeof invoice !== 'string' ? invoice.confirmation_secret?.client_secret : undefined;

        return clientSecret ? { status: 'ok', clientSecret } : { status: 'unavailable' };
      } catch {
        return { status: 'unavailable' };
      }
    },

    async getSubscription(subscriptionId): Promise<StripeSubscriptionResult> {
      try {
        return { status: 'ok', subscription: stateOf(await sdk.subscriptions.retrieve(subscriptionId)) };
      } catch (error) {
        return isMissing(error) ? { status: 'not_found' } : { status: 'unavailable' };
      }
    },

    async setCancelAtPeriodEnd(subscriptionId, cancel): Promise<StripeSubscriptionResult> {
      try {
        return { status: 'ok', subscription: stateOf(await sdk.subscriptions.update(subscriptionId, { cancel_at_period_end: cancel })) };
      } catch (error) {
        return isMissing(error) ? { status: 'not_found' } : { status: 'unavailable' };
      }
    },

    async createSetupIntent(customerId): Promise<StripeSetupResult> {
      try {
        const intent = await sdk.setupIntents.create({ customer: customerId, usage: 'off_session', automatic_payment_methods: { enabled: true, allow_redirects: 'never' } });

        return intent.client_secret ? { status: 'ok', clientSecret: intent.client_secret } : { status: 'unavailable' };
      } catch {
        return { status: 'unavailable' };
      }
    },

    async setDefaultPaymentMethod(input): Promise<StripeDoneResult> {
      try {
        await sdk.customers.update(input.customerId, { invoice_settings: { default_payment_method: input.paymentMethodId } });

        if (input.subscriptionId) {
          await sdk.subscriptions.update(input.subscriptionId, { default_payment_method: input.paymentMethodId });
        }

        return { status: 'ok' };
      } catch {
        return { status: 'unavailable' };
      }
    },

    async defaultCard(customerId): Promise<StripeCardResult> {
      try {
        const customer = await sdk.customers.retrieve(customerId, { expand: ['invoice_settings.default_payment_method'] });

        if (customer.deleted) {
          return { status: 'ok', card: null };
        }

        const method = customer.invoice_settings.default_payment_method;
        const card = method && typeof method !== 'string' ? method.card : null;

        return { status: 'ok', card: card ? { brand: card.brand, last4: card.last4 } : null };
      } catch {
        return { status: 'unavailable' };
      }
    },

    async listInvoices(customerId, limit): Promise<StripeInvoicesResult> {
      try {
        const page = await sdk.invoices.list({ customer: customerId, limit });

        // Only what the owner can act on or keep: paid ones, and the open one a retry cycle is still trying to collect.
        // Drafts, voided (expired unpaid subscriptions) and uncollectible ones are Stripe's bookkeeping, not theirs.
        return {
          status: 'ok',
          invoices: page.data
            .filter((invoice) => invoice.status === 'paid' || invoice.status === 'open')
            .map((invoice) => ({
              id: invoice.id,
              amountCents: invoice.status === 'paid' ? invoice.amount_paid : invoice.amount_due,
              status: invoice.status ?? 'draft',
              paidAt: isoOf(invoice.status_transitions.paid_at),
              pdfUrl: invoice.invoice_pdf ?? null
            }))
        };
      } catch {
        return { status: 'unavailable' };
      }
    },

    constructEvent(rawBody, signature, secret): StripeEventResult {
      if (!signature) {
        return { status: 'invalid' };
      }

      try {
        const event = sdk.webhooks.constructEvent(rawBody, signature, secret);
        const object = event.data.object as { object: string; id: string; parent?: { subscription_details?: { subscription?: string | { id: string } } } };
        const parentSubscription = object.parent?.subscription_details?.subscription;
        const subscriptionId = object.object === 'subscription' ? object.id : typeof parentSubscription === 'string' ? parentSubscription : (parentSubscription?.id ?? null);

        return { status: 'ok', event: { id: event.id, type: event.type, created: new Date(event.created * 1000).toISOString(), subscriptionId } };
      } catch {
        return { status: 'invalid' };
      }
    }
  };
}
