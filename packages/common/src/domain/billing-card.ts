import { BillingFrequency, BillingKind, BillingState, type BillingSummary, BillingRecurrence } from './billing';
import { type BillingCategory, billingCategoryLabel } from './billing-category';
import { dayDiff } from './calendar-labels';
import { Direction, SplitMode } from './contracts';
import { BadgeTone } from './feed';
import { formatMoney } from './money';

export const enum BillingShareAction {
  Share = 'share',
  Open = 'open'
}

export type BillingBadge = { label: string; tone: BadgeTone };

/** Human due date for a billing card: relative for the days around today, plural-aware when overdue. */
export function billingDueLabel(billing: BillingSummary, today: string): string {
  if (billing.state === BillingState.Ended) {
    return billing.paidCount === billing.chargeCount && billing.chargeCount > 0 ? 'Liquidada' : 'Encerrada';
  }

  if (!billing.nextDueDate) {
    return 'Sem data';
  }

  const diff = dayDiff(today, billing.nextDueDate);

  if (diff < 0) {
    const days = -diff;

    return `Atrasado ${days} dia${days === 1 ? '' : 's'}`;
  }

  if (diff === 0) {
    return 'Hoje';
  }

  if (diff === 1) {
    return 'Amanhã';
  }

  return `Vence em ${diff} dias`;
}

/** Badges for a billing card: occurrence type, status and participant count. */
export function billingBadges(billing: BillingSummary): BillingBadge[] {
  const badges: BillingBadge[] = [];

  if (billing.recurrence === BillingRecurrence.Once) {
    badges.push({ label: 'Única', tone: BadgeTone.Neutral });
  } else if (billing.recurrence === BillingRecurrence.Until) {
    if (billing.paidCount < (billing.installmentCount ?? 0)) {
      badges.push({ label: `Parcela ${billing.paidCount + 1} de ${billing.installmentCount}`, tone: BadgeTone.Info });
    } else {
      badges.push({ label: `${billing.installmentCount} parcelas`, tone: BadgeTone.Neutral });
    }
  } else {
    badges.push({ label: `Recorrente ${billing.frequency === BillingFrequency.Yearly ? 'anual' : 'mensal'}`, tone: BadgeTone.Info });
  }

  if (billing.state === BillingState.Paused) {
    badges.push({ label: 'Pausada', tone: BadgeTone.Warning });
  }

  if (billing.proofsPending > 0) {
    badges.push({ label: 'Aguardando comprovante', tone: BadgeTone.Info });
  }

  if (billing.state === BillingState.Ended && billing.paidCount === billing.chargeCount && billing.chargeCount > 0) {
    badges.push({ label: 'Liquidado', tone: BadgeTone.Success });
  }

  // A registro names the other side instead of the people.
  if (billing.kind === BillingKind.Record) {
    badges.push({ label: 'Registro', tone: BadgeTone.Neutral });

    if (billing.type === Direction.Payable) {
      badges.push({ label: 'A pagar', tone: BadgeTone.Warning });
    }

    if (billing.counterpart) {
      badges.push({ label: billing.counterpart.name, tone: BadgeTone.Neutral });
    }

    return badges;
  }

  if (billing.type === Direction.Payable) {
    badges.push({ label: 'A pagar', tone: BadgeTone.Warning });

    if (billing.counterpart) {
      badges.push({ label: billing.counterpart.name, tone: BadgeTone.Neutral });
    }

    return badges;
  }

  badges.push({ label: `${billing.participantCount} pessoa${billing.participantCount === 1 ? '' : 's'}`, tone: BadgeTone.Neutral });

  return badges;
}

/** The single call to action a billing card offers; null once the billing ended. */
export function billingShareAction(billing: BillingSummary): BillingShareAction | null {
  if (billing.state === BillingState.Ended) {
    return null;
  }

  return billing.shareChargeId ? BillingShareAction.Share : BillingShareAction.Open;
}

/**
 * One-line summary for a billing card. For `equal` mode, `amountCents` is the
 * per-person amount to display (callers pass `total / people`); other modes
 * pass the total.
 */
export function billingSummaryLine(input: { people: number; amountCents: number; mode: SplitMode; dueLabel: string }): string {
  const people = `${input.people} pessoa${input.people === 1 ? '' : 's'}`;
  const money = formatMoney({ amountCents: input.amountCents, currency: 'BRL' });
  const amount = input.mode === SplitMode.Equal ? `${money} cada` : `${money} total`;

  return `${people} · ${amount} · vence ${input.dueLabel.toLowerCase()}`;
}

const SPLIT_MODE_LABELS: Record<SplitMode, string> = {
  [SplitMode.Equal]: 'Igual',
  [SplitMode.Shares]: 'Cotas',
  [SplitMode.Percentage]: 'Porcentagem',
  [SplitMode.Fixed]: 'Valor fixo'
};

