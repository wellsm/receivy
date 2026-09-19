import type { Service } from '@ez4/common';
import { HttpBadRequestError, HttpInternalServerError } from '@ez4/gateway';
import { SubscriptionStatus } from '@receivy/common';
import { describe, expect, it, vi } from 'vitest';
import type { WebhookProvider } from '../provider';
import { outcomeToResponse, stripeWebhookHandler } from './stripe';

const ROW = { id: 'row-1', owner_id: 'o1', provider: 'stripe', stripe_customer_id: 'cus_fake_o1', stripe_subscription_id: 'sub_fake_1', plan: 'basic', status: SubscriptionStatus.Active, current_period_end: '2026-10-19T00:00:00.000Z', cancel_at_period_end: false, created_at: '2026-09-01T00:00:00.000Z', updated_at: '2026-09-01T00:00:00.000Z' };

function contextWith(row: Record<string, unknown> | null) {
  const db = {
    subscriptions: { findOne: vi.fn(async () => row), findMany: vi.fn(async () => ({ records: row ? [row] : [] })), updateOne: vi.fn(async () => ({ id: 'row-1' })) },
    billings: { findMany: vi.fn(async () => ({ records: [] })), updateOne: vi.fn(async () => ({ id: 'b' })) },
    payment_methods: { findMany: vi.fn(async () => ({ records: [] })) },
    users: { findOne: vi.fn(async () => ({ id: 'o1', email: 'ana@example.com' })) },
    device_tokens: { findMany: vi.fn(async () => ({ records: [] })) },
    events: { insertOne: vi.fn(async () => ({ id: 'e' })) },
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db)
  };

  return { db, context: { db, variables: { PLAN_BILLING: 'fake', STRIPE_SECRET_KEY: 'disabled', STRIPE_WEBHOOK_SECRET: 'whsec_fake', STRIPE_PRICE_BASIC: 'price_basic', EMAIL_TRANSPORT: 'disabled', RESEND_API_KEY: 'disabled', RESEND_FROM_EMAIL: 'disabled', PUBLIC_WEB_ORIGIN: 'https://receivy.example', NOTIFICATION_PUSH_TRANSPORT: 'disabled', EXPO_ACCESS_TOKEN: 'disabled' } } as unknown as Service.Context<WebhookProvider> };
}

const body = (event: Record<string, unknown>) => JSON.stringify({ id: 'evt_1', type: 'customer.subscription.updated', created: '2026-09-19T12:00:00.000Z', subscriptionId: 'sub_fake_1', ...event });

describe('stripeWebhookHandler', () => {
  it('answers 400 and touches nothing on a bad signature', async () => {
    const { db, context } = contextWith(ROW);

    await expect(stripeWebhookHandler({ headers: { 'stripe-signature': 'nope' }, body: body({}) }, context)).rejects.toBeInstanceOf(HttpBadRequestError);
    expect(db.subscriptions.findMany).not.toHaveBeenCalled();
  });

  it('answers 200 and ignores an event for a subscription it does not know', async () => {
    const { db, context } = contextWith(null);

    expect(await stripeWebhookHandler({ headers: { 'stripe-signature': 'fake' }, body: body({ subscriptionId: 'sub_other' }) }, context)).toEqual({ status: 200, body: { received: true } });
    expect(db.subscriptions.updateOne).not.toHaveBeenCalled();
  });

  it('answers 200 without a subscription id (customer-level events)', async () => {
    const { db, context } = contextWith(ROW);

    expect(await stripeWebhookHandler({ headers: { 'stripe-signature': 'fake' }, body: body({ subscriptionId: null, type: 'customer.updated' }) }, context)).toEqual({ status: 200, body: { received: true } });
    expect(db.subscriptions.findMany).not.toHaveBeenCalled();
  });

  it('syncs a known subscription from the provider, not from the payload', async () => {
    const { db, context } = contextWith(ROW);

    expect(await stripeWebhookHandler({ headers: { 'stripe-signature': 'fake' }, body: body({}) }, context)).toEqual({ status: 200, body: { received: true } });
    expect(db.subscriptions.updateOne).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ last_event_id: 'evt_1' }) }));
  });

  // `vi.doMock` + a dynamic import of './stripe' does not isolate the module here: the file is already
  // statically imported above, and `plans/services/plan.ts` already bound the real `fakeStripe` before the
  // mock is installed, so the handler keeps talking to the real fake client. The `unavailable` branch of
  // `syncSubscription` itself is covered in `plans/services/sync.test.ts`; here the mapping from that
  // outcome to the HTTP response is tested directly against the exported `outcomeToResponse`.
  it('maps an unavailable sync to a 500 so Stripe retries', () => {
    expect(() => outcomeToResponse('unavailable')).toThrow(HttpInternalServerError);
  });
});
