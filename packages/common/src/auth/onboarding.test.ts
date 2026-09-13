import { describe, expect, it } from 'vitest';
import { UserStatus } from '../domain/contacts';
import { needsOnboarding } from './onboarding';

describe('needsOnboarding', () => {
  it('holds every account that has not completed onboarding, whoever created it', () => {
    expect(needsOnboarding(null)).toBe(true);
    expect(needsOnboarding(undefined)).toBe(true);
    expect(needsOnboarding({ status: UserStatus.Pending })).toBe(true);
    expect(needsOnboarding({ status: UserStatus.Removed })).toBe(true);
  });
  it('lets an active account through', () => {
    expect(needsOnboarding({ status: UserStatus.Active })).toBe(false);
  });
});
