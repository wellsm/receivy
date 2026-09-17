import { BillingRecurrence, Direction, PixKeyType, SplitMode, SplitPartKind } from '@receivy/common';
import { describe, expect, it } from 'vitest';
import { billingRequestFingerprint } from './request';

const input = {
  recurrence: BillingRecurrence.Once as const,
  type: Direction.Receivable as const,
  description: 'Jantar',
  totalCents: 1000,
  startDate: '2026-10-01',
  timezone: 'America/Sao_Paulo',
  split: {
    mode: SplitMode.Equal as const,
    parts: [{ kind: SplitPartKind.User as const, userId: 'p1' }, { kind: SplitPartKind.Owner as const }]
  }
};

describe('billing request fingerprint', () => {
  it('is stable across key order and undefined optionals', () => {
    const reordered = {
      split: input.split,
      timezone: input.timezone,
      startDate: input.startDate,
      totalCents: 1000,
      description: 'Jantar',
      type: Direction.Receivable as const,
      recurrence: BillingRecurrence.Once as const
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
  it('tells a conta a pagar apart by direction, contact and typed key', () => {
    const payable = {
      ...input,
      type: Direction.Payable as const,
      split: { mode: SplitMode.Equal as const, parts: [{ kind: SplitPartKind.Owner as const }] }
    };
    expect(billingRequestFingerprint(payable)).not.toBe(billingRequestFingerprint(input));
    expect(billingRequestFingerprint({ ...payable, contactId: 'p9' })).not.toBe(billingRequestFingerprint(payable));
    expect(billingRequestFingerprint({ ...payable, pix: { keyType: PixKeyType.Email, key: 'pay@example.com' } })).not.toBe(
      billingRequestFingerprint(payable)
    );
  });
});
