import { describe, expect, it } from 'vitest';
import type { ChargeSummary } from './contracts';
import { chargeAction, chargeBadges, chargeStateLabel, feedDayLabel } from './feed';

const base: ChargeSummary = {
  id: 'c1',
  description: 'Mercado',
  amount: { amountCents: 8742, currency: 'BRL' },
  dueDate: '2026-09-08',
  state: 'pending',
  billingId: 'b1',
  billingType: 'once',
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
      chargeBadges({ ...base, billingType: 'indefinite', installment: null, installmentCount: null, dueDate: '2026-10-01' }, '2026-09-08')
    ).toEqual([{ label: 'Recorrente', tone: 'neutral' }]);
    expect(
      chargeBadges({ ...base, billingType: 'until', installment: 2, installmentCount: 3, dueDate: '2026-10-01' }, '2026-09-08')
    ).toEqual([{ label: 'Parcela 2 de 3', tone: 'neutral' }]);
    expect(chargeBadges({ ...base, dueDate: '2026-10-01', proofState: 'pending' }, '2026-09-08')).toEqual([
      { label: 'Comprovante enviado', tone: 'info' }
    ]);
    expect(chargeBadges({ ...base, state: 'paid', proofState: 'accepted' }, '2026-09-08')).toEqual([
      { label: 'Validado', tone: 'success' }
    ]);
    expect(chargeBadges({ ...base, state: 'paid' }, '2026-09-08')).toEqual([{ label: 'Pago', tone: 'success' }]);
    expect(chargeBadges({ ...base, state: 'cancelled' }, '2026-09-08')).toEqual([{ label: 'Cancelado', tone: 'neutral' }]);
  });
});

describe('chargeStateLabel and chargeAction', () => {
  it('labels the amount by direction and settlement', () => {
    expect(chargeStateLabel(base, 'receivable')).toBe('A receber');
    expect(chargeStateLabel(base, 'payable')).toBe('A pagar');
    expect(chargeStateLabel({ ...base, state: 'paid' }, 'payable')).toBe('Liquidado');
    expect(chargeStateLabel({ ...base, state: 'cancelled' }, 'payable')).toBe('Cancelado');
  });

  it('picks one action per situation and none for settled charges', () => {
    expect(chargeAction(base, 'receivable')).toEqual({ kind: 'remind', label: 'Lembrar' });
    expect(chargeAction({ ...base, counterpartReachable: false }, 'receivable')).toEqual({ kind: 'open', label: 'Ver cobrança' });
    expect(chargeAction({ ...base, proofState: 'pending' }, 'receivable')).toEqual({ kind: 'open', label: 'Ver comprovante' });
    expect(chargeAction(base, 'payable')).toEqual({ kind: 'open', label: 'Pagar via Pix' });
    expect(chargeAction({ ...base, proofState: 'pending' }, 'payable')).toEqual({ kind: 'open', label: 'Ver cobrança' });
    expect(chargeAction({ ...base, state: 'paid' }, 'payable')).toBeNull();
  });
});

describe('conta a pagar in the feed', () => {
  const own: ChargeSummary = { ...base, payer: 'owner', ownedByViewer: true, hasPix: true };

  it("badges the owner's own bill and offers Pix or a plain settle", () => {
    expect(chargeBadges(own, '2026-01-01').map((badge) => badge.label)).toContain('Minha conta');
    expect(chargeAction(own, 'payable')).toEqual({ kind: 'open', label: 'Pagar via Pix' });
    expect(chargeAction({ ...own, hasPix: false }, 'payable')).toEqual({ kind: 'open', label: 'Marcar pago' });
    expect(chargeAction({ ...own, proofState: 'pending' }, 'payable')).toEqual({ kind: 'open', label: 'Ver cobrança' });
  });

  it('never lets the payee remind: they only open or review', () => {
    const payee: ChargeSummary = { ...base, payer: 'owner', ownedByViewer: false, hasPix: true };

    expect(chargeBadges(payee, '2026-01-01').map((badge) => badge.label)).not.toContain('Minha conta');
    expect(chargeAction(payee, 'receivable')).toEqual({ kind: 'open', label: 'Ver cobrança' });
    expect(chargeAction({ ...payee, proofState: 'pending' }, 'receivable')).toEqual({ kind: 'open', label: 'Ver comprovante' });
  });
});
