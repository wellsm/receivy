import { describe, expect, it } from 'vitest';
import { BillingKind, BillingRecurrence } from './billing';
import { ChargeState, type ChargeSummary, Direction, ProofKind, ProofState } from './contracts';
import { ChargeActionKind, chargeAction, chargeBadges, chargeStateLabel, feedDayLabel } from './feed';

const base: ChargeSummary = {
  id: 'c1',
  description: 'Mercado',
  amount: { amountCents: 8742, currency: 'BRL' },
  dueDate: '2026-09-08',
  state: ChargeState.Pending,
  billingId: 'b1',
  recurrence: BillingRecurrence.Once,
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
        { ...base, recurrence: BillingRecurrence.Indefinite, installment: null, installmentCount: null, dueDate: '2026-10-01' },
        '2026-09-08'
      )
    ).toEqual([{ label: 'Recorrente', tone: 'neutral' }]);
    expect(
      chargeBadges({ ...base, recurrence: BillingRecurrence.Until, installment: 2, installmentCount: 3, dueDate: '2026-10-01' }, '2026-09-08')
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

  it('offers only in-place actions and leaves every other card to open the charge', () => {
    expect(chargeAction(base, Direction.Receivable)).toEqual({ kind: 'remind', label: 'Lembrar' });
    expect(chargeAction({ ...base, counterpartReachable: false }, Direction.Receivable)).toBeNull();
    expect(chargeAction({ ...base, proofState: ProofState.Pending }, Direction.Receivable)).toBeNull();
    expect(chargeAction(base, Direction.Payable)).toBeNull();
    expect(chargeAction({ ...base, proofState: ProofState.Pending }, Direction.Payable)).toBeNull();
    expect(chargeAction({ ...base, state: ChargeState.Paid }, Direction.Payable)).toBeNull();
  });
});

describe('conta a pagar in the feed', () => {
  const own: ChargeSummary = { ...base, ownedByViewer: true, hasPix: true };

  it("badges the owner's own bill and settles it in place only without Pix", () => {
    expect(chargeBadges(own, '2026-01-01', Direction.Payable).map((badge) => badge.label)).toContain('Minha conta');
    expect(chargeAction(own, Direction.Payable)).toBeNull();
    expect(chargeAction({ ...own, hasPix: false }, Direction.Payable)).toEqual({ kind: 'mark_paid', label: 'Marcar pago' });
    expect(chargeAction({ ...own, hasPix: false, proofState: ProofState.Pending }, Direction.Payable)).toBeNull();
  });

  it('never lets the payee remind: they only open the charge', () => {
    const payee: ChargeSummary = { ...base, ownedByViewer: false, hasPix: true };

    expect(chargeBadges(payee, '2026-01-01', Direction.Receivable).map((badge) => badge.label)).not.toContain('Minha conta');
    expect(chargeAction(payee, Direction.Receivable)).toBeNull();
    expect(chargeAction({ ...payee, proofState: ProofState.Pending }, Direction.Receivable)).toBeNull();
  });
});

describe('charges under review', () => {
  it('reads Em análise and names what is waiting', () => {
    const declared = { ...base, proofState: ProofState.Pending, proofKind: ProofKind.Declaration, dueDate: '2026-09-20' };

    expect(chargeStateLabel(declared, Direction.Receivable)).toBe('Em análise');
    expect(chargeBadges(declared, '2026-09-08')).toEqual([{ label: 'Pagamento informado', tone: 'info' }]);
    expect(chargeBadges({ ...declared, proofKind: ProofKind.File }, '2026-09-08')).toEqual([
      { label: 'Comprovante enviado', tone: 'info' }
    ]);
    expect(chargeAction(declared, Direction.Payable)).toBeNull();
  });

  it('turns the own-bill action into a declaration when the payee can confirm', () => {
    const own = { ...base, ownedByViewer: true, hasPix: false };

    expect(chargeAction({ ...own, confirmationRequired: true }, Direction.Payable)).toEqual({
      kind: ChargeActionKind.DeclarePayment,
      label: 'Marcar pago'
    });
    expect(chargeAction({ ...own, confirmationRequired: false }, Direction.Payable)).toEqual({ kind: 'mark_paid', label: 'Marcar pago' });
  });
});

describe('registros in the feed', () => {
  const registro: ChargeSummary = { ...base, counterpartName: 'Empresa X', kind: BillingKind.Record };

  it('badges a registro beside its status and never offers a reminder', () => {
    expect(chargeBadges(registro, '2026-09-01')).toEqual([{ label: 'Registro', tone: 'neutral' }]);
    expect(chargeBadges({ ...registro, state: ChargeState.Paid }, '2026-09-10')).toEqual([
      { label: 'Pago', tone: 'success' },
      { label: 'Registro', tone: 'neutral' }
    ]);
    expect(chargeAction(registro, Direction.Receivable)).toBeNull();
    expect(chargeAction({ ...registro, kind: BillingKind.Live }, Direction.Receivable)).toEqual({ kind: 'remind', label: 'Lembrar' });
  });
});
