import { describe, expect, it } from 'vitest';
import { PLAN_LIMITS, PlanErrorCode, PlanTier, planErrorOf, planName, planOf, SubscriptionStatus } from './plan';

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

describe('plan copy and errors', () => {
  it('names the tiers', () => {
    expect(planName(PlanTier.Free)).toBe('Grátis');
    expect(planName(PlanTier.Basic)).toBe('Básico');
  });

  it('parses a limit error with its numeric fields', () => {
    const body = { type: 'error', message: 'Você já tem 5 cobranças indefinidas ativas no plano Grátis.', context: { code: 'PLAN_LIMIT_REACHED', fields: { limit: '5', used: '5', plan: 'free' } } };

    expect(planErrorOf(body)).toEqual({ code: PlanErrorCode.LimitReached, message: 'Você já tem 5 cobranças indefinidas ativas no plano Grátis.', fields: { limit: 5, used: 5, plan: PlanTier.Free } });
  });

  it('parses a plan-required error and ignores everything else', () => {
    expect(planErrorOf({ message: 'Links de pagamento fazem parte do plano Básico.', context: { code: 'PLAN_REQUIRED' } })).toEqual({ code: PlanErrorCode.Required, message: 'Links de pagamento fazem parte do plano Básico.', fields: {} });
    expect(planErrorOf({ message: 'x', context: { code: 'CHARGE_CLOSED' } })).toBeNull();
    expect(planErrorOf(null)).toBeNull();
  });

  it('drops invalid plan and missing numeric fields', () => {
    const bodyWithInvalidPlan = { message: 'msg', context: { code: 'PLAN_LIMIT_REACHED', fields: { plan: 'gold' } } };

    expect(planErrorOf(bodyWithInvalidPlan)).toEqual({ code: PlanErrorCode.LimitReached, message: 'msg', fields: {} });
  });
});
