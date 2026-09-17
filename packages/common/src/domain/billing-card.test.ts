import { describe, expect, it } from 'vitest';
import { BillingFrequency, BillingKind, BillingState, type BillingSummary, BillingRecurrence } from './billing';
import { billingBadges, billingDueLabel, billingShareAction, billingSummaryLine } from './billing-card';
import { BillingCategory } from './billing-category';
import { Direction, SplitMode } from './contracts';

const base: BillingSummary = {
  id: 'b1',
  type: Direction.Receivable,
  contact: null,
  recurrence: BillingRecurrence.Once,
  description: 'Aluguel',
  total: { amountCents: 100_000, currency: 'BRL' },
  startDate: '2026-09-10',
  state: BillingState.Active,
  nextDueDate: '2026-09-10',
  createdAt: '2026-09-01T00:00:00.000Z',
  category: BillingCategory.Housing,
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
    expect(billingDueLabel({ ...base, state: BillingState.Ended, nextDueDate: null, chargeCount: 4, paidCount: 4 }, '2026-09-10')).toBe(
      'Liquidada'
    );
  });

  it('reports ended state as closed otherwise', () => {
    expect(billingDueLabel({ ...base, state: BillingState.Ended, nextDueDate: null, chargeCount: 4, paidCount: 2 }, '2026-09-10')).toBe(
      'Encerrada'
    );
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
      recurrence: BillingRecurrence.Until,
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
      recurrence: BillingRecurrence.Until,
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
      recurrence: BillingRecurrence.Indefinite,
      frequency: BillingFrequency.Monthly,
      state: BillingState.Paused
    };

    expect(billingBadges(summary)).toEqual([
      { label: 'Recorrente mensal', tone: 'info' },
      { label: 'Pausada', tone: 'warning' },
      { label: '3 pessoas', tone: 'neutral' }
    ]);
  });

  it('badges an indefinite yearly billing awaiting a proof', () => {
    const summary: BillingSummary = {
      ...base,
      recurrence: BillingRecurrence.Indefinite,
      frequency: BillingFrequency.Yearly,
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
      state: BillingState.Ended,
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
      state: BillingState.Ended,
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
    expect(billingShareAction({ ...base, state: BillingState.Ended })).toBeNull();
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
    expect(billingSummaryLine({ people: 1, amountCents: 5_000, mode: SplitMode.Equal, dueLabel: 'Hoje' })).toBe(
      '1 pessoa · R$ 50,00 cada · vence hoje'
    );
  });

  it('shows the total amount for other split modes and pluralizes people', () => {
    expect(billingSummaryLine({ people: 2, amountCents: 10_000, mode: SplitMode.Fixed, dueLabel: 'Amanhã' })).toBe(
      '2 pessoas · R$ 100,00 total · vence amanhã'
    );
  });
});

describe('billingBadges on a conta a pagar', () => {
  it('shows the direction and the receiving contact instead of the participant count', () => {
    const contact = { id: 'c1', userId: 'u1', name: 'Imobiliária', avatar: null };
    const labels = billingBadges({ ...base, type: Direction.Payable, contact }).map((badge) => badge.label);

    expect(labels).toEqual(['Única', 'A pagar', 'Imobiliária']);
    expect(billingBadges({ ...base, type: Direction.Payable, contact: null }).map((badge) => badge.label)).toContain('Só comigo');
  });
});

describe('billingBadges on a registro', () => {
  it('names the receiving contact instead of the people and marks it as a registro', () => {
    // A registro a receber names its payer through the split, so the card falls back to the badge alone.
    expect(billingBadges({ ...base, kind: BillingKind.Record, participantCount: 0 }).map((badge) => badge.label)).toEqual([
      'Única',
      'Registro'
    ]);
    expect(
      billingBadges({
        ...base,
        type: Direction.Payable,
        kind: BillingKind.Record,
        contact: { id: 'c2', userId: 'u2', name: 'Clínica Sorriso', avatar: null }
      }).map((badge) => badge.label)
    ).toEqual(['Única', 'Registro', 'A pagar', 'Clínica Sorriso']);
  });
});
