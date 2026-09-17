import { BillingKind, BillingRecurrence } from './billing';
import {
  ownerPays,
  ChargeState,
  type ChargeSummary,
  Direction,
  ProofKind,
  ProofState
} from './contracts';

export enum BadgeTone {
  Danger = 'danger',
  Info = 'info',
  Success = 'success',
  Warning = 'warning',
  Neutral = 'neutral'
}

export enum ChargeActionKind {
  Remind = 'remind',
  MarkPaid = 'mark_paid',
  DeclarePayment = 'declare_payment'
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

  return sameYear
    ? `${day} de ${month}`
    : `${day} de ${month} de ${date.slice(0, 4)}`;
}

/** The "Registro" seal rides beside whatever else the card says. */
function registroBadges(charge: ChargeSummary): ChargeBadge[] {
  if (charge.kind !== BillingKind.Record) {
    return [];
  }

  return [{ label: 'Registro', tone: BadgeTone.Neutral }];
}

export function chargeBadges(
  charge: ChargeSummary,
  today: string,
  /** The viewer's side of the charge; without it the "Minha conta" badge cannot be told and is left out. */
  direction?: Direction
): ChargeBadge[] {
  if (charge.state === ChargeState.Cancelled) {
    return [
      { label: 'Cancelado', tone: BadgeTone.Neutral },
      ...registroBadges(charge)
    ];
  }

  if (charge.state === ChargeState.Paid) {
    return [
      charge.proofState === ProofState.Accepted
        ? { label: 'Validado', tone: BadgeTone.Success }
        : { label: 'Pago', tone: BadgeTone.Success },
      ...registroBadges(charge)
    ];
  }

  const badges: ChargeBadge[] = [];

  if (charge.recurrence === BillingRecurrence.Indefinite) {
    badges.push({ label: 'Recorrente', tone: BadgeTone.Neutral });
  } else if (
    charge.installment !== null &&
    charge.installmentCount !== null &&
    charge.installmentCount > 1
  ) {
    badges.push({
      label: `Parcela ${charge.installment} de ${charge.installmentCount}`,
      tone: BadgeTone.Neutral
    });
  }

  if (charge.dueDate < today) {
    badges.push({ label: 'Atrasado', tone: BadgeTone.Danger });
  } else if (charge.dueDate === today) {
    badges.push({ label: 'Vence hoje', tone: BadgeTone.Danger });
  }

  if (charge.proofState === ProofState.Pending) {
    badges.push({
      label:
        charge.proofKind === ProofKind.Declaration
          ? 'Pagamento informado'
          : 'Comprovante enviado',
      tone: BadgeTone.Info
    });
  }

  if (direction && charge.ownedByViewer && ownerPays({ direction, ownedByViewer: true })) {
    badges.push({ label: 'Minha conta', tone: BadgeTone.Info });
  }

  badges.push(...registroBadges(charge));

  return badges;
}

export function chargeStateLabel(
  charge: ChargeSummary,
  direction: Direction
): string {
  if (charge.state === ChargeState.Cancelled) {
    return 'Cancelado';
  }

  if (charge.state === ChargeState.Paid) {
    return 'Liquidado';
  }

  if (charge.proofState === ProofState.Pending) {
    return 'Em análise';
  }

  return direction === Direction.Receivable ? 'A receber' : 'A pagar';
}

/**
 * The action a feed card runs in place, behind a confirmation. Null means the card only opens the
 * charge (shown as an arrow): settled charges, proofs to review and anything that needs the detail screen.
 */
export function chargeAction(
  charge: ChargeSummary,
  direction: Direction
): ChargeAction | null {
  if (charge.state !== ChargeState.Pending) {
    return null;
  }

  if (charge.proofState === ProofState.Pending) {
    return null;
  }

  const ownBill = ownerPays({ direction, ownedByViewer: charge.ownedByViewer });

  if (direction === Direction.Receivable) {
    // The payee of a conta a pagar only confirms; reminders belong to whoever collects, and only
    // reach someone with an address on file.
    // A registro has nobody to remind either.
    if (
      ownBill ||
      charge.counterpartReachable === false ||
      charge.kind === BillingKind.Record
    ) {
      return null;
    }

    return { kind: ChargeActionKind.Remind, label: 'Lembrar' };
  }

  // Without a Pix key there is nothing to pay from the detail: the owner settles their own bill by hand,
  // or declares it when the payee has to confirm.
  if (ownBill && charge.ownedByViewer && !charge.hasPix) {
    return charge.confirmationRequired
      ? { kind: ChargeActionKind.DeclarePayment, label: 'Marcar pago' }
      : { kind: ChargeActionKind.MarkPaid, label: 'Marcar pago' };
  }

  return null;
}
