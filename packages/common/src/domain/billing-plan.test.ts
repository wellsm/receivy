import { describe, expect, it } from 'vitest';
import { planBillingCharges } from './billing-plan';

const ana = { kind: 'person' as const, personId: 'ana' };
const bia = { kind: 'person' as const, personId: 'bia' };
const owner = { kind: 'owner' as const };

describe('billing plan', () => {
  it('repeats the exact per-occurrence split on every due date and numbers finite occurrences', () => {
    const plan = planBillingCharges({
      description: ' Aluguel ',
      totalCents: 100,
      split: { mode: 'equal', parts: [ana, bia, owner] },
      dueDates: ['2026-01-31', '2026-02-28'],
      numbered: true
    });
    expect(plan.description).toBe('Aluguel');
    expect(plan.allocations.map((a) => a.amountCents)).toEqual([34, 33, 33]);
    expect(plan.charges).toEqual([
      {
        personId: 'ana',
        description: 'Aluguel',
        amountCents: 34,
        currency: 'BRL',
        dueDate: '2026-01-31',
        installment: 1,
        installmentCount: 2
      },
      {
        personId: 'bia',
        description: 'Aluguel',
        amountCents: 33,
        currency: 'BRL',
        dueDate: '2026-01-31',
        installment: 1,
        installmentCount: 2
      },
      {
        personId: 'ana',
        description: 'Aluguel',
        amountCents: 34,
        currency: 'BRL',
        dueDate: '2026-02-28',
        installment: 2,
        installmentCount: 2
      },
      {
        personId: 'bia',
        description: 'Aluguel',
        amountCents: 33,
        currency: 'BRL',
        dueDate: '2026-02-28',
        installment: 2,
        installmentCount: 2
      }
    ]);
  });

  it('leaves installment fields null for open-ended occurrences and skips zero-cent shares', () => {
    const plan = planBillingCharges({
      description: 'Internet',
      totalCents: 1,
      split: { mode: 'fixed', parts: [{ ...ana, amountCents: 0 }] },
      dueDates: ['2026-05-05'],
      numbered: false
    });
    expect(plan.charges).toEqual([]);
    const paid = planBillingCharges({
      description: 'Internet',
      totalCents: 1,
      split: { mode: 'fixed', parts: [{ ...ana, amountCents: 1 }] },
      dueDates: ['2026-05-05'],
      numbered: false
    });
    expect(paid.charges[0]).toMatchObject({ installment: null, installmentCount: null, amountCents: 1 });
  });

  it('rejects empty or oversized descriptions', () => {
    expect(() =>
      planBillingCharges({
        description: '   ',
        totalCents: 1,
        split: { mode: 'equal', parts: [ana] },
        dueDates: ['2026-01-01'],
        numbered: true
      })
    ).toThrow(/descrição/i);
    expect(() =>
      planBillingCharges({
        description: 'x'.repeat(501),
        totalCents: 1,
        split: { mode: 'equal', parts: [ana] },
        dueDates: ['2026-01-01'],
        numbered: true
      })
    ).toThrow(/descrição/i);
  });
});
