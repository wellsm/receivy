import { describe, expect, it } from 'vitest';
import { chargeDirection, chargeTotals, counterpartName, groupChargesByDay, openChargesTotal, type ListCharge } from './charge';
import { ChargeState, Direction } from './contracts';

function charge(overrides: Partial<ListCharge[number]> = {}): ListCharge[number] {
  return {
    id: crypto.randomUUID(),
    description: 'Aluguel',
    state: ChargeState.Pending,
    due_date: '2026-09-10',
    amount_cents: 1000,
    has_payment: false,
    proof: null,
    billing: { recurrence: 'once', kind: 'live', contact: null },
    debtor: { email: 'bruno@example.com' },
    ...overrides
  };
}

const VIEWER = 'ana@example.com';
const MINE = { debtor: { email: VIEWER } };

describe('charge direction', () => {
  it('is payable for whoever is on the debtor side, whichever side owns the billing', () => {
    expect(chargeDirection(charge({ debtor: { email: VIEWER } }), VIEWER)).toBe(Direction.Payable);
  });

  it('is receivable when the viewer is not the one paying', () => {
    expect(chargeDirection(charge(), VIEWER)).toBe(Direction.Receivable);
  });

  it('is receivable on a registro with nobody paying', () => {
    expect(chargeDirection(charge({ debtor: undefined }), VIEWER)).toBe(Direction.Receivable);
  });
});

describe('counterpart name', () => {
  it('names the counterpart from the contact when the viewer pays, from the debtor when they receive', () => {
    const paying = charge({
      debtor: { email: VIEWER },
      billing: { recurrence: 'once', kind: 'live', contact: { id: 'c1', nickname: 'Padaria da esquina', user: { name: 'Padaria' } } }
    });
    const receiving = charge({ debtor: { name: 'Bruno', email: 'bruno@example.com' } });

    expect(counterpartName(paying, VIEWER)).toBe('Padaria da esquina');
    expect(counterpartName(receiving, VIEWER)).toBe('Bruno');
    expect(counterpartName(charge({ debtor: undefined }), VIEWER)).toBe('Você');
  });
});

describe('charge totals', () => {
  it('splits what is still open from what was settled, on each side', () => {
    const totals = chargeTotals(VIEWER, [
      charge({ amount_cents: 1000 }),
      charge({ amount_cents: 250, state: ChargeState.Paid }),
      charge({ amount_cents: 700, ...MINE }),
      charge({ amount_cents: 40, state: ChargeState.Paid, ...MINE })
    ]);

    expect(totals.receivable.pending).toEqual({ amountCents: 1000, currency: 'BRL' });
    expect(totals.receivable.paid).toEqual({ amountCents: 250, currency: 'BRL' });
    expect(totals.payable.pending).toEqual({ amountCents: 700, currency: 'BRL' });
    expect(totals.payable.paid).toEqual({ amountCents: 40, currency: 'BRL' });
  });

  it('counts the open charges of each side, never the settled ones', () => {
    const totals = chargeTotals(VIEWER, [
      charge(),
      charge(),
      charge({ state: ChargeState.Paid }),
      charge(MINE)
    ]);

    expect(totals.receivable.count).toBe(2);
    expect(totals.payable.count).toBe(1);
  });

  it('leaves cancelled charges out of every figure', () => {
    const totals = chargeTotals(VIEWER, [charge({ amount_cents: 500, state: ChargeState.Cancelled })]);

    expect(totals.receivable).toEqual({ pending: { amountCents: 0, currency: 'BRL' }, count: 0, paid: { amountCents: 0, currency: 'BRL' } });
  });

  it('answers zeroed totals for an empty month', () => {
    const totals = chargeTotals(VIEWER, []);

    expect(totals.receivable.pending.amountCents).toBe(0);
    expect(totals.payable.count).toBe(0);
  });

  it('groups the month by due date, keeping the order the API answered with', () => {
    const groups = groupChargesByDay([
      charge({ id: 'a', due_date: '2026-09-10' }),
      charge({ id: 'b', due_date: '2026-09-11' }),
      charge({ id: 'c', due_date: '2026-09-10' })
    ]);

    expect(groups.map(([date, items]) => [date, items.map((item) => item.id)])).toEqual([
      ['2026-09-10', ['a', 'c']],
      ['2026-09-11', ['b']]
    ]);
  });

  it('totals what a day still has open, and answers null once the day is closed', () => {
    const open = [charge({ amount_cents: 300 }), charge({ amount_cents: 200, state: ChargeState.Paid })];

    expect(openChargesTotal(open)).toEqual({ amountCents: 300, currency: 'BRL' });
    expect(openChargesTotal([charge({ state: ChargeState.Paid })])).toBeNull();
    expect(openChargesTotal([])).toBeNull();
  });
});
