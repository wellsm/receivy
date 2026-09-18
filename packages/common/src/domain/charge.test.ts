import { describe, expect, it } from 'vitest';
import { BillingKind, BillingRecurrence } from './billing';
import { chargeSummaryOf, chargeTotals, counterpartName, groupChargesByDay, openChargesTotal, type ListCharge } from './charge';
import { ChargeState, Direction, ProofKind, ProofState } from './contracts';

function charge(overrides: Partial<ListCharge[number]> = {}): ListCharge[number] {
  return {
    id: crypto.randomUUID(),
    billingId: 'b1',
    description: 'Aluguel',
    state: ChargeState.Pending,
    dueDate: '2026-09-10',
    amountCents: 1000,
    type: Direction.Receivable,
    ownedByViewer: true,
    hasPayment: false,
    notify: true,
    counterpartReachable: true,
    confirmationRequired: true,
    proof: null,
    billing: { recurrence: BillingRecurrence.Once, kind: BillingKind.Live, contact: null },
    debtor: { name: 'Bruno' },
    ...overrides
  };
}

const MINE = { type: Direction.Payable };

describe('counterpart name', () => {
  it('names the counterpart from the contact when the viewer pays, from the debtor when they receive', () => {
    const paying = charge({
      ...MINE,
      billing: { recurrence: BillingRecurrence.Once, kind: BillingKind.Live, contact: { id: 'c1', nickname: 'Padaria da esquina', user: { name: 'Padaria' } } }
    });
    const receiving = charge({ debtor: { name: 'Bruno' } });

    expect(counterpartName(paying)).toBe('Padaria da esquina');
    expect(counterpartName(receiving)).toBe('Bruno');
    expect(counterpartName(charge({ debtor: undefined }))).toBe('Você');
  });

  it('falls back to the creditor name when the viewer pays a bill someone else owns', () => {
    expect(counterpartName(charge({ ...MINE, ownedByViewer: false, creditor: { name: 'Ana' } }))).toBe('Ana');
  });
});

describe('charge summary', () => {
  it('reshapes the list item into what the card helpers read', () => {
    const summary = chargeSummaryOf(
      charge({
        id: 'c1',
        installment: 2,
        installmentCount: 3,
        proof: { state: ProofState.Pending, kind: ProofKind.Declaration },
        hasPayment: true,
        counterpartReachable: false
      })
    );

    expect(summary).toEqual({
      id: 'c1',
      description: 'Aluguel',
      amount: { amountCents: 1000, currency: 'BRL' },
      dueDate: '2026-09-10',
      state: ChargeState.Pending,
      billingId: 'b1',
      recurrence: BillingRecurrence.Once,
      installment: 2,
      installmentCount: 3,
      counterpartName: 'Bruno',
      proofState: ProofState.Pending,
      proofKind: ProofKind.Declaration,
      ownedByViewer: true,
      hasPix: true,
      counterpartReachable: false,
      confirmationRequired: true,
      notify: true,
      kind: BillingKind.Live
    });
  });

  it('reads null installments and proof when the item carries none', () => {
    const summary = chargeSummaryOf(charge());

    expect(summary.installment).toBeNull();
    expect(summary.installmentCount).toBeNull();
    expect(summary.proofState).toBeNull();
    expect(summary.proofKind).toBeNull();
  });
});

describe('charge totals', () => {
  it('splits what is still open from what was settled, on each side', () => {
    const totals = chargeTotals([
      charge({ amountCents: 1000 }),
      charge({ amountCents: 250, state: ChargeState.Paid }),
      charge({ amountCents: 700, ...MINE }),
      charge({ amountCents: 40, state: ChargeState.Paid, ...MINE })
    ]);

    expect(totals.receivable.pending).toEqual({ amountCents: 1000, currency: 'BRL' });
    expect(totals.receivable.paid).toEqual({ amountCents: 250, currency: 'BRL' });
    expect(totals.payable.pending).toEqual({ amountCents: 700, currency: 'BRL' });
    expect(totals.payable.paid).toEqual({ amountCents: 40, currency: 'BRL' });
  });

  it('counts the open charges of each side, never the settled ones', () => {
    const totals = chargeTotals([
      charge(),
      charge(),
      charge({ state: ChargeState.Paid }),
      charge(MINE)
    ]);

    expect(totals.receivable.count).toBe(2);
    expect(totals.payable.count).toBe(1);
  });

  it('leaves cancelled charges out of every figure', () => {
    const totals = chargeTotals([charge({ amountCents: 500, state: ChargeState.Cancelled })]);

    expect(totals.receivable).toEqual({ pending: { amountCents: 0, currency: 'BRL' }, count: 0, paid: { amountCents: 0, currency: 'BRL' } });
  });

  it('answers zeroed totals for an empty month', () => {
    const totals = chargeTotals([]);

    expect(totals.receivable.pending.amountCents).toBe(0);
    expect(totals.payable.count).toBe(0);
  });

  it('groups the month by due date, keeping the order the API answered with', () => {
    const groups = groupChargesByDay([
      charge({ id: 'a', dueDate: '2026-09-10' }),
      charge({ id: 'b', dueDate: '2026-09-11' }),
      charge({ id: 'c', dueDate: '2026-09-10' })
    ]);

    expect(groups.map(([date, items]) => [date, items.map((item) => item.id)])).toEqual([
      ['2026-09-10', ['a', 'c']],
      ['2026-09-11', ['b']]
    ]);
  });

  it('totals what a day still has open, and answers null once the day is closed', () => {
    const open = [charge({ amountCents: 300 }), charge({ amountCents: 200, state: ChargeState.Paid })];

    expect(openChargesTotal(open)).toEqual({ amountCents: 300, currency: 'BRL' });
    expect(openChargesTotal([charge({ state: ChargeState.Paid })])).toBeNull();
    expect(openChargesTotal([])).toBeNull();
  });
});
