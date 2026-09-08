import { describe, expect, it } from 'vitest';
import { billingRequestFingerprint } from './request';

const input = {
  type: 'once' as const,
  description: 'Jantar',
  totalCents: 1000,
  startDate: '2026-10-01',
  timezone: 'America/Sao_Paulo',
  split: { mode: 'equal' as const, parts: [{ kind: 'person' as const, personId: 'p1' }, { kind: 'owner' as const }] }
};

describe('billing request fingerprint', () => {
  it('is stable across key order and undefined optionals', () => {
    const reordered = {
      split: input.split,
      timezone: input.timezone,
      startDate: input.startDate,
      totalCents: 1000,
      description: 'Jantar',
      type: 'once' as const
    };
    expect(billingRequestFingerprint(reordered)).toBe(billingRequestFingerprint({ ...input, paymentMethodId: undefined }));
  });

  it('changes when money, dates or reminders change', () => {
    expect(billingRequestFingerprint({ ...input, totalCents: 1001 })).not.toBe(billingRequestFingerprint(input));
    expect(billingRequestFingerprint({ ...input, reminders: [{ offsetDays: 0, enabled: true }] })).not.toBe(
      billingRequestFingerprint(input)
    );
  });
});
