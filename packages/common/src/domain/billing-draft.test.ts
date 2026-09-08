import { describe, expect, it } from 'vitest';
import { type BillingDraft, buildBillingInput } from './billing-draft';

const base: BillingDraft = {
  type: 'once',
  selected: ['p1'],
  owner: true,
  amount: '100,01',
  description: 'Internet',
  frequency: 'monthly',
  start: '2026-01-31',
  end: '',
  occurrences: '',
  timezone: 'America/Sao_Paulo',
  pix: '',
  mode: 'equal',
  values: {},
  reminders: [{ offsetDays: '-3', enabled: true }]
};

describe('billing draft review', () => {
  it('builds a once billing without calendar fields', () => {
    expect(buildBillingInput(base)).toEqual({
      type: 'once',
      frequency: undefined,
      description: 'Internet',
      totalCents: 10001,
      startDate: '2026-01-31',
      endDate: undefined,
      timezone: 'America/Sao_Paulo',
      paymentMethodId: undefined,
      reminders: [{ offsetDays: -3, enabled: true }],
      split: { mode: 'equal', parts: [{ kind: 'person', personId: 'p1' }, { kind: 'owner' }] }
    });
  });

  it('turns "N vezes" into the end date of the last occurrence', () => {
    const input = buildBillingInput({ ...base, type: 'until', occurrences: '3' });
    expect(input.endDate).toBe('2026-03-31');
    expect(buildBillingInput({ ...base, type: 'until', end: '2026-02-15' }).endDate).toBe('2026-02-15');
    expect(() => buildBillingInput({ ...base, type: 'until' })).toThrow(/data final/i);
  });

  it('parses fixed money and percentages once at the review boundary', () => {
    expect(buildBillingInput({ ...base, mode: 'fixed', values: { p1: '40,01' } }).split).toEqual({
      mode: 'fixed',
      parts: [{ kind: 'person', personId: 'p1', amountCents: 4001 }]
    });
    expect(buildBillingInput({ ...base, mode: 'percentage', values: { p1: '33,33', owner: '66,67' } }).split).toEqual({
      mode: 'percentage',
      parts: [
        { kind: 'person', personId: 'p1', basisPoints: 3333 },
        { kind: 'owner', basisPoints: 6667 }
      ]
    });
  });

  it('rejects empty selection, bad reminder text and non-integer occurrences', () => {
    expect(() => buildBillingInput({ ...base, selected: [] })).toThrow(/contato/i);
    expect(() => buildBillingInput({ ...base, reminders: [{ offsetDays: '-', enabled: true }] })).toThrow(/dias inteiros/i);
    expect(() => buildBillingInput({ ...base, type: 'until', occurrences: '2,5' })).toThrow(/vezes/i);
  });
});
