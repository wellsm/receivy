import { describe, expect, it } from 'vitest';
import { BillingDueRule, BillingFrequency, BillingRecurrence, SplitPartKind } from './billing';
import { BillingCategory } from './billing-category';
import { type BillingDraft, EMPTY_SPLIT_VALUES } from './billing-draft';
import { draftTotalCents, previewBillingSplit, splitParties, splitPartyKey } from './billing-preview';
import { Direction, PixKeyType, SplitMode } from './contracts';
import { formatMoney } from './money';

const base: BillingDraft = {
  direction: Direction.Receivable,
  payee: '',
  pixInline: { type: PixKeyType.Email, key: '', label: '' },
  type: BillingRecurrence.Once,
  selected: ['p1', 'p2'],
  owner: true,
  amount: '90,00',
  description: 'Internet',
  frequency: BillingFrequency.Monthly,
  start: '2026-01-31',
  dueRule: BillingDueRule.Fixed,
  end: '',
  occurrences: '',
  timezone: 'America/Sao_Paulo',
  pix: '',
  mode: SplitMode.Equal,
  values: EMPTY_SPLIT_VALUES(),
  category: BillingCategory.Other,
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

  it('reads a parcelado total as its rounded-up per-installment amount', () => {
    expect(draftTotalCents({ ...base, type: BillingRecurrence.Until, amount: '100,00', occurrences: '3' })).toBe(3334);
  });

  it('reads a parcelado without a valid installment count as zero', () => {
    expect(draftTotalCents({ ...base, type: BillingRecurrence.Until, amount: '100,00', occurrences: '' })).toBe(0);
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
    expect(previewBillingSplit({ ...base, mode: SplitMode.Shares, values: { ...EMPTY_SPLIT_VALUES(), shares: { p1: '2' } } })).toEqual({
      amounts: { p1: 4500, p2: 2250, owner: 2250 },
      error: null
    });
  });

  it('reports the missing remainder of a fixed split when the owner does not participate', () => {
    const preview = previewBillingSplit({
      ...base,
      owner: false,
      mode: SplitMode.Fixed,
      values: { ...EMPTY_SPLIT_VALUES(), fixed: { p1: '40,00', p2: '45,00' } }
    });

    expect(preview.error).toBe(`Faltam ${formatMoney({ amountCents: 500, currency: 'BRL' })}`);
  });

  it('prices the remainder as the owner share without a hint when the owner participates', () => {
    const preview = previewBillingSplit({
      ...base,
      owner: true,
      mode: SplitMode.Fixed,
      values: { ...EMPTY_SPLIT_VALUES(), fixed: { p1: '40,00', p2: '45,00' } }
    });

    expect(preview).toEqual({ amounts: { p1: 4000, p2: 4500, owner: 500 }, error: null });
  });

  it('still rejects a fixed split that overshoots the total when the owner participates', () => {
    const preview = previewBillingSplit({
      ...base,
      owner: true,
      mode: SplitMode.Fixed,
      values: { ...EMPTY_SPLIT_VALUES(), fixed: { p1: '60,00', p2: '45,00' } }
    });

    expect(preview.error).toBe('O rateio ultrapassa o total.');
  });

  it('reports a percentage sum that is not 100%', () => {
    const preview = previewBillingSplit({
      ...base,
      owner: false,
      mode: SplitMode.Percentage,
      values: { ...EMPTY_SPLIT_VALUES(), percentage: { p1: '60', p2: '50' } }
    });

    expect(preview.error).toBe('Soma 110%');
  });

  it('prices a valid percentage split without an error', () => {
    expect(
      previewBillingSplit({
        ...base,
        owner: false,
        mode: SplitMode.Percentage,
        values: { ...EMPTY_SPLIT_VALUES(), percentage: { p1: '60', p2: '40' } }
      })
    ).toEqual({
      amounts: { p1: 5400, p2: 3600 },
      error: null
    });
  });

  it('keeps a fixed value in place when switching to percentage and back', () => {
    const withFixed = { ...base, mode: SplitMode.Fixed, values: { ...EMPTY_SPLIT_VALUES(), fixed: { p1: '40,00' } } };
    const switchedToPercentage = { ...withFixed, mode: 'percentage' as const };
    const switchedBack = { ...switchedToPercentage, mode: SplitMode.Fixed };

    expect(previewBillingSplit(switchedBack)).toEqual(previewBillingSplit(withFixed));
  });

  it('stays silent while the amount is still being typed', () => {
    expect(
      previewBillingSplit({
        ...base,
        amount: '',
        mode: SplitMode.Percentage,
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
    expect(splitParties(base)).toEqual([{ kind: 'user', userId: 'p1' }, { kind: 'user', userId: 'p2' }, { kind: 'owner' }]);
  });

  it('keys a party by person id or owner', () => {
    expect(splitPartyKey({ kind: SplitPartKind.User, userId: 'p1' })).toBe('p1');
    expect(splitPartyKey({ kind: SplitPartKind.Owner })).toBe('owner');
  });
});
