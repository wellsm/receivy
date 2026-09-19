import { PlanTier, SubscriptionProvider, SubscriptionStatus } from '@receivy/common';
import { describe, expect, it, vi } from 'vitest';
import type { StripeClient } from '../../vendors/stripe/types';
import type { SubscriptionRepository } from '../repositories/subscription';
import { syncSubscription } from './sync';

const NOW = new Date('2026-09-19T12:00:00Z');
const FUTURE = '2026-10-19T12:00:00.000Z';

type Remote = { status: SubscriptionStatus; currentPeriodEnd: string | null; cancelAtPeriodEnd?: boolean } | 'unavailable' | 'not_found';

type HarnessOptions = {
  indefinite?: Array<{ id: string; created_at: string }>;
  linked?: string[];
  checkoutMethods?: string[];
  usersThrow?: boolean;
  storedRow?: SubscriptionRepository.Row;
};

function rowWith(overrides: Partial<SubscriptionRepository.Row>): SubscriptionRepository.Row {
  return {
    id: 'row-1',
    owner_id: 'o1',
    provider: SubscriptionProvider.Stripe,
    stripe_customer_id: 'cus_1',
    stripe_subscription_id: 'sub_1',
    plan: PlanTier.Basic,
    status: SubscriptionStatus.Incomplete,
    cancel_at_period_end: false,
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    ...overrides
  };
}

function harness(remote: Remote, options: HarnessOptions = {}) {
  const applied: Array<Record<string, unknown>> = [];
  const events: Array<Record<string, unknown>> = [];
  const emails: Array<Record<string, unknown>> = [];
  const pushes: string[] = [];
  const indefinite = options.indefinite ?? [];
  const linked = options.linked ?? [];
  const checkoutMethods = options.checkoutMethods ?? [];
  let store: SubscriptionRepository.Row | null = options.storedRow ?? null;
  const db = {
    subscriptions: {
      findOne: vi.fn(async () => store),
      updateOne: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        applied.push(data);

        if (store) {
          store = { ...store, ...(data as Partial<SubscriptionRepository.Row>) };
        }

        return { id: 'row-1' };
      })
    },
    billings: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => ({ records: 'payment_method_id' in where ? linked.map((id) => ({ id })) : indefinite })),
      updateOne: vi.fn(async () => ({ id: 'b' }))
    },
    payment_methods: { findMany: vi.fn(async () => ({ records: checkoutMethods.map((id) => ({ id })) })) },
    users: {
      findOne: vi.fn(async ({ lock }: { lock?: boolean } = {}) => {
        if (options.usersThrow && !lock) {
          throw new Error('db down');
        }

        return { id: 'o1', name: 'Ana', email: 'ana@example.com' };
      })
    },
    device_tokens: { findMany: vi.fn(async () => ({ records: [{ id: 'd1', token: 'ExponentPushToken[x]' }] })) },
    events: {
      insertOne: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        events.push(data);

        return { id: 'e' };
      })
    },
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db)
  };
  const stripe = {
    getSubscription: vi.fn(async () => {
      if (remote === 'unavailable') {
        return { status: 'unavailable' };
      }

      if (remote === 'not_found') {
        return { status: 'not_found' };
      }

      return { status: 'ok', subscription: { id: 'sub_1', customerId: 'cus_1', cancelAtPeriodEnd: false, ...remote } };
    })
  } as unknown as StripeClient;
  const notices = {
    transport: {
      email: vi.fn(async (input: Record<string, unknown>) => {
        emails.push(input);

        return { status: 'accepted', id: 'm' };
      }),
      push: vi.fn(async ({ title }: { title: string }) => {
        pushes.push(title);

        return { status: 'accepted', id: 'p' };
      }),
      receipt: vi.fn()
    },
    origin: 'https://receivy.example',
    from: 'no-reply@receivy.example'
  } as never;

  return { db: db as never, stripe, notices, applied, events, emails, pushes };
}

