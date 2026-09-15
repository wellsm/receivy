import { describe, expect, it } from 'vitest';
import { BillingDueRule, BillingFrequency, BillingType } from './billing';
import { BillingCategory } from './billing-category';
import { type BillingDraft, buildBillingInput, EMPTY_BILLING_DRAFT, EMPTY_SPLIT_VALUES } from './billing-draft';
import { Direction, PixKeyType, SplitMode } from './contracts';

const base: BillingDraft = {
  direction: Direction.Receivable,
  payee: '',
  pixInline: { type: PixKeyType.Email, key: '', label: '' },
  type: BillingType.Once,
  selected: ['p1'],
  owner: true,
  amount: '100,01',
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
      split: { mode: 'equal', parts: [{ kind: 'user', userId: 'p1' }, { kind: 'owner' }] },
      direction: 'receivable',
      payeeUserId: undefined,
      pix: undefined
    });
  });

  it('turns "N vezes" into the end date of the last occurrence', () => {
    const input = buildBillingInput({ ...base, type: BillingType.Until, occurrences: '3' });
    expect(input.endDate).toBe('2026-03-31');
    expect(buildBillingInput({ ...base, type: BillingType.Until, end: '2026-02-15' }).endDate).toBe('2026-02-15');
    expect(() => buildBillingInput({ ...base, type: BillingType.Until })).toThrow(/data final/i);
  });

  it('counts "N vezes" on month ends with an end_of_month rule', () => {
    expect(
      buildBillingInput({ ...base, type: BillingType.Until, start: '2026-09-30', occurrences: '3', dueRule: BillingDueRule.EndOfMonth })
    ).toMatchObject({
      endDate: '2026-11-30',
      dueRule: 'end_of_month'
    });
    // A yearly draft never carries a month end, whatever it remembers.
    expect(
      buildBillingInput({
        ...base,
        type: BillingType.Indefinite,
        frequency: BillingFrequency.Yearly,
        start: '2026-09-30',
        dueRule: BillingDueRule.EndOfMonth
      }).dueRule
    ).toBeUndefined();
  });

  it('parses fixed money and percentages once at the review boundary', () => {
    expect(
      buildBillingInput({ ...base, mode: SplitMode.Fixed, values: { ...EMPTY_SPLIT_VALUES(), fixed: { p1: '40,01' } } }).split
    ).toEqual({
      mode: 'fixed',
      parts: [{ kind: 'user', userId: 'p1', amountCents: 4001 }]
    });
    expect(
      buildBillingInput({
        ...base,
        mode: SplitMode.Percentage,
        values: { ...EMPTY_SPLIT_VALUES(), percentage: { p1: '33,33', owner: '66,67' } }
      }).split
    ).toEqual({
      mode: 'percentage',
      parts: [
        { kind: 'user', userId: 'p1', basisPoints: 3333 },
        { kind: 'owner', basisPoints: 6667 }
      ]
    });
  });

  it("keeps each mode's values isolated: filling fixed does not leak into percentage", () => {
    const values = { ...EMPTY_SPLIT_VALUES(), fixed: { p1: '40,00' } };

    expect(
      buildBillingInput({ ...base, mode: SplitMode.Percentage, values: { ...values, percentage: { p1: '50', owner: '50' } } }).split
    ).toEqual({
      mode: 'percentage',
      parts: [
        { kind: 'user', userId: 'p1', basisPoints: 5000 },
        { kind: 'owner', basisPoints: 5000 }
      ]
    });
  });

  it('ignores values.fixed when the mode is shares', () => {
    const draft = {
      ...base,
      mode: SplitMode.Shares,
      values: { ...EMPTY_SPLIT_VALUES(), fixed: { p1: '999,99' }, shares: { p1: '2' } }
    };

    expect(buildBillingInput(draft).split).toEqual({
      mode: SplitMode.Shares,
      parts: [
        { kind: 'user', userId: 'p1', shares: 2 },
        { kind: 'owner', shares: 1 }
      ]
    });
  });

  it('rejects empty selection, bad reminder text and non-integer occurrences', () => {
    expect(() => buildBillingInput({ ...base, selected: [] })).toThrow(/contato/i);
    expect(() => buildBillingInput({ ...base, reminders: [{ offsetDays: '-', enabled: true }] })).toThrow(/dias inteiros/i);
    expect(() => buildBillingInput({ ...base, type: BillingType.Until, occurrences: '2,5' })).toThrow(/vezes/i);
  });

  it('builds a shares split and keeps the category', () => {
    const draft = {
      ...EMPTY_BILLING_DRAFT('America/Sao_Paulo', '2026-09-10'),
      selected: ['p1', 'p2'],
      owner: true,
      amount: '100,00',
      description: 'Churrasco',
      mode: SplitMode.Shares as const,
      values: { ...EMPTY_SPLIT_VALUES(), shares: { p1: '2', owner: '1' } },
      category: BillingCategory.Food
    };

    const input = buildBillingInput(draft);

    expect(input.category).toBe(BillingCategory.Food);
    expect(input.split).toEqual({
      mode: SplitMode.Shares,
      parts: [
        { kind: 'user', userId: 'p1', shares: 2 },
        { kind: 'user', userId: 'p2', shares: 1 },
        { kind: 'owner', shares: 1 }
      ]
    });
  });
});

