import { describe, expect, it } from 'vitest';
import { needsOnboarding } from './onboarding';

describe('needsOnboarding', () => {
  it('requires a profile name before the app can be used', () => {
    expect(needsOnboarding({ name: null })).toBe(true);
    expect(needsOnboarding({ name: '' })).toBe(true);
    expect(needsOnboarding({ name: '   ' })).toBe(true);
  });

  it('accepts any non-blank name', () => {
    expect(needsOnboarding({ name: 'Ana' })).toBe(false);
    expect(needsOnboarding({ name: ' Ana ' })).toBe(false);
  });

  it('treats a missing profile as still onboarding', () => {
    expect(needsOnboarding(null)).toBe(true);
    expect(needsOnboarding(undefined)).toBe(true);
  });
});