describe('syncSubscription', () => {
  it('applies the state Stripe reports and welcomes the owner on incomplete → active', async () => {
    const h = harness({ status: SubscriptionStatus.Active, currentPeriodEnd: FUTURE });

    expect(await syncSubscription(h.db, h.stripe, h.notices, rowWith({}), NOW, { id: 'evt_1', created: NOW.toISOString(), type: 'customer.subscription.updated' })).toBe('applied');
    expect(h.applied[0]).toMatchObject({ status: SubscriptionStatus.Active, current_period_end: FUTURE, last_event_id: 'evt_1' });
    expect(h.events.map((event) => event.type)).toEqual(['plan.subscribed']);
    expect(h.pushes).toEqual(['Plano Básico ativo']);
    expect(h.emails[0]).toMatchObject({ to: 'ana@example.com', subject: 'Seu plano Básico está ativo' });
  });

  it('replays the same event without touching anything', async () => {
    const h = harness({ status: SubscriptionStatus.Active, currentPeriodEnd: FUTURE });

    expect(await syncSubscription(h.db, h.stripe, h.notices, rowWith({ status: SubscriptionStatus.Active, last_event_id: 'evt_1' }), NOW, { id: 'evt_1', created: NOW.toISOString(), type: 'customer.subscription.updated' })).toBe('replayed');
    expect(h.applied).toEqual([]);
    expect(h.stripe.getSubscription).not.toHaveBeenCalled();
  });

  it('downgrades and tells the owner when a live subscription comes back canceled', async () => {
    const h = harness({ status: SubscriptionStatus.Canceled, currentPeriodEnd: null });

    expect(await syncSubscription(h.db, h.stripe, h.notices, rowWith({ status: SubscriptionStatus.Active, current_period_end: FUTURE }), NOW, { id: 'evt_2', created: NOW.toISOString(), type: 'customer.subscription.deleted' })).toBe('applied');
    expect(h.events.map((event) => event.type)).toEqual(['plan.canceled']);
    expect(h.pushes).toEqual(['Seu plano Básico acabou']);
  });

  it('warns about a failed payment without downgrading while the paid period runs', async () => {
    const h = harness({ status: SubscriptionStatus.PastDue, currentPeriodEnd: FUTURE });

    await syncSubscription(h.db, h.stripe, h.notices, rowWith({ status: SubscriptionStatus.Active, current_period_end: FUTURE }), NOW, { id: 'evt_3', created: NOW.toISOString(), type: 'invoice.payment_failed' });

    expect(h.events.map((event) => event.type)).toEqual(['plan.payment_failed']);
    expect(h.pushes).toEqual(['Pagamento do plano falhou']);
    expect(h.emails[0]).toMatchObject({ subject: 'Atualize o cartão do seu plano' });
  });

  it('answers unavailable and writes nothing when Stripe cannot be read', async () => {
    const h = harness('unavailable');

    expect(await syncSubscription(h.db, h.stripe, h.notices, rowWith({}), NOW, { id: 'evt_4', created: NOW.toISOString(), type: 'customer.subscription.updated' })).toBe('unavailable');
    expect(h.applied).toEqual([]);
  });

  it('never regresses the event watermark on an older event, but still applies the re-read state', async () => {
    const h = harness({ status: SubscriptionStatus.Active, currentPeriodEnd: FUTURE });

    await syncSubscription(
      h.db,
      h.stripe,
      h.notices,
      rowWith({ status: SubscriptionStatus.Active, current_period_end: FUTURE, last_event_id: 'evt_9', last_event_at: '2026-09-19T13:00:00.000Z' }),
      NOW,
      { id: 'evt_5', created: '2026-09-19T11:00:00.000Z', type: 'customer.subscription.updated' }
    );

    expect(h.applied[0]).not.toHaveProperty('last_event_id');
    expect(h.applied[0]).toMatchObject({ status: SubscriptionStatus.Active });
  });

  it('ignores a row with no live subscription id, without touching Stripe', async () => {
    const h = harness({ status: SubscriptionStatus.Active, currentPeriodEnd: FUTURE });

    expect(await syncSubscription(h.db, h.stripe, h.notices, rowWith({ stripe_subscription_id: undefined }), NOW, { id: 'evt_6', created: NOW.toISOString(), type: 'customer.subscription.updated' })).toBe('ignored');
    expect(h.stripe.getSubscription).not.toHaveBeenCalled();
    expect(h.applied).toEqual([]);
  });

  it('treats a not_found subscription as canceled and downgrades a live plan', async () => {
    const h = harness('not_found');

    expect(await syncSubscription(h.db, h.stripe, h.notices, rowWith({ status: SubscriptionStatus.Active, current_period_end: FUTURE }), NOW, { id: 'evt_7', created: NOW.toISOString(), type: 'customer.subscription.deleted' })).toBe('applied');
    expect(h.events.map((event) => event.type)).toEqual(['plan.canceled']);
    expect(h.pushes).toEqual(['Seu plano Básico acabou']);
  });

  it('still resolves applied when the post-commit notice fails to read the account', async () => {
    const h = harness({ status: SubscriptionStatus.Active, currentPeriodEnd: FUTURE }, { usersThrow: true });

    await expect(syncSubscription(h.db, h.stripe, h.notices, rowWith({}), NOW, { id: 'evt_8', created: NOW.toISOString(), type: 'customer.subscription.updated' })).resolves.toBe('applied');
    expect(h.applied[0]).toMatchObject({ status: SubscriptionStatus.Active });
  });

  it('tells the owner how many billings were paused in the cancellation e-mail', async () => {
    const h = harness(
      { status: SubscriptionStatus.Canceled, currentPeriodEnd: null },
      { indefinite: [{ id: 'b6', created_at: '2026-06' }, { id: 'b5', created_at: '2026-05' }, { id: 'b4', created_at: '2026-04' }, { id: 'b3', created_at: '2026-03' }, { id: 'b2', created_at: '2026-02' }, { id: 'b1', created_at: '2026-01' }] }
    );

    await syncSubscription(h.db, h.stripe, h.notices, rowWith({ status: SubscriptionStatus.Active, current_period_end: FUTURE }), NOW, { id: 'evt_9', created: NOW.toISOString(), type: 'customer.subscription.deleted' });

    expect(h.emails[0]).toMatchObject({ subject: 'Seu plano Básico acabou' });
    expect(h.emails[0]?.text).toContain('pausamos 1 cobrança(s)');
  });

  it('decides the transition from the locked re-read, so two concurrent events do not double-fire the notice', async () => {
    const stale = rowWith({ status: SubscriptionStatus.Incomplete, last_event_id: undefined, last_event_at: undefined });
    const h = harness({ status: SubscriptionStatus.Active, currentPeriodEnd: FUTURE }, { storedRow: stale });

    await syncSubscription(h.db, h.stripe, h.notices, stale, NOW, { id: 'evt_a', created: '2026-09-19T12:00:00.000Z', type: 'customer.subscription.updated' });
    await syncSubscription(h.db, h.stripe, h.notices, stale, NOW, { id: 'evt_b', created: '2026-09-19T12:00:01.000Z', type: 'invoice.paid' });

    expect(h.events.map((event) => event.type)).toEqual(['plan.subscribed']);
    expect(h.pushes).toEqual(['Plano Básico ativo']);
  });
});
