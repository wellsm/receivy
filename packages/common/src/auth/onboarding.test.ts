import { describe, expect, it } from 'vitest';
import { needsOnboarding } from './onboarding';

describe('needsOnboarding', () => {
  it('holds every account that has not completed onboarding, whoever created it', () => {
    expect(needsOnboarding(null)).toBe(true);
    expect(needsOnboarding(undefined)).toBe(true);
    expect(needsOnboarding({ status: 'pending' })).toBe(true);
    expect(needsOnboarding({ status: 'removed' })).toBe(true);
  });
  it('lets an active account through', () => {
    expect(needsOnboarding({ status: 'active' })).toBe(false);
  });
});
