import { describe, expect, it } from 'vitest';
import { BillingFrequency, BillingRecurrence } from './billing';
import { type BillingDraft, EMPTY_BILLING_DRAFT, EMPTY_SPLIT_VALUES } from './billing-draft';
import { billingDraftSummary, billingDraftSummaryText } from './billing-footer';
import { Direction, PixKeyType, SplitMode } from './contracts';

const TODAY = new Date('2026-09-10T12:00:00Z');

const base: BillingDraft = {
  ...EMPTY_BILLING_DRAFT('America/Sao_Paulo', '2026-09-10'),
  selected: ['p1', 'p2'],
  owner: false,
  amount: '100,00',
  description: 'Aluguel'
};

describe('billing draft summary', () => {
  it('counts a once billing split between contacts, excluding the owner part', () => {
    const summary = billingDraftSummary(base, TODAY);

    expect(summary).toEqual({ charges: 2, people: 2, occurrences: 1, totalCents: 10000, perOccurrenceCents: 10000 });
    expect(billingDraftSummaryText(summary!)).toBe('Gera 2 cobranças · 2 pessoas');
  });

  it('counts every installment of a parcelado', () => {
    const draft: BillingDraft = {
      ...base,
      type: BillingRecurrence.Until,
      selected: ['p1'],
      frequency: BillingFrequency.Monthly,
      occurrences: '3'
    };
    const summary = billingDraftSummary(draft, TODAY);

    // The typed amount is now the total: R$ 100,00 over 3 installments rounds up to R$ 33,34 each.
    expect(summary).toEqual({ charges: 3, people: 1, occurrences: 3, totalCents: 10002, perOccurrenceCents: 3334 });
    expect(billingDraftSummaryText(summary!)).toBe('Gera 3 cobranças · 1 pessoa × 3 meses');
  });

  it('counts only one occurrence of a recorrente sem fim', () => {
    const draft: BillingDraft = { ...base, type: BillingRecurrence.Indefinite, frequency: BillingFrequency.Monthly };
    const summary = billingDraftSummary(draft, TODAY);

    expect(summary).toEqual({ charges: 2, people: 2, occurrences: null, totalCents: 10000, perOccurrenceCents: 10000 });
    expect(billingDraftSummaryText(summary!)).toBe('Gera 2 cobranças por mês · 2 pessoas');
  });

  it('counts the payee alone on a conta a pagar', () => {
    const draft: BillingDraft = {
      ...base,
      direction: Direction.Payable,
      payee: 'p1',
      selected: [],
      pixInline: { type: PixKeyType.Email, key: 'pix@example.com', label: '' }
    };
    const summary = billingDraftSummary(draft, TODAY);

    expect(summary).toEqual({ charges: 1, people: 1, occurrences: 1, totalCents: 10000, perOccurrenceCents: 10000 });
    expect(billingDraftSummaryText(summary!)).toBe('Gera 1 cobrança · 1 pessoa');
  });

  it('counts nobody on a conta a pagar the owner keeps alone', () => {
    const draft: BillingDraft = { ...base, direction: Direction.Payable, payee: '', selected: [] };
    const summary = billingDraftSummary(draft, TODAY);

    expect(summary).toEqual({ charges: 1, people: 0, occurrences: 1, totalCents: 10000, perOccurrenceCents: 10000 });
    expect(billingDraftSummaryText(summary!)).toBe('Gera 1 cobrança');
  });

  it('counts nobody on a registro, whichever direction it names', () => {
    const draft: BillingDraft = {
      ...base,
      direction: Direction.Payable,
      selected: [],
      settled: true,
      counterpartLabel: 'Padaria'
    };
    const summary = billingDraftSummary(draft, TODAY);

    expect(summary).toEqual({ charges: 1, people: 0, occurrences: 1, totalCents: 10000, perOccurrenceCents: 10000 });
    expect(billingDraftSummaryText(summary!)).toBe('Gera 1 cobrança');
  });

  it('reads "por mês" with nobody on an indefinite conta a pagar alone', () => {
    const draft: BillingDraft = {
      ...base,
      direction: Direction.Payable,
      payee: '',
      selected: [],
      type: BillingRecurrence.Indefinite,
      frequency: BillingFrequency.Monthly
    };
    const summary = billingDraftSummary(draft, TODAY);

    expect(summary).toEqual({ charges: 1, people: 0, occurrences: null, totalCents: 10000, perOccurrenceCents: 10000 });
    expect(billingDraftSummaryText(summary!)).toBe('Gera 1 cobrança por mês');
  });

  it('returns null while the draft is not valid yet', () => {
    expect(billingDraftSummary({ ...base, selected: [] }, TODAY)).toBeNull();
    expect(billingDraftSummary({ ...base, amount: '' }, TODAY)).toBeNull();
    expect(billingDraftSummary({ ...base, type: BillingRecurrence.Until, end: '', occurrences: '' }, TODAY)).toBeNull();
  });

  it('splits unevenly but keeps the same totals as resolveBillingSplit', () => {
    const draft: BillingDraft = {
      ...base,
      selected: ['p1', 'p2', 'p3'],
      mode: SplitMode.Fixed,
      values: { ...EMPTY_SPLIT_VALUES(), fixed: { p1: '50,00', p2: '30,00', p3: '0,00' } }
    };
    const summary = billingDraftSummary(draft, TODAY);

    // p3's fixed share resolves to zero, so it gets no charge; the owner absorbs the 20,00 remainder untouched, off the charges.
    expect(summary).toEqual({ charges: 2, people: 2, occurrences: 1, totalCents: 8000, perOccurrenceCents: 8000 });
  });
});
