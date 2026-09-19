import { describe, expect, it } from 'vitest';
import { PLAN_LIMITS, PlanTier, planOf, SubscriptionStatus } from './plan';

const NOW = new Date('2026-09-19T12:00:00Z');

describe('planOf', () => {
  it('is free without a subscription', () => {
    expect(planOf(null, NOW)).toBe(PlanTier.Free);
  });

  it('is basic while active or past due inside the paid period', () => {
    expect(planOf({ status: SubscriptionStatus.Active, currentPeriodEnd: '2026-10-19T12:00:00Z' }, NOW)).toBe(PlanTier.Basic);
    expect(planOf({ status: SubscriptionStatus.PastDue, currentPeriodEnd: '2026-10-19T12:00:00Z' }, NOW)).toBe(PlanTier.Basic);
    expect(planOf({ status: SubscriptionStatus.Active, currentPeriodEnd: null }, NOW)).toBe(PlanTier.Basic);
  });

  it('falls back to free once the paid period is over or the subscription is not live', () => {
    expect(planOf({ status: SubscriptionStatus.PastDue, currentPeriodEnd: '2026-09-19T11:59:59Z' }, NOW)).toBe(PlanTier.Free);
    expect(planOf({ status: SubscriptionStatus.Active, currentPeriodEnd: '2026-09-19T12:00:00Z' }, NOW)).toBe(PlanTier.Free);
    expect(planOf({ status: SubscriptionStatus.Canceled, currentPeriodEnd: '2026-10-19T12:00:00Z' }, NOW)).toBe(PlanTier.Free);
    expect(planOf({ status: SubscriptionStatus.Incomplete, currentPeriodEnd: null }, NOW)).toBe(PlanTier.Free);
  });

  it('keeps the limits the spec fixed', () => {
    expect(PLAN_LIMITS[PlanTier.Free]).toEqual({ indefinite: 5, checkoutLinks: false });
    expect(PLAN_LIMITS[PlanTier.Basic]).toEqual({ indefinite: 30, checkoutLinks: true });
  });
});
