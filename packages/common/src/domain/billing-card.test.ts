import { describe, expect, it } from 'vitest';
import type { BillingSummary } from './billing';
import { billingBadges, billingDueLabel, billingShareAction, billingSummaryLine } from './billing-card';

const base: BillingSummary = {
  id: 'b1',
  type: 'once',
  description: 'Aluguel',
  total: { amountCents: 100_000, currency: 'BRL' },
  startDate: '2026-09-10',
  state: 'active',
  nextDueDate: '2026-09-10',
  createdAt: '2026-09-01T00:00:00.000Z',
  category: 'housing',
  participantCount: 3,
  chargeCount: 1,
  paidCount: 0,
  proofsPending: 0,
  shareChargeId: null
};

describe('billingDueLabel', () => {
  it('names today', () => {
    expect(billingDueLabel(base, '2026-09-10')).toBe('Hoje');
  });

  it('names tomorrow', () => {
    expect(billingDueLabel(base, '2026-09-09')).toBe('Amanhã');
  });

  it('counts days ahead', () => {
    expect(billingDueLabel({ ...base, nextDueDate: '2026-09-13' }, '2026-09-10')).toBe('Vence em 3 dias');
  });

  it('pluralizes overdue days', () => {
    expect(billingDueLabel(base, '2026-09-11')).toBe('Atrasado 1 dia');
    expect(billingDueLabel(base, '2026-09-12')).toBe('Atrasado 2 dias');
  });

  it('reports no date when there is none', () => {
    expect(billingDueLabel({ ...base, nextDueDate: null }, '2026-09-10')).toBe('Sem data');
  });

  it('reports ended state as liquidated when every charge was paid', () => {
    expect(billingDueLabel({ ...base, state: 'ended', nextDueDate: null, chargeCount: 4, paidCount: 4 }, '2026-09-10')).toBe('Liquidada');
  });

  it('reports ended state as closed otherwise', () => {
    expect(billingDueLabel({ ...base, state: 'ended', nextDueDate: null, chargeCount: 4, paidCount: 2 }, '2026-09-10')).toBe('Encerrada');
  });
});

describe('billingBadges', () => {
  it('badges a pending once billing with three people', () => {
    expect(billingBadges(base)).toEqual([
      { label: 'Única', tone: 'neutral' },
      { label: '3 pessoas', tone: 'neutral' }
    ]);
  });

  it('badges an until billing paid 1 of 4 installments', () => {
    const summary: BillingSummary = {
      ...base,
      type: 'until',
      installmentCount: 4,
      paidCount: 1,
      chargeCount: 4,
      participantCount: 1
    };

    expect(billingBadges(summary)).toEqual([
      { label: 'Parcela 2 de 4', tone: 'info' },
      { label: '1 pessoa', tone: 'neutral' }
    ]);
  });

  it('badges a fully paid until billing with the installment count', () => {
    const summary: BillingSummary = {
      ...base,
      type: 'until',
      installmentCount: 4,
      paidCount: 4,
      chargeCount: 4,
      participantCount: 1
    };

    expect(billingBadges(summary)).toEqual([
      { label: '4 parcelas', tone: 'neutral' },
      { label: '1 pessoa', tone: 'neutral' }
    ]);
  });

  it('badges a paused indefinite billing', () => {
    const summary: BillingSummary = {
      ...base,
      type: 'indefinite',
      frequency: 'monthly',
      state: 'paused'
    };

    expect(billingBadges(summary)).toEqual([
      { label: 'Recorrente mensal', tone: 'info' },
      { label: 'Pausada', tone: 'neutral' },
      { label: '3 pessoas', tone: 'neutral' }
    ]);
  });

  it('badges an indefinite yearly billing awaiting a proof', () => {
    const summary: BillingSummary = {
      ...base,
      type: 'indefinite',
      frequency: 'yearly',
      proofsPending: 1
    };

    expect(billingBadges(summary)).toEqual([
      { label: 'Recorrente anual', tone: 'info' },
      { label: 'Aguardando comprovante', tone: 'info' },
      { label: '3 pessoas', tone: 'neutral' }
    ]);
  });

  it('badges an ended billing as liquidated once every charge is paid', () => {
    const summary: BillingSummary = {
      ...base,
      state: 'ended',
      chargeCount: 4,
      paidCount: 4
    };

    expect(billingBadges(summary)).toEqual([
      { label: 'Única', tone: 'neutral' },
      { label: 'Liquidado', tone: 'success' },
      { label: '3 pessoas', tone: 'neutral' }
    ]);
  });

  it('never liquidates an ended billing that never produced a charge', () => {
    const summary: BillingSummary = {
      ...base,
      state: 'ended',
      nextDueDate: null,
      chargeCount: 0,
      paidCount: 0
    };

    expect(billingDueLabel(summary, '2026-09-10')).toBe('Encerrada');
    expect(billingBadges(summary)).toEqual([
      { label: 'Única', tone: 'neutral' },
      { label: '3 pessoas', tone: 'neutral' }
    ]);
  });
});

describe('billingShareAction', () => {
  it('offers nothing once the billing ended', () => {
    expect(billingShareAction({ ...base, state: 'ended' })).toBeNull();
  });

  it('offers to share the single pending charge when there is one', () => {
    expect(billingShareAction({ ...base, shareChargeId: 'c1' })).toBe('share');
  });

  it('otherwise offers to open the billing', () => {
    expect(billingShareAction(base)).toBe('open');
  });
});

describe('billingSummaryLine', () => {
  it('shows the per-person amount for an equal split', () => {
    expect(billingSummaryLine({ people: 1, amountCents: 5_000, mode: 'equal', dueLabel: 'Hoje' })).toBe(
      '1 pessoa · R$ 50,00 cada · vence hoje'
    );
  });

  it('shows the total amount for other split modes and pluralizes people', () => {
    expect(billingSummaryLine({ people: 2, amountCents: 10_000, mode: 'fixed', dueLabel: 'Amanhã' })).toBe(
      '2 pessoas · R$ 100,00 total · vence amanhã'
    );
  });
});
