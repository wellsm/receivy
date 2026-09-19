import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import { HttpBadRequestError, HttpInternalServerError } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import { SubscriptionRepository } from '../../plans/repositories/subscription';
import { planNoticesOf, stripeOf } from '../../plans/services/plan';
import { type SyncOutcome, syncSubscription } from '../../plans/services/sync';
import type { WebhookProvider } from '../provider';

declare class StripeWebhookRequest implements Http.Request {
  headers: { 'stripe-signature'?: String.Max<1024> };
  body: string;
}

declare class WebhookResponse implements Http.Response {
  status: 200;
  body: { received: true };
}

const RECEIVED: WebhookResponse = { status: 200, body: { received: true } };

const HANDLED = new Set(['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.paid', 'invoice.payment_failed']);

/** A sync that could not read Stripe asks for a retry; everything else is done from Stripe's point of view. */
export function outcomeToResponse(outcome: SyncOutcome): WebhookResponse {
  if (outcome === 'unavailable') {
    throw new HttpInternalServerError('Subscription check unavailable');
  }

  return RECEIVED;
}

export async function stripeWebhookHandler({ headers, body }: StripeWebhookRequest, { db, variables }: Service.Context<WebhookProvider>): Promise<WebhookResponse> {
  const stripe = stripeOf(variables);

  if (!stripe) {
    return RECEIVED;
  }

  const verified = stripe.constructEvent(body, headers['stripe-signature'], variables.STRIPE_WEBHOOK_SECRET);

  if (verified.status !== 'ok') {
    throw new HttpBadRequestError('Invalid signature');
  }

  const { event } = verified;

  if (!HANDLED.has(event.type) || !event.subscriptionId) {
    return RECEIVED;
  }

  const row = await SubscriptionRepository.bySubscriptionId(db, event.subscriptionId);

  if (!row) {
    return RECEIVED;
  }

  const outcome = await syncSubscription(db, stripe, planNoticesOf(variables), row, new Date(), { id: event.id, created: event.created, type: event.type });

  console.info('Stripe webhook', { ownerId: row.owner_id, type: event.type, outcome });

  return outcomeToResponse(outcome);
}
