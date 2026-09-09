import { describe, expect, it } from 'vitest';
import { type BillingDraft, EMPTY_SPLIT_VALUES } from './billing-draft';
import { draftTotalCents, previewBillingSplit, splitParties, splitPartyKey } from './billing-preview';
import { formatMoney } from './money';

const base: BillingDraft = {
  type: 'once',
  selected: ['p1', 'p2'],
  owner: true,
  amount: '90,00',
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
  reminders: [{ offsetDays: '0', enabled: true }]
};

describe('draftTotalCents', () => {
  it('parses the typed amount', () => {
    expect(draftTotalCents({ ...base, amount: '85,00' })).toBe(8500);
  });

  it('reads a half-typed amount as zero instead of throwing', () => {
    expect(draftTotalCents({ ...base, amount: '' })).toBe(0);
    expect(draftTotalCents({ ...base, amount: 'abc' })).toBe(0);
  });
});

describe('previewBillingSplit', () => {
  it('prices an equal split per party, owner included', () => {
    expect(previewBillingSplit(base)).toEqual({ amounts: { p1: 3000, p2: 3000, owner: 3000 }, error: null });
  });

  it('leaves the owner out when the owner does not participate', () => {
    expect(previewBillingSplit({ ...base, owner: false })).toEqual({ amounts: { p1: 4500, p2: 4500 }, error: null });
  });

  it('defaults a missing share to one', () => {
    expect(previewBillingSplit({ ...base, mode: 'shares', values: { ...EMPTY_SPLIT_VALUES(), shares: { p1: '2' } } })).toEqual({
      amounts: { p1: 4500, p2: 2250, owner: 2250 },
      error: null
    });
  });

  it('reports the missing remainder of a fixed split', () => {
    const preview = previewBillingSplit({
      ...base,
      mode: 'fixed',
      values: { ...EMPTY_SPLIT_VALUES(), fixed: { p1: '40,00', p2: '45,00' } }
    });

    expect(preview.error).toBe(`Faltam ${formatMoney({ amountCents: 500, currency: 'BRL' })}`);
  });

  it('reports a percentage sum that is not 100%', () => {
    const preview = previewBillingSplit({
      ...base,
      owner: false,
      mode: 'percentage',
      values: { ...EMPTY_SPLIT_VALUES(), percentage: { p1: '60', p2: '50' } }
    });

    expect(preview.error).toBe('Soma 110%');
  });

  it('prices a valid percentage split without an error', () => {
    expect(
      previewBillingSplit({
        ...base,
        owner: false,
        mode: 'percentage',
        values: { ...EMPTY_SPLIT_VALUES(), percentage: { p1: '60', p2: '40' } }
      })
    ).toEqual({
      amounts: { p1: 5400, p2: 3600 },
      error: null
    });
  });

  it('keeps a fixed value in place when switching to percentage and back', () => {
    const withFixed = { ...base, mode: 'fixed' as const, values: { ...EMPTY_SPLIT_VALUES(), fixed: { p1: '40,00' } } };
    const switchedToPercentage = { ...withFixed, mode: 'percentage' as const };
    const switchedBack = { ...switchedToPercentage, mode: 'fixed' as const };

    expect(previewBillingSplit(switchedBack)).toEqual(previewBillingSplit(withFixed));
  });

  it('stays silent while the amount is still being typed', () => {
    expect(
      previewBillingSplit({
        ...base,
        amount: '',
        mode: 'percentage',
        values: { ...EMPTY_SPLIT_VALUES(), percentage: { p1: '60', p2: '50' } }
      })
    ).toEqual({
      amounts: {},
      error: null
    });
  });

  it('surfaces the split rule that rejected the half-typed screen', () => {
    const preview = previewBillingSplit({ ...base, selected: [], owner: false });

    expect(preview.amounts).toEqual({});
    expect(preview.error).toBe('Informe de 1 a 100 participantes.');
  });
});

describe('splitParties', () => {
  it('lists the selected people and the owner last', () => {
    expect(splitParties(base)).toEqual([{ kind: 'person', personId: 'p1' }, { kind: 'person', personId: 'p2' }, { kind: 'owner' }]);
  });

  it('keys a party by person id or owner', () => {
    expect(splitPartyKey({ kind: 'person', personId: 'p1' })).toBe('p1');
    expect(splitPartyKey({ kind: 'owner' })).toBe('owner');
  });
});
