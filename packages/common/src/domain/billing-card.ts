import { BillingFrequency, BillingState, type BillingSummary, BillingType } from './billing';
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

  if (billing.type === BillingType.Once) {
    badges.push({ label: 'Única', tone: BadgeTone.Neutral });
  } else if (billing.type === BillingType.Until) {
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

  // A registro names its counterpart instead of the people or the payee.
  if (billing.settled === true) {
    badges.push({ label: 'Registro', tone: BadgeTone.Neutral });

    if (billing.direction === Direction.Payable) {
      badges.push({ label: 'A pagar', tone: BadgeTone.Warning });
    }

    if (billing.counterpartLabel) {
      badges.push({ label: billing.counterpartLabel, tone: BadgeTone.Neutral });
    }

    return badges;
  }

  if (billing.direction === Direction.Payable) {
    badges.push({ label: 'A pagar', tone: BadgeTone.Warning });
    badges.push({ label: billing.payeeName ?? 'Só comigo', tone: BadgeTone.Neutral });

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
