import { describe, expect, it } from 'vitest';

import { normalizeEmail } from './auth';

describe('normalizeEmail', () => {
  it('trims and lowercases the address used for identity matching', () => {
    expect(normalizeEmail('  Ana.Silva@Example.COM ')).toBe('ana.silva@example.com');
  });

  it('normalizes equivalent unicode representations', () => {
    expect(normalizeEmail('josé@example.com')).toBe(normalizeEmail('jose\u0301@example.com'));
  });
});
