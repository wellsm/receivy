import type { Service } from '@ez4/common';
import { PlanTier, SubscriptionStatus } from '@receivy/common';
import { describe, expect, it, vi } from 'vitest';
import { PlanAlreadyActiveError, PlanBillingDisabledError } from '../errors';
import { createService, type PlanService } from './plan';

const NOW = new Date('2026-09-19T12:00:00Z');

function contextWith(subscription: Record<string, unknown> | null, mode = 'fake') {
  const rows = new Map<string, Record<string, unknown>>(subscription ? [['o1', subscription]] : []);
  const db = {
    subscriptions: {
      findOne: vi.fn(async ({ where }: { where: { owner_id?: string; stripe_subscription_id?: string } }) => (where.owner_id ? (rows.get(where.owner_id) ?? null) : ([...rows.values()].find((row) => row.stripe_subscription_id === where.stripe_subscription_id) ?? null))),
      insertOne: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { ...data, id: 'row-1', owner_id: 'o1' };

        rows.set('o1', row);

        return row;
      }),
      updateOne: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        rows.set('o1', { ...rows.get('o1'), ...data });

        return { id: 'row-1' };
      })
    },
    billings: { count: vi.fn(async () => 3), findMany: vi.fn(async () => ({ records: [] })), updateOne: vi.fn(async () => ({ id: 'b' })) },
    payment_methods: { findMany: vi.fn(async () => ({ records: [] })) },
    users: { findOne: vi.fn(async () => ({ id: 'o1', name: 'Ana', email: 'ana@example.com' })) },
    events: { insertOne: vi.fn(async () => ({ id: 'e' })) },
    device_tokens: { findMany: vi.fn(async () => ({ records: [] })) },
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db)
  };
  const context = { db, variables: { PLAN_BILLING: mode, STRIPE_SECRET_KEY: 'disabled', STRIPE_PRICE_BASIC: 'price_basic', EMAIL_TRANSPORT: 'disabled', RESEND_API_KEY: 'disabled', RESEND_FROM_EMAIL: 'disabled', PUBLIC_WEB_ORIGIN: 'https://receivy.example', NOTIFICATION_PUSH_TRANSPORT: 'disabled', EXPO_ACCESS_TOKEN: 'disabled', APP_STAGE: 'test' } } as unknown as Service.Context<PlanService>;

  return { context, db, rows };
}

describe('PlanService', () => {
  it('describes the free plan with its usage when nobody subscribed', async () => {
    const { context } = contextWith(null);

    expect(await createService(context).get('o1', NOW)).toEqual({ plan: PlanTier.Free, status: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, usage: { indefinite: { used: 3, limit: 5 } }, checkoutLinks: false, card: null });
  });

  it('subscribes in fake mode: customer, subscription, and an active row right away', async () => {
    const { context, rows } = contextWith(null);
    const result = await createService(context).subscribe('o1', NOW);

    expect(result.clientSecret).toMatch(/^pi_fake_/);
    expect(rows.get('o1')).toMatchObject({ stripe_customer_id: 'cus_fake_o1', status: SubscriptionStatus.Active });
    expect(await createService(context).get('o1', NOW)).toMatchObject({ plan: PlanTier.Basic, usage: { indefinite: { used: 3, limit: 30 } }, checkoutLinks: true, card: { last4: '4242' } });
  });

  it('refuses a second subscription while one is live', async () => {
    const { context } = contextWith({ id: 'row-1', owner_id: 'o1', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_fake_9', status: SubscriptionStatus.Active, current_period_end: '2026-10-19T00:00:00.000Z', cancel_at_period_end: false });

    await expect(createService(context).subscribe('o1', NOW)).rejects.toBeInstanceOf(PlanAlreadyActiveError);
  });

  it('answers 503 for every Stripe action when billing is disabled, but still describes the plan', async () => {
    const { context } = contextWith(null, 'disabled');
    const plans = createService(context);

    await expect(plans.subscribe('o1', NOW)).rejects.toBeInstanceOf(PlanBillingDisabledError);
    await expect(plans.cancel('o1', NOW)).rejects.toBeInstanceOf(PlanBillingDisabledError);
    expect((await plans.get('o1', NOW)).plan).toBe(PlanTier.Free);
  });

  it('answers 503 without touching Stripe when live billing has no real secret key', async () => {
    const { context } = contextWith(null, 'live');
    const plans = createService(context);

    await expect(plans.subscribe('o1', NOW)).rejects.toBeInstanceOf(PlanBillingDisabledError);
  });

  it('cancels and resumes at period end through the provider and mirrors the flag', async () => {
    const { context, rows } = contextWith(null);
    const plans = createService(context);

    await plans.subscribe('o1', NOW);
    await plans.cancel('o1', NOW);

    expect(rows.get('o1')).toMatchObject({ cancel_at_period_end: true, status: SubscriptionStatus.Active });

    await plans.resume('o1', NOW);

    expect(rows.get('o1')).toMatchObject({ cancel_at_period_end: false });
  });

  it('starts a card change with a setup intent and confirms it against the provider', async () => {
    const { context } = contextWith(null);
    const plans = createService(context);

    await plans.subscribe('o1', NOW);

    expect(await plans.setupPaymentMethod('o1')).toEqual({ clientSecret: 'seti_fake_secret' });
    await expect(plans.confirmPaymentMethod('o1', 'pm_1')).resolves.toBeUndefined();
  });
});
