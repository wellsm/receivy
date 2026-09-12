import type { BillingSummary } from './billing';
import { dayDiff } from './calendar-labels';
import type { SplitMode } from './contracts';
import type { BadgeTone } from './feed';
import { formatMoney } from './money';

export type BillingBadge = { label: string; tone: BadgeTone };

/** Human due date for a billing card: relative for the days around today, plural-aware when overdue. */
export function billingDueLabel(billing: BillingSummary, today: string): string {
  if (billing.state === 'ended') {
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

  if (billing.type === 'once') {
    badges.push({ label: 'Única', tone: 'neutral' });
  } else if (billing.type === 'until') {
    if (billing.paidCount < (billing.installmentCount ?? 0)) {
      badges.push({ label: `Parcela ${billing.paidCount + 1} de ${billing.installmentCount}`, tone: 'info' });
    } else {
      badges.push({ label: `${billing.installmentCount} parcelas`, tone: 'neutral' });
    }
  } else {
    badges.push({ label: `Recorrente ${billing.frequency === 'yearly' ? 'anual' : 'mensal'}`, tone: 'info' });
  }

  if (billing.state === 'paused') {
    badges.push({ label: 'Pausada', tone: 'warning' });
  }

  if (billing.proofsPending > 0) {
    badges.push({ label: 'Aguardando comprovante', tone: 'info' });
  }

  if (billing.state === 'ended' && billing.paidCount === billing.chargeCount && billing.chargeCount > 0) {
    badges.push({ label: 'Liquidado', tone: 'success' });
  }

  if (billing.direction === 'payable') {
    badges.push({ label: 'A pagar', tone: 'warning' });
    badges.push({ label: billing.payeeName ?? 'Só comigo', tone: 'neutral' });

    return badges;
  }

  badges.push({ label: `${billing.participantCount} pessoa${billing.participantCount === 1 ? '' : 's'}`, tone: 'neutral' });

  return badges;
}

/** The single call to action a billing card offers; null once the billing ended. */
export function billingShareAction(billing: BillingSummary): 'share' | 'open' | null {
  if (billing.state === 'ended') {
    return null;
  }

  return billing.shareChargeId ? 'share' : 'open';
}

/**
 * One-line summary for a billing card. For `equal` mode, `amountCents` is the
 * per-person amount to display (callers pass `total / people`); other modes
 * pass the total.
 */
export function billingSummaryLine(input: { people: number; amountCents: number; mode: SplitMode; dueLabel: string }): string {
  const people = `${input.people} pessoa${input.people === 1 ? '' : 's'}`;
  const money = formatMoney({ amountCents: input.amountCents, currency: 'BRL' });
  const amount = input.mode === 'equal' ? `${money} cada` : `${money} total`;

  return `${people} · ${amount} · vence ${input.dueLabel.toLowerCase()}`;
}
