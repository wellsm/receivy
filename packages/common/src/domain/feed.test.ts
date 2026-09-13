import { describe, expect, it } from 'vitest';
import { BillingType } from './billing';
import { ChargePayer, ChargeState, type ChargeSummary, Direction, ProofState } from './contracts';
import { chargeAction, chargeBadges, chargeStateLabel, feedDayLabel } from './feed';

const base: ChargeSummary = {
  id: 'c1',
  description: 'Mercado',
  amount: { amountCents: 8742, currency: 'BRL' },
  dueDate: '2026-09-08',
  state: ChargeState.Pending,
  billingId: 'b1',
  billingType: BillingType.Once,
  installment: 1,
  installmentCount: 1,
  counterpartName: 'Maria',
  proofState: null
};

describe('feedDayLabel', () => {
  it('names today, tomorrow and yesterday and spells other dates in Portuguese', () => {
    expect(feedDayLabel('2026-09-08', '2026-09-08')).toBe('Hoje');
    expect(feedDayLabel('2026-09-09', '2026-09-08')).toBe('Amanhã');
    expect(feedDayLabel('2026-09-07', '2026-09-08')).toBe('Ontem');
    expect(feedDayLabel('2026-09-15', '2026-09-08')).toBe('15 de setembro');
    expect(feedDayLabel('2027-01-05', '2026-09-08')).toBe('5 de janeiro de 2027');
  });
});

describe('chargeBadges', () => {
  it('flags due today and overdue pending charges', () => {
    expect(chargeBadges(base, '2026-09-08')).toEqual([{ label: 'Vence hoje', tone: 'danger' }]);
    expect(chargeBadges({ ...base, dueDate: '2026-09-01' }, '2026-09-08')).toEqual([{ label: 'Atrasado', tone: 'danger' }]);
    expect(chargeBadges({ ...base, dueDate: '2026-09-20' }, '2026-09-08')).toEqual([]);
  });

  it('describes recurrence, installments and proofs', () => {
    expect(
      chargeBadges(
        { ...base, billingType: BillingType.Indefinite, installment: null, installmentCount: null, dueDate: '2026-10-01' },
        '2026-09-08'
      )
    ).toEqual([{ label: 'Recorrente', tone: 'neutral' }]);
    expect(
      chargeBadges({ ...base, billingType: BillingType.Until, installment: 2, installmentCount: 3, dueDate: '2026-10-01' }, '2026-09-08')
    ).toEqual([{ label: 'Parcela 2 de 3', tone: 'neutral' }]);
    expect(chargeBadges({ ...base, dueDate: '2026-10-01', proofState: ProofState.Pending }, '2026-09-08')).toEqual([
      { label: 'Comprovante enviado', tone: 'info' }
    ]);
    expect(chargeBadges({ ...base, state: ChargeState.Paid, proofState: ProofState.Accepted }, '2026-09-08')).toEqual([
      { label: 'Validado', tone: 'success' }
    ]);
    expect(chargeBadges({ ...base, state: ChargeState.Paid }, '2026-09-08')).toEqual([{ label: 'Pago', tone: 'success' }]);
    expect(chargeBadges({ ...base, state: ChargeState.Cancelled }, '2026-09-08')).toEqual([{ label: 'Cancelado', tone: 'neutral' }]);
  });
});

describe('chargeStateLabel and chargeAction', () => {
  it('labels the amount by direction and settlement', () => {
    expect(chargeStateLabel(base, Direction.Receivable)).toBe('A receber');
    expect(chargeStateLabel(base, Direction.Payable)).toBe('A pagar');
    expect(chargeStateLabel({ ...base, state: ChargeState.Paid }, Direction.Payable)).toBe('Liquidado');
    expect(chargeStateLabel({ ...base, state: ChargeState.Cancelled }, Direction.Payable)).toBe('Cancelado');
  });

  it('picks one action per situation and none for settled charges', () => {
    expect(chargeAction(base, Direction.Receivable)).toEqual({ kind: 'remind', label: 'Lembrar' });
    expect(chargeAction({ ...base, counterpartReachable: false }, Direction.Receivable)).toEqual({ kind: 'open', label: 'Ver cobrança' });
    expect(chargeAction({ ...base, proofState: ProofState.Pending }, Direction.Receivable)).toEqual({
      kind: 'open',
      label: 'Ver comprovante'
    });
    expect(chargeAction(base, Direction.Payable)).toEqual({ kind: 'open', label: 'Pagar' });
    expect(chargeAction({ ...base, proofState: ProofState.Pending }, Direction.Payable)).toEqual({ kind: 'open', label: 'Ver cobrança' });
    expect(chargeAction({ ...base, state: ChargeState.Paid }, Direction.Payable)).toBeNull();
  });
});

describe('conta a pagar in the feed', () => {
  const own: ChargeSummary = { ...base, payer: ChargePayer.Owner, ownedByViewer: true, hasPix: true };

  it("badges the owner's own bill and offers Pix or a plain settle", () => {
    expect(chargeBadges(own, '2026-01-01').map((badge) => badge.label)).toContain('Minha conta');
    expect(chargeAction(own, Direction.Payable)).toEqual({ kind: 'open', label: 'Pagar' });
    expect(chargeAction({ ...own, hasPix: false }, Direction.Payable)).toEqual({ kind: 'open', label: 'Marcar pago' });
    expect(chargeAction({ ...own, proofState: ProofState.Pending }, Direction.Payable)).toEqual({ kind: 'open', label: 'Ver cobrança' });
  });

  it('never lets the payee remind: they only open or review', () => {
    const payee: ChargeSummary = { ...base, payer: ChargePayer.Owner, ownedByViewer: false, hasPix: true };

    expect(chargeBadges(payee, '2026-01-01').map((badge) => badge.label)).not.toContain('Minha conta');
    expect(chargeAction(payee, Direction.Receivable)).toEqual({ kind: 'open', label: 'Ver cobrança' });
    expect(chargeAction({ ...payee, proofState: ProofState.Pending }, Direction.Receivable)).toEqual({
      kind: 'open',
      label: 'Ver comprovante'
    });
  });
});