export function splitModeLabel(mode: SplitMode): string {
  return SPLIT_MODE_LABELS[mode];
}

const SHORT_MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function overdueDays(billing: BillingSummary, today: string): number {
  if (billing.state !== BillingState.Active || !billing.nextDueDate) {
    return 0;
  }

  return Math.max(0, dayDiff(billing.nextDueDate, today));
}

/** "Moradia · a receber": the category and the owner's side, under the title of a billing card. */
export function billingCardSubtitle(billing: BillingSummary): string {
  return `${billingCategoryLabel(billing.category)} · ${billing.type === Direction.Payable ? 'a pagar' : 'a receber'}`;
}

/** What sits under the amount of a billing card: the next due date, "atrasada", or how it ended. */
export function billingNextLabel(billing: BillingSummary, today: string): BillingBadge {
  if (billing.state === BillingState.Ended) {
    return { label: billingDueLabel(billing, today).toLowerCase(), tone: BadgeTone.Neutral };
  }

  if (!billing.nextDueDate) {
    return { label: 'sem data', tone: BadgeTone.Neutral };
  }

  if (overdueDays(billing, today) > 0) {
    return { label: 'atrasada', tone: BadgeTone.Danger };
  }

  const day = billing.nextDueDate.slice(8, 10);
  const month = SHORT_MONTHS[Number(billing.nextDueDate.slice(5, 7)) - 1];

  return { label: `próx. ${day}/${month}`, tone: BadgeTone.Neutral };
}

/** The chips of a billing card: how late it is, how it repeats, how it splits and whether it is a registro. */
export function billingChips(billing: BillingSummary, today: string): BillingBadge[] {
  const chips: BillingBadge[] = [];
  const late = overdueDays(billing, today);

  if (late > 0) {
    chips.push({ label: `${late} dia${late === 1 ? '' : 's'} de atraso`, tone: BadgeTone.Danger });
  }

  if (billing.recurrence === BillingRecurrence.Once) {
    chips.push({ label: 'À vista', tone: BadgeTone.Neutral });
  } else if (billing.recurrence === BillingRecurrence.Until) {
    const count = billing.installmentCount ?? 0;

    chips.push(billing.paidCount < count ? { label: `Parcelado ${billing.paidCount + 1}/${count}`, tone: BadgeTone.Info } : { label: `${count} parcelas`, tone: BadgeTone.Neutral });
  } else {
    chips.push({ label: billing.frequency === BillingFrequency.Yearly ? 'Recorrente anual' : 'Recorrente', tone: BadgeTone.Info });
  }

  if (billing.splitMode && billing.participantCount > 1) {
    chips.push({ label: splitModeLabel(billing.splitMode), tone: BadgeTone.Neutral });
  }

  if (billing.proofsPending > 0) {
    chips.push({ label: 'Aguardando comprovante', tone: BadgeTone.Info });
  }

  if (billing.kind === BillingKind.Record) {
    chips.push({ label: 'Registro', tone: BadgeTone.Neutral });
  }

  return chips;
}

/** The Contas footer filters; an empty value lists everything. Applied on the loaded pages, not by the API. */
export type BillingListFilters = {
  type: Direction | '';
  recurrence: BillingRecurrence | '';
  category: BillingCategory | '';
};

export const DEFAULT_BILLING_LIST_FILTERS: BillingListFilters = { type: '', recurrence: '', category: '' };

export const BILLING_RECURRENCE_FILTERS: { value: BillingRecurrence | ''; label: string }[] = [
  { value: '', label: 'Todas' },
  { value: BillingRecurrence.Once, label: 'À vista' },
  { value: BillingRecurrence.Until, label: 'Parcelada' },
  { value: BillingRecurrence.Indefinite, label: 'Recorrente' }
];

export const BILLING_TYPE_FILTERS: { value: Direction | ''; label: string }[] = [
  { value: '', label: 'Todas' },
  { value: Direction.Receivable, label: 'A receber' },
  { value: Direction.Payable, label: 'A pagar' }
];

export function activeBillingFilterCount(filters: BillingListFilters): number {
  return [filters.type, filters.recurrence, filters.category].filter(Boolean).length;
}

export function filterBillings(billings: BillingSummary[], state: BillingState, filters: BillingListFilters): BillingSummary[] {
  return billings.filter((billing) => {
    if (billing.state !== state) {
      return false;
    }

    if (filters.type && billing.type !== filters.type) {
      return false;
    }

    if (filters.recurrence && billing.recurrence !== filters.recurrence) {
      return false;
    }

    return !filters.category || billing.category === filters.category;
  });
}
