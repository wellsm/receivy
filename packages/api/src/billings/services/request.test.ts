import { describe, expect, it } from 'vitest';
import { billingRequestFingerprint } from './request';

const input = {
  type: 'once' as const,
  direction: 'receivable' as const,
  description: 'Jantar',
  totalCents: 1000,
  startDate: '2026-10-01',
  timezone: 'America/Sao_Paulo',
  split: { mode: 'equal' as const, parts: [{ kind: 'user' as const, userId: 'p1' }, { kind: 'owner' as const }] }
};

describe('billing request fingerprint', () => {
  it('is stable across key order and undefined optionals', () => {
    const reordered = {
      split: input.split,
      timezone: input.timezone,
      startDate: input.startDate,
      totalCents: 1000,
      description: 'Jantar',
      direction: 'receivable' as const,
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

describe('conta a pagar fingerprint', () => {
  it('tells a conta a pagar apart by direction, payee and typed key', () => {
    const payable = { ...input, direction: 'payable' as const, split: { mode: 'equal' as const, parts: [{ kind: 'owner' as const }] } };
    expect(billingRequestFingerprint(payable)).not.toBe(billingRequestFingerprint(input));
    expect(billingRequestFingerprint({ ...payable, payeeUserId: 'p9' })).not.toBe(billingRequestFingerprint(payable));
    expect(billingRequestFingerprint({ ...payable, pix: { keyType: 'email', key: 'pay@example.com' } })).not.toBe(
      billingRequestFingerprint(payable)
    );
  });
});
