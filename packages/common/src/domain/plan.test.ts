import { describe, expect, it } from 'vitest';
import { PLAN_LIMITS, PlanTier } from './plan';

describe('PLAN_LIMITS', () => {
  it('gives the free plan no WhatsApp messages and the basic plan 150 per cycle', () => {
    expect(PLAN_LIMITS[PlanTier.Free].whatsappMessages).toBe(0);
    expect(PLAN_LIMITS[PlanTier.Basic].whatsappMessages).toBe(150);
  });
});
