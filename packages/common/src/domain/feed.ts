import type { ChargeSummary, Direction } from './contracts';

export type BadgeTone = 'danger' | 'info' | 'success' | 'warning' | 'neutral';
export type ChargeBadge = { label: string; tone: BadgeTone };
export type ChargeAction = { kind: 'open' | 'remind'; label: string };

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
  if (charge.state === 'cancelled') {
    return [{ label: 'Cancelado', tone: 'neutral' }];
  }

  if (charge.state === 'paid') {
    return [charge.proofState === 'accepted' ? { label: 'Validado', tone: 'success' } : { label: 'Pago', tone: 'success' }];
  }

  const badges: ChargeBadge[] = [];

  if (charge.billingType === 'indefinite') {
    badges.push({ label: 'Recorrente', tone: 'neutral' });
  } else if (charge.installment !== null && charge.installmentCount !== null && charge.installmentCount > 1) {
    badges.push({ label: `Parcela ${charge.installment} de ${charge.installmentCount}`, tone: 'neutral' });
  }

  if (charge.dueDate < today) {
    badges.push({ label: 'Atrasado', tone: 'danger' });
  } else if (charge.dueDate === today) {
    badges.push({ label: 'Vence hoje', tone: 'danger' });
  }

  if (charge.proofState === 'pending') {
    badges.push({ label: 'Comprovante enviado', tone: 'info' });
  }

  if (charge.payer === 'owner' && charge.ownedByViewer) {
    badges.push({ label: 'Minha conta', tone: 'info' });
  }

  return badges;
}

export function chargeStateLabel(charge: ChargeSummary, direction: Direction): string {
  if (charge.state === 'cancelled') {
    return 'Cancelado';
  }

  if (charge.state === 'paid') {
    return 'Liquidado';
  }

  return direction === 'receivable' ? 'A receber' : 'A pagar';
}

/** The single call to action a feed card offers; null once the charge is settled. */
export function chargeAction(charge: ChargeSummary, direction: Direction): ChargeAction | null {
  if (charge.state !== 'pending') {
    return null;
  }

  const ownBill = charge.payer === 'owner';

  if (direction === 'receivable') {
    if (charge.proofState === 'pending') {
      return { kind: 'open', label: 'Ver comprovante' };
    }

    // The payee of a conta a pagar only confirms; reminders belong to whoever collects, and only
    // reach someone with an address on file.
    if (ownBill || charge.counterpartReachable === false) {
      return { kind: 'open', label: 'Ver cobrança' };
    }

    return { kind: 'remind', label: 'Lembrar' };
  }

  if (charge.proofState === 'pending') {
    return { kind: 'open', label: 'Ver cobrança' };
  }

  if (ownBill && charge.ownedByViewer && !charge.hasPix) {
    return { kind: 'open', label: 'Marcar pago' };
  }

  return { kind: 'open', label: 'Pagar via Pix' };
}
