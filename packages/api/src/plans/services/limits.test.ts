import { PlanTier, SubscriptionStatus } from '@receivy/common';
import { describe, expect, it, vi } from 'vitest';
import { PlanLimitReachedError, PlanRequiredError } from '../errors';
import { assertCanCreateIndefinite, assertCheckoutLinksAllowed, limitsOf } from './limits';

const NOW = new Date('2026-09-19T12:00:00Z');

function dbWith(subscription: Record<string, unknown> | null, used: number) {
  return { subscriptions: { findOne: vi.fn(async () => subscription) }, billings: { count: vi.fn(async () => used) } } as never;
}

describe('plan limits', () => {
  it('reads free limits without a subscription', async () => {
    expect(await limitsOf(dbWith(null, 2), 'o1', NOW)).toEqual({ plan: PlanTier.Free, limits: { indefinite: 5, checkoutLinks: false }, used: 2 });
  });

  it('lets the fifth indefinite through and refuses the sixth on free', async () => {
    await expect(assertCanCreateIndefinite(dbWith(null, 4), 'o1', NOW)).resolves.toBeUndefined();
    await expect(assertCanCreateIndefinite(dbWith(null, 5), 'o1', NOW)).rejects.toBeInstanceOf(PlanLimitReachedError);
  });

  it('raises the ceiling to 30 while the subscription is live', async () => {
    const live = { status: SubscriptionStatus.Active, current_period_end: '2026-10-19T00:00:00.000Z' };

    await expect(assertCanCreateIndefinite(dbWith(live, 29), 'o1', NOW)).resolves.toBeUndefined();
    await expect(assertCanCreateIndefinite(dbWith(live, 30), 'o1', NOW)).rejects.toMatchObject({ context: { code: 'PLAN_LIMIT_REACHED', fields: { limit: '30', used: '30', plan: PlanTier.Basic } } });
  });

  it('gates checkout links on the plan', async () => {
    await expect(assertCheckoutLinksAllowed(dbWith(null, 0), 'o1', NOW)).rejects.toBeInstanceOf(PlanRequiredError);
    await expect(assertCheckoutLinksAllowed(dbWith({ status: SubscriptionStatus.PastDue, current_period_end: '2026-10-19T00:00:00.000Z' }, 0), 'o1', NOW)).resolves.toBeUndefined();
  });

  it('never queries the count for the link gate', async () => {
    const db = dbWith(null, 0);

    await assertCheckoutLinksAllowed(db, 'o1', NOW).catch(() => undefined);

    expect((db as never as { billings: { count: ReturnType<typeof vi.fn> } }).billings.count).not.toHaveBeenCalled();
  });
});
