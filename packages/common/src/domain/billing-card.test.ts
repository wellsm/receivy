import { describe, expect, it } from 'vitest';
import { BillingFrequency, BillingKind, BillingState, type BillingSummary, BillingRecurrence } from './billing';
import {
  billingBadges,
  billingCardSubtitle,
  billingChips,
  billingDueLabel,
  billingNextLabel,
  billingShareAction,
  billingSummaryLine,
  DEFAULT_BILLING_LIST_FILTERS,
  filterBillings
} from './billing-card';
import { BillingCategory } from './billing-category';
import { Direction, SplitMode } from './contracts';
import { BadgeTone } from './feed';

const base: BillingSummary = {
  id: 'b1',
  type: Direction.Receivable,
  contact: null,
  counterpart: null,
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
    const labels = billingBadges({ ...base, type: Direction.Payable, contact, counterpart: contact }).map((badge) => badge.label);

    expect(labels).toEqual(['Única', 'A pagar', 'Imobiliária']);
  });
});

describe('billingBadges on a registro', () => {
  it('names the other side instead of the people and marks it as a registro', () => {
    // A registro a receber keeps its payer in the split; the API names them on `counterpart` all the same.
    expect(
      billingBadges({
        ...base,
        kind: BillingKind.Record,
        counterpart: { id: 'c1', userId: 'u1', name: 'Empresa X', avatar: null },
        participantCount: 0
      }).map((badge) => badge.label)
    ).toEqual(['Única', 'Registro', 'Empresa X']);
    // A registro from before the contact seat names nobody: the badge stands alone.
    expect(billingBadges({ ...base, kind: BillingKind.Record, participantCount: 0 }).map((badge) => badge.label)).toEqual([
      'Única',
      'Registro'
    ]);

    const clinica = { id: 'c2', userId: 'u2', name: 'Clínica Sorriso', avatar: null };

    expect(
      billingBadges({ ...base, type: Direction.Payable, kind: BillingKind.Record, contact: clinica, counterpart: clinica }).map(
        (badge) => badge.label
      )
    ).toEqual(['Única', 'Registro', 'A pagar', 'Clínica Sorriso']);
  });
});

describe('billing card 8b', () => {
  const today = '2026-09-28';

  it('reads the category and the side under the title', () => {
    expect(billingCardSubtitle(base)).toBe('Moradia · a receber');
    expect(billingCardSubtitle({ ...base, type: Direction.Payable, category: BillingCategory.Subscription })).toBe('Assinatura · a pagar');
  });

  it('shows the next due date, or that it is late', () => {
    expect(billingNextLabel({ ...base, nextDueDate: '2026-10-20' }, today)).toEqual({ label: 'próx. 20/out', tone: BadgeTone.Neutral });
    expect(billingNextLabel({ ...base, nextDueDate: '2026-09-24' }, today)).toEqual({ label: 'atrasada', tone: BadgeTone.Danger });
  });

  it('chips the next installment and the split of a shared billing', () => {
    const billing = { ...base, recurrence: BillingRecurrence.Until, installmentCount: 12, paidCount: 2, splitMode: SplitMode.Shares, nextDueDate: '2026-10-20' };

    expect(billingChips(billing, today).map((chip) => chip.label)).toEqual(['Parcelado 3/12', 'Cotas']);
  });

  it('chips the days late first and leaves the split out for a single person', () => {
    const billing = { ...base, participantCount: 1, splitMode: SplitMode.Equal, nextDueDate: '2026-09-24' };

    expect(billingChips(billing, today).map((chip) => chip.label)).toEqual(['4 dias de atraso', 'À vista']);
  });

  it('filters the loaded billings by state, side, recurrence and category', () => {
    const rows = [
      { ...base, id: 'a' },
      { ...base, id: 'b', state: BillingState.Paused },
      { ...base, id: 'c', type: Direction.Payable },
      { ...base, id: 'd', recurrence: BillingRecurrence.Indefinite, category: BillingCategory.Subscription }
    ];

    expect(filterBillings(rows, BillingState.Active, DEFAULT_BILLING_LIST_FILTERS).map((row) => row.id)).toEqual(['a', 'c', 'd']);
    expect(filterBillings(rows, BillingState.Active, { ...DEFAULT_BILLING_LIST_FILTERS, type: Direction.Payable }).map((row) => row.id)).toEqual(['c']);
    expect(filterBillings(rows, BillingState.Active, { ...DEFAULT_BILLING_LIST_FILTERS, recurrence: BillingRecurrence.Indefinite }).map((row) => row.id)).toEqual(['d']);
    expect(filterBillings(rows, BillingState.Active, { ...DEFAULT_BILLING_LIST_FILTERS, category: BillingCategory.Housing }).map((row) => row.id)).toEqual(['a', 'c']);
  });
});