describe('EMPTY_BILLING_DRAFT', () => {
  it('returns a fresh draft with the expected defaults', () => {
    const draft = EMPTY_BILLING_DRAFT('America/Sao_Paulo', '2026-09-10');

    expect(draft).toEqual({
      direction: 'receivable',
      payee: '',
      pixInline: { type: 'email', key: '', label: '' },
      type: 'once',
      selected: [],
      owner: true,
      amount: '',
      description: '',
      frequency: 'monthly',
      start: '2026-09-10',
      dueRule: 'fixed',
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

describe('conta a pagar draft', () => {
  const payable: BillingDraft = {
    ...base,
    direction: Direction.Payable,
    selected: [],
    payee: 'p9',
    pixInline: { type: PixKeyType.Cpf, key: '529.982.247-25', label: ' Aluguel ' }
  };

  it('needs no contact, drops the wallet key and normalizes the typed Pix', () => {
    const input = buildBillingInput(payable);

    expect(input.direction).toBe('payable');
    expect(input.payeeUserId).toBe('p9');
    expect(input.paymentMethodId).toBeUndefined();
    expect(input.pix).toEqual({ keyType: 'cpf', key: '52998224725', label: 'Aluguel' });
    expect(input.split).toEqual({ mode: 'equal', parts: [{ kind: 'owner' }] });
  });

  it('accepts a bill that is the owner alone, without payee or Pix', () => {
    const input = buildBillingInput({ ...payable, payee: '', pixInline: { type: PixKeyType.Email, key: '', label: '' } });

    expect(input.payeeUserId).toBeUndefined();
    expect(input.pix).toBeUndefined();
  });

  it('rejects an invalid typed key', () => {
    expect(() => buildBillingInput({ ...payable, pixInline: { type: PixKeyType.Cpf, key: '123', label: '' } })).toThrow(
      /Chave Pix inválida/
    );
  });
});

describe('typed phone key', () => {
  it('accepts the masked national number and sends it as E.164', () => {
    const input = buildBillingInput({
      ...base,
      direction: Direction.Payable,
      selected: [],
      pixInline: { type: PixKeyType.Phone, key: '(11) 98765-4321', label: '' }
    });

    expect(input.pix).toEqual({ keyType: 'phone', key: '+5511987654321', label: undefined });
  });
});

describe('silenced participants', () => {
  it('sends the switch only for the participants the draft holds it for', () => {
    expect(buildBillingInput(base).split).toEqual({ mode: 'equal', parts: [{ kind: 'user', userId: 'p1' }, { kind: 'owner' }] });
    expect(buildBillingInput({ ...base, silenced: { p1: true } }).split).toEqual({
      mode: 'equal',
      parts: [{ kind: 'user', userId: 'p1', silenced: true }, { kind: 'owner' }]
    });
    expect(
      buildBillingInput({
        ...base,
        mode: SplitMode.Fixed,
        values: { ...EMPTY_SPLIT_VALUES(), fixed: { p1: '40,01' } },
        silenced: { p1: false }
      }).split
    ).toEqual({ mode: 'fixed', parts: [{ kind: 'user', userId: 'p1', amountCents: 4001, silenced: false }] });
    expect(buildBillingInput({ ...base, mode: SplitMode.Shares, silenced: { p1: true } }).split).toEqual({
      mode: 'shares',
      parts: [
        { kind: 'user', userId: 'p1', silenced: true, shares: 1 },
        { kind: 'owner', shares: 1 }
      ]
    });
  });
});

describe('registro draft', () => {
  it('sends the name and the owner alone, without participants, payee, Pix or reminders', () => {
    const input = buildBillingInput({
      ...base,
      settled: true,
      counterpartLabel: ' Empresa X ',
      payee: 'p9',
      pix: 'pix-1',
      pixInline: { type: PixKeyType.Cpf, key: '529.982.247-25', label: '' }
    });

    expect(input).toMatchObject({
      direction: 'receivable',
      settled: true,
      counterpartLabel: 'Empresa X',
      split: { mode: 'equal', parts: [{ kind: 'owner' }] }
    });
    expect(input.reminders).toBeUndefined();
    expect(input.paymentMethodId).toBeUndefined();
    expect(input.payeeUserId).toBeUndefined();
    expect(input.pix).toBeUndefined();
  });

  it('checks the start of a recorrente registro only with a clock', () => {
    const monthly: BillingDraft = { ...base, settled: true, counterpartLabel: 'Empresa X', type: BillingType.Indefinite };

    expect(() => buildBillingInput(monthly, new Date('2026-09-15T12:00:00Z'))).toThrow('Registro recorrente começa hoje ou depois.');
    expect(buildBillingInput(monthly).startDate).toBe('2026-01-31');
  });
});
