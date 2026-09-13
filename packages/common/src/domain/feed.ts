import { BillingType } from './billing';
import { ChargePayer, ChargeState, type ChargeSummary, Direction, ProofState } from './contracts';

export const enum BadgeTone {
  Danger = 'danger',
  Info = 'info',
  Success = 'success',
  Warning = 'warning',
  Neutral = 'neutral'
}

export const enum ChargeActionKind {
  Open = 'open',
  Remind = 'remind'
}

export type ChargeBadge = { label: string; tone: BadgeTone };
export type ChargeAction = { kind: ChargeActionKind; label: string };

const MONTHS = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro'
];

function shiftDay(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);

  value.setUTCDate(value.getUTCDate() + days);

  return value.toISOString().slice(0, 10);
}

/** Group heading for the feed: relative for the three days around today, spelled out otherwise. */
export function feedDayLabel(date: string, today: string): string {
  if (date === today) {
    return 'Hoje';
  }

  if (date === shiftDay(today, 1)) {
    return 'Amanhã';
  }

  if (date === shiftDay(today, -1)) {
    return 'Ontem';
  }

  const day = Number(date.slice(8, 10));
  const month = MONTHS[Number(date.slice(5, 7)) - 1];
  const sameYear = date.slice(0, 4) === today.slice(0, 4);

  return sameYear ? `${day} de ${month}` : `${day} de ${month} de ${date.slice(0, 4)}`;
}

export function chargeBadges(charge: ChargeSummary, today: string): ChargeBadge[] {
  if (charge.state === ChargeState.Cancelled) {
    return [{ label: 'Cancelado', tone: BadgeTone.Neutral }];
  }

  if (charge.state === ChargeState.Paid) {
    return [
      charge.proofState === ProofState.Accepted
        ? { label: 'Validado', tone: BadgeTone.Success }
        : { label: 'Pago', tone: BadgeTone.Success }
    ];
  }

  const badges: ChargeBadge[] = [];

  if (charge.billingType === BillingType.Indefinite) {
    badges.push({ label: 'Recorrente', tone: BadgeTone.Neutral });
  } else if (charge.installment !== null && charge.installmentCount !== null && charge.installmentCount > 1) {
    badges.push({ label: `Parcela ${charge.installment} de ${charge.installmentCount}`, tone: BadgeTone.Neutral });
  }

  if (charge.dueDate < today) {
    badges.push({ label: 'Atrasado', tone: BadgeTone.Danger });
  } else if (charge.dueDate === today) {
    badges.push({ label: 'Vence hoje', tone: BadgeTone.Danger });
  }

  if (charge.proofState === ProofState.Pending) {
    badges.push({ label: 'Comprovante enviado', tone: BadgeTone.Info });
  }

  if (charge.payer === ChargePayer.Owner && charge.ownedByViewer) {
    badges.push({ label: 'Minha conta', tone: BadgeTone.Info });
  }

  return badges;
}

export function chargeStateLabel(charge: ChargeSummary, direction: Direction): string {
  if (charge.state === ChargeState.Cancelled) {
    return 'Cancelado';
  }

  if (charge.state === ChargeState.Paid) {
    return 'Liquidado';
  }

  return direction === Direction.Receivable ? 'A receber' : 'A pagar';
}

/** The single call to action a feed card offers; null once the charge is settled. */
export function chargeAction(charge: ChargeSummary, direction: Direction): ChargeAction | null {
  if (charge.state !== ChargeState.Pending) {
    return null;
  }

  const ownBill = charge.payer === ChargePayer.Owner;

  if (direction === Direction.Receivable) {
    if (charge.proofState === ProofState.Pending) {
      return { kind: ChargeActionKind.Open, label: 'Ver comprovante' };
    }

    // The payee of a conta a pagar only confirms; reminders belong to whoever collects, and only
    // reach someone with an address on file.
    if (ownBill || charge.counterpartReachable === false) {
      return { kind: ChargeActionKind.Open, label: 'Ver cobrança' };
    }

    return { kind: ChargeActionKind.Remind, label: 'Lembrar' };
  }

  if (charge.proofState === ProofState.Pending) {
    return { kind: ChargeActionKind.Open, label: 'Ver cobrança' };
  }

  if (ownBill && charge.ownedByViewer && !charge.hasPix) {
    return { kind: ChargeActionKind.Open, label: 'Marcar pago' };
  }

  return { kind: ChargeActionKind.Open, label: 'Pagar' };
}
