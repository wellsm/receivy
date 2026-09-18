import { describe, expect, it } from 'vitest';
import { type BillingDetail, BillingDueRule, BillingFrequency, BillingState, BillingRecurrence, SplitPartKind } from './billing';
import { BillingCategory } from './billing-category';
import { editableMonthCharges, editScopeExplanation, patchTouchesCharges, pendingChargesOf, shouldAskEditScope } from './billing-scope';
import { type ChargeDetail, ChargeState, Direction, ProofKind, ProofMime, ProofState, SharingState, SplitMode } from './contracts';

function charge(overrides: Partial<ChargeDetail> & { id: string }): ChargeDetail {
  return {
    description: 'Aluguel',
    amount: { amountCents: 100_000, currency: 'BRL' },
    dueDate: '2026-09-20',
    state: ChargeState.Pending,
    billingId: 'b1',
    recurrence: BillingRecurrence.Indefinite,
    installment: null,
    installmentCount: null,
    counterpartName: 'Ana',
    proofState: null,
    direction: Direction.Receivable,
    recipient: { userId: 'u1', name: 'Ana', email: null },
    debtorId: 'u1',
    pix: null,
    sharingState: SharingState.Ready,
    proof: null,
    cancelledAt: null,
    paidAt: null,
    createdAt: '2026-09-01T00:00:00Z',
    ...overrides
  };
}

const recurring: BillingDetail = {
  id: 'b1',
  recurrence: BillingRecurrence.Indefinite,
  frequency: BillingFrequency.Monthly,
  type: Direction.Receivable,
  contact: null,
  counterpart: null,
  pix: null,
  description: 'Aluguel',
  total: { amountCents: 100_000, currency: 'BRL' },
  startDate: '2026-09-20',
  dueRule: BillingDueRule.Fixed,
  state: BillingState.Active,
  nextDueDate: '2026-09-20',
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
  timezone: 'America/Sao_Paulo',
  paymentMethodId: 'pix-1',
  reminders: [],
  split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: 'u1' }] },
  allocations: [],
  charges: [charge({ id: 'c1' })],
  previews: [],
  category: BillingCategory.Housing,
  invite: null,
  guests: [],
  linkableContacts: []
};

describe('billing scope helpers', () => {
  it('counts every pending charge for Cancelar pendentes', () => {
    const billing = {
      charges: [charge({ id: 'a' }), charge({ id: 'b', state: ChargeState.Paid }), charge({ id: 'c', dueDate: '2026-08-20' })]
    };

    expect(pendingChargesOf(billing).map((item) => item.id)).toEqual(['a', 'c']);
  });

  it('keeps only this month charges that are pending, not due yet and without a proof under way', () => {
    const file = { name: 'p.pdf', mime: ProofMime.Pdf, size: 1 };
    const proof = (state: ProofState) => ({
      state,
      kind: ProofKind.File,
      file,
      sentAt: '',
      reviewedAt: null,
      reason: null,
      sentByViewer: false
    });
    const billing = {
      charges: [
        charge({ id: 'future' }),
        charge({ id: 'today', dueDate: '2026-09-10' }),
        charge({ id: 'next-month', dueDate: '2026-10-05' }),
        charge({ id: 'paid', state: ChargeState.Paid }),
        charge({ id: 'review', proof: proof(ProofState.Pending) }),
        charge({ id: 'rejected', proof: proof(ProofState.Rejected) })
      ]
    };

    expect(editableMonthCharges(billing, '2026-09-10').map((item) => item.id)).toEqual(['future', 'rejected']);
  });

  it('flags only the fields a charge carries', () => {
    expect(patchTouchesCharges(recurring, { category: BillingCategory.Food, reminders: [] })).toBe(false);
    expect(
      patchTouchesCharges(recurring, { description: 'Aluguel', totalCents: 100_000, paymentMethodId: 'pix-1', clearPaymentMethod: false })
    ).toBe(false);
    expect(patchTouchesCharges(recurring, { totalCents: 120_000 })).toBe(true);
    expect(patchTouchesCharges(recurring, { split: { mode: SplitMode.Equal, parts: [{ kind: SplitPartKind.User, userId: 'u2' }] } })).toBe(
      true
    );
    expect(patchTouchesCharges(recurring, { split: { mode: SplitMode.Equal, parts: [{ userId: 'u1', kind: SplitPartKind.User }] } })).toBe(
      false
    );
    expect(patchTouchesCharges(recurring, { startDate: '2026-09-25' })).toBe(true);
    expect(patchTouchesCharges({ ...recurring, recurrence: BillingRecurrence.Once }, { totalCents: 1 })).toBe(false);
  });

  it('asks only when a charge-carried field changes and this month still has editable charges', () => {
    expect(shouldAskEditScope(recurring, { totalCents: 120_000 }, '2026-09-10')).toBe(true);
    expect(shouldAskEditScope(recurring, { totalCents: 120_000 }, '2026-09-20')).toBe(false);
    expect(shouldAskEditScope(recurring, { category: BillingCategory.Food }, '2026-09-10')).toBe(false);
  });

  it('explains the count with the month name', () => {
    expect(editScopeExplanation(1, '2026-09-10')).toBe('1 cobrança de setembro ainda não venceu.');
    expect(editScopeExplanation(3, '2026-12-01')).toBe('3 cobranças de dezembro ainda não venceram.');
  });
});
