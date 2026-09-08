import { describe, expect, it } from 'vitest';
import { type ExpenseRequestInput, expenseRequestFingerprint, normalizeExpenseInput } from './request';

const input: ExpenseRequestInput = {
  totalCents: 10_00,
  installmentCount: 1,
  firstDueDate: '2026-10-05',
  split: { mode: 'equal', parts: [{ kind: 'owner' }, { kind: 'person', personId: 'f9df6292-727b-4c72-8de8-44d142b4464d' }] }
};

describe('expense requests', () => {
  it('uses a neutral description when none is provided', () => {
    expect(normalizeExpenseInput(input).description).toBe('Cobrança');
  });

  it('binds an idempotency key to canonical payload content', () => {
    const a = expenseRequestFingerprint({ ...input, description: ' Almoço ' });
    const same = expenseRequestFingerprint({ ...input, description: 'Almoço' });
    const changed = expenseRequestFingerprint({ ...input, description: 'Jantar' });
    expect(a).toBe(same);
    expect(a).not.toBe(changed);
  });

  it('ignores nested object property order but preserves allocation order', () => {
    const a = { ...input, split: { mode: 'fixed' as const, parts: [{ kind: 'person' as const, personId: 'person', amountCents: 100 }] } };
    const reordered = {
      ...input,
      split: { parts: [{ amountCents: 100, personId: 'person', kind: 'person' as const }], mode: 'fixed' as const }
    };
    expect(expenseRequestFingerprint(a)).toBe(expenseRequestFingerprint(reordered));
    const equal = { ...input, split: { mode: 'equal' as const, parts: [...input.split.parts].reverse() } };
    expect(expenseRequestFingerprint(input)).not.toBe(expenseRequestFingerprint(equal));
  });
});
