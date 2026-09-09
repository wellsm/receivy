import { describe, expect, it } from 'vitest';
import { type BillingDraft, buildBillingInput, EMPTY_BILLING_DRAFT, EMPTY_SPLIT_VALUES } from './billing-draft';

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
  values: EMPTY_SPLIT_VALUES(),
  category: 'other',
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
      category: 'other',
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
    expect(buildBillingInput({ ...base, mode: 'fixed', values: { ...EMPTY_SPLIT_VALUES(), fixed: { p1: '40,01' } } }).split).toEqual({
      mode: 'fixed',
      parts: [{ kind: 'person', personId: 'p1', amountCents: 4001 }]
    });
    expect(
      buildBillingInput({
        ...base,
        mode: 'percentage',
        values: { ...EMPTY_SPLIT_VALUES(), percentage: { p1: '33,33', owner: '66,67' } }
      }).split
    ).toEqual({
      mode: 'percentage',
      parts: [
        { kind: 'person', personId: 'p1', basisPoints: 3333 },
        { kind: 'owner', basisPoints: 6667 }
      ]
    });
  });

  it("keeps each mode's values isolated: filling fixed does not leak into percentage", () => {
    const values = { ...EMPTY_SPLIT_VALUES(), fixed: { p1: '40,00' } };

    expect(buildBillingInput({ ...base, mode: 'percentage', values: { ...values, percentage: { p1: '50', owner: '50' } } }).split).toEqual({
      mode: 'percentage',
      parts: [
        { kind: 'person', personId: 'p1', basisPoints: 5000 },
        { kind: 'owner', basisPoints: 5000 }
      ]
    });
  });

  it('ignores values.fixed when the mode is shares', () => {
    const draft = {
      ...base,
      mode: 'shares' as const,
      values: { ...EMPTY_SPLIT_VALUES(), fixed: { p1: '999,99' }, shares: { p1: '2' } }
    };

    expect(buildBillingInput(draft).split).toEqual({
      mode: 'shares',
      parts: [
        { kind: 'person', personId: 'p1', shares: 2 },
        { kind: 'owner', shares: 1 }
      ]
    });
  });

  it('rejects empty selection, bad reminder text and non-integer occurrences', () => {
    expect(() => buildBillingInput({ ...base, selected: [] })).toThrow(/contato/i);
    expect(() => buildBillingInput({ ...base, reminders: [{ offsetDays: '-', enabled: true }] })).toThrow(/dias inteiros/i);
    expect(() => buildBillingInput({ ...base, type: 'until', occurrences: '2,5' })).toThrow(/vezes/i);
  });

  it('builds a shares split and keeps the category', () => {
    const draft = {
      ...EMPTY_BILLING_DRAFT('America/Sao_Paulo', '2026-09-10'),
      selected: ['p1', 'p2'],
      owner: true,
      amount: '100,00',
      description: 'Churrasco',
      mode: 'shares' as const,
      values: { ...EMPTY_SPLIT_VALUES(), shares: { p1: '2', owner: '1' } },
      category: 'food' as const
    };

    const input = buildBillingInput(draft);

    expect(input.category).toBe('food');
    expect(input.split).toEqual({
      mode: 'shares',
      parts: [
        { kind: 'person', personId: 'p1', shares: 2 },
        { kind: 'person', personId: 'p2', shares: 1 },
        { kind: 'owner', shares: 1 }
      ]
    });
  });
});

describe('EMPTY_BILLING_DRAFT', () => {
  it('returns a fresh draft with the expected defaults', () => {
    const draft = EMPTY_BILLING_DRAFT('America/Sao_Paulo', '2026-09-10');

    expect(draft).toEqual({
      type: 'once',
      selected: [],
      owner: true,
      amount: '',
      description: '',
      frequency: 'monthly',
      start: '2026-09-10',
      end: '',
      occurrences: '',
      timezone: 'America/Sao_Paulo',
      pix: '',
      mode: 'equal',
      values: { fixed: {}, percentage: {}, shares: {} },
      category: 'other',
      reminders: [{ offsetDays: '0', enabled: true }]
    });
  });

  it('returns a distinct object on every call', () => {
    const first = EMPTY_BILLING_DRAFT('America/Sao_Paulo', '2026-09-10');
    first.selected.push('p1');
    first.values.fixed.p1 = '10,00';

    const second = EMPTY_BILLING_DRAFT('America/Sao_Paulo', '2026-09-10');

    expect(second.selected).toEqual([]);
    expect(second.values.fixed).toEqual({});
  });
});

describe('EMPTY_SPLIT_VALUES', () => {
  it('returns a fresh object per mode on every call', () => {
    const first = EMPTY_SPLIT_VALUES();
    first.fixed.p1 = '10,00';

    const second = EMPTY_SPLIT_VALUES();

    expect(second).toEqual({ fixed: {}, percentage: {}, shares: {} });
  });
});
