import { describe, expect, it } from 'vitest';
import { SplitPartKind } from './billing';
import { planBillingCharges } from './billing-plan';
import { ChargePayer, SplitMode } from './contracts';
import type { SplitParty } from './split';

const ana = { kind: SplitPartKind.User, userId: 'ana' } satisfies SplitParty;
const bia = { kind: SplitPartKind.User, userId: 'bia' } satisfies SplitParty;
const owner = { kind: SplitPartKind.Owner } satisfies SplitParty;

describe('billing plan', () => {
  it('repeats the exact per-occurrence split on every due date and numbers finite occurrences', () => {
    const plan = planBillingCharges({
      description: ' Aluguel ',
      totalCents: 100,
      split: { mode: SplitMode.Equal, parts: [ana, bia, owner] },
      dueDates: ['2026-01-31', '2026-02-28'],
      numbered: true
    });
    expect(plan.description).toBe('Aluguel');
    expect(plan.allocations.map((a) => a.amountCents)).toEqual([34, 33, 33]);
    expect(plan.charges).toEqual([
      {
        userId: 'ana',
        description: 'Aluguel',
        amountCents: 34,
        currency: 'BRL',
        dueDate: '2026-01-31',
        installment: 1,
        installmentCount: 2
      },
      {
        userId: 'bia',
        description: 'Aluguel',
        amountCents: 33,
        currency: 'BRL',
        dueDate: '2026-01-31',
        installment: 1,
        installmentCount: 2
      },
      {
        userId: 'ana',
        description: 'Aluguel',
        amountCents: 34,
        currency: 'BRL',
        dueDate: '2026-02-28',
        installment: 2,
        installmentCount: 2
      },
      {
        userId: 'bia',
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
      split: { mode: SplitMode.Fixed, parts: [{ ...ana, amountCents: 0 }] },
      dueDates: ['2026-05-05'],
      numbered: false
    });
    expect(plan.charges).toEqual([]);
    const paid = planBillingCharges({
      description: 'Internet',
      totalCents: 1,
      split: { mode: SplitMode.Fixed, parts: [{ ...ana, amountCents: 1 }] },
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
        split: { mode: SplitMode.Equal, parts: [ana] },
        dueDates: ['2026-01-01'],
        numbered: true
      })
    ).toThrow(/descrição/i);
    expect(() =>
      planBillingCharges({
        description: 'x'.repeat(501),
        totalCents: 1,
        split: { mode: SplitMode.Equal, parts: [ana] },
        dueDates: ['2026-01-01'],
        numbered: true
      })
    ).toThrow(/descrição/i);
  });
});

describe('conta a pagar plan', () => {
  it('charges the owner for the whole total on every due date, naming the payee when there is one', () => {
    const plan = planBillingCharges({
      description: 'Aluguel',
      totalCents: 150_000,
      split: { mode: SplitMode.Equal, parts: [owner] },
      dueDates: ['2026-01-05', '2026-02-05'],
      numbered: true,
      payer: ChargePayer.Owner,
      payeeUserId: 'landlord'
    });

    expect(plan.allocations).toEqual([{ kind: 'owner', amountCents: 150_000 }]);
    expect(plan.charges.map((charge) => [charge.userId, charge.amountCents, charge.dueDate, charge.installment])).toEqual([
      ['landlord', 150_000, '2026-01-05', 1],
      ['landlord', 150_000, '2026-02-05', 2]
    ]);
  });

  it('keeps the payee null on a bill that is the owner alone', () => {
    const plan = planBillingCharges({
      description: 'Netflix',
      totalCents: 3990,
      split: { mode: SplitMode.Equal, parts: [owner] },
      dueDates: ['2026-01-05'],
      numbered: false,
      payer: ChargePayer.Owner
    });

    expect(plan.charges).toEqual([
      {
        userId: null,
        description: 'Netflix',
        amountCents: 3990,
        currency: 'BRL',
        dueDate: '2026-01-05',
        installment: null,
        installmentCount: null
      }
    ]);
  });
});
