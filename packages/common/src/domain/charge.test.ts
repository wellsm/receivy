import { describe, expect, it } from 'vitest';
import { BillingKind, BillingRecurrence } from './billing';
import { BillingCategory } from './billing-category';
import { chargeFeedLine, chargeSummaryOf, chargeTotals, counterpartName, groupChargesByDay, type ListCharge, openChargesTotal, searchCharges } from './charge';
import { ChargeState, Direction, ProofKind, ProofState, SplitMode } from './contracts';
import { BadgeTone } from './feed';

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
    participantCount: 1,
    proof: null,
    billing: { recurrence: BillingRecurrence.Once, kind: BillingKind.Live, category: BillingCategory.Housing, contact: null },
    debtor: { name: 'Bruno' },
    ...overrides
  };
}

const MINE = { type: Direction.Payable };

describe('counterpart name', () => {
  it('names the counterpart from the contact when the viewer pays, from the debtor when they receive', () => {
    const paying = charge({
      ...MINE,
      billing: { recurrence: BillingRecurrence.Once, kind: BillingKind.Live, category: BillingCategory.Other, contact: { id: 'c1', nickname: 'Padaria da esquina', user: { name: 'Padaria' } } }
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

describe('chargeFeedLine', () => {
  const today = '2026-09-10';

  it('says how late a pending charge is', () => {
    expect(chargeFeedLine(charge({ dueDate: '2026-09-06' }), today)).toEqual({ text: 'atrasado 4 dias', tone: BadgeTone.Danger });
    expect(chargeFeedLine(charge({ dueDate: '2026-09-09' }), today)).toEqual({ text: 'atrasado 1 dia', tone: BadgeTone.Danger });
  });

  it('names the side and the recurrence of what the viewer pays', () => {
    const billing = { recurrence: BillingRecurrence.Indefinite, kind: BillingKind.Live, category: BillingCategory.Subscription, contact: null };

    expect(chargeFeedLine(charge({ ...MINE, billing }), today)).toEqual({ text: 'a pagar · recorrente', tone: BadgeTone.Warning });
  });

  it('counts the people and names the split of a shared billing', () => {
    const billing = { recurrence: BillingRecurrence.Once, kind: BillingKind.Live, category: BillingCategory.Groceries, splitMode: SplitMode.Shares, contact: null };

    expect(chargeFeedLine(charge({ participantCount: 3, billing }), today).text).toBe('3 pessoas · cotas');
  });

  it('names the installment of a single-person receivable', () => {
    expect(chargeFeedLine(charge({ installment: 3, installmentCount: 12 }), today).text).toBe('parcela 3/12 · a receber');
    expect(chargeFeedLine(charge(), today).text).toBe('à vista · a receber');
  });

  it('reports a pending proof and a settled charge before anything else', () => {
    expect(chargeFeedLine(charge({ dueDate: '2026-09-01', proof: { state: ProofState.Pending, kind: ProofKind.Declaration } }), today).text).toBe('pagamento informado');
    expect(chargeFeedLine(charge({ state: ChargeState.Paid }), today)).toEqual({ text: 'paga', tone: BadgeTone.Success });
    expect(chargeFeedLine(charge({ state: ChargeState.Cancelled }), today).text).toBe('cancelada');
  });
});

describe('searchCharges', () => {
  it('matches the description or the other side, ignoring case and accents', () => {
    const rows = [charge({ id: 'a', description: 'Pão de açúcar' }), charge({ id: 'b', description: 'Aluguel', debtor: { name: 'Márcia' } })];

    expect(searchCharges(rows, 'ACUCAR').map((row) => row.id)).toEqual(['a']);
    expect(searchCharges(rows, 'marcia').map((row) => row.id)).toEqual(['b']);
    expect(searchCharges(rows, '  ')).toHaveLength(2);
  });
});
