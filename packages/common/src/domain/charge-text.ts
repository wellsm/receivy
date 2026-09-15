import { BillingType } from './billing';
import {
  type ChargeDetail,
  ChargePayer,
  type ChargeProof,
  ChargeState,
  type ChargeSummary,
  Direction,
  ProofKind,
  ProofState
} from './contracts';
import { formatMoney } from './money';

export const enum ChargeTone {
  Success = 'success',
  Warning = 'warning',
  Info = 'info',
  Neutral = 'neutral',
  Danger = 'danger'
}

/** `2026-09-10` → `10/09/2026`, read as a calendar day regardless of the device timezone. */
export function chargeDateText(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
}

/** An instant → `10/09 às 14:32` in the given timezone, or the device one. */
export function momentText(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  const day = new Intl.DateTimeFormat('pt-BR', { timeZone, day: '2-digit', month: '2-digit' }).format(date);
  const time = new Intl.DateTimeFormat('pt-BR', { timeZone, hour: '2-digit', minute: '2-digit' }).format(date);

  return `${day} às ${time}`;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** "Parcela 2 de 3", "Recorrente" or "À vista": how this charge relates to its billing. */
export function chargeTypeLabel(charge: ChargeDetail): string {
  if (charge.billingType === BillingType.Until) {
    return `Parcela ${charge.installment ?? '?'} de ${charge.installmentCount ?? '?'}`;
  }

  if (charge.billingType === BillingType.Indefinite) {
    return 'Recorrente';
  }

  return 'À vista';
}

export function chargeStateTag(charge: ChargeDetail): { label: string; tone: ChargeTone } {
  if (charge.state === ChargeState.Paid) {
    return { label: 'Pago', tone: ChargeTone.Success };
  }

  if (charge.state === ChargeState.Cancelled) {
    return { label: 'Cancelada', tone: ChargeTone.Neutral };
  }

  return { label: 'Pendente', tone: ChargeTone.Warning };
}

/** The line under the amount: when it was paid, how late it is, or when it is due. */
export function chargeStatusLine(charge: ChargeDetail, today: string, timeZone?: string): { text: string; tone: ChargeTone } {
  if (charge.state === ChargeState.Paid) {
    return { text: charge.paidAt ? `Pago em ${momentText(charge.paidAt, timeZone)}` : 'Pago', tone: ChargeTone.Success };
  }

  if (charge.state === ChargeState.Cancelled) {
    return { text: 'Cancelada', tone: ChargeTone.Neutral };
  }

  const late = daysBetween(charge.dueDate, today);

  if (late > 0) {
    return { text: `Atrasada há ${late} dia${late === 1 ? '' : 's'}`, tone: ChargeTone.Danger };
  }

  if (late === 0) {
    return { text: 'Vence hoje', tone: ChargeTone.Warning };
  }

  return { text: `Vence em ${-late} dia${late === -1 ? '' : 's'}`, tone: ChargeTone.Warning };
}

export function proofStateLabel(proof: ChargeProof): { label: string; tone: ChargeTone } {
  if (proof.state === ProofState.Accepted) {
    return { label: 'Aceito', tone: ChargeTone.Success };
  }

  if (proof.state === ProofState.Rejected) {
    return { label: 'Rejeitado', tone: ChargeTone.Danger };
  }

  return { label: 'Em revisão', tone: ChargeTone.Warning };
}

/** What the card says under the file: a rejection and its reason, or a file the charge no longer needs. */
export function proofNote(charge: ChargeDetail): string | null {
  const proof = charge.proof;

  if (!proof) {
    return null;
  }

  if (proof.state === ProofState.Pending && charge.state === ChargeState.Paid) {
    return 'A cobrança foi paga por fora; este comprovante não foi avaliado.';
  }

  if (proof.state === ProofState.Pending && charge.state === ChargeState.Cancelled) {
    return 'A cobrança foi cancelada; este comprovante não foi avaliado.';
  }

  if (proof.state === ProofState.Rejected) {
    const reason = proof.reason ? `: ${proof.reason}.` : '.';
    const payerCanRetry = charge.state === ChargeState.Pending && charge.direction === Direction.Payable;

    if (proof.kind === ProofKind.Declaration) {
      return `Pagamento não identificado${reason}${payerCanRetry ? ' Você pode informar de novo ou enviar um comprovante.' : ''}`;
    }

    return `Comprovante rejeitado${reason}${payerCanRetry ? ' Você pode enviar outro arquivo.' : ''}`;
  }

  return null;
}

export function fileSizeText(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
  }

  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Pending with something waiting for an answer, a file or a declared payment: reminders and notices stop here. */
export function chargeInReview(charge: Pick<ChargeSummary, 'state' | 'proofState'>): boolean {
  return charge.state === ChargeState.Pending && charge.proofState === ProofState.Pending;
}

/** The paying side says it already paid: the debtor, or the owner of a conta a pagar whose payee can confirm. */
export function canDeclarePayment(charge: ChargeDetail): boolean {
  if (charge.direction !== Direction.Payable || charge.state !== ChargeState.Pending || chargeInReview(charge)) {
    return false;
  }

  return charge.payer !== ChargePayer.Owner || charge.confirmationRequired === true;
}

/** A debtor may send a file only while nothing is under review; a rejected one can be replaced. */
export function canUploadProof(charge: ChargeDetail): boolean {
  // A registro has nothing to prove: it was settled by the owner.
  if (charge.settled === true || charge.direction !== Direction.Payable || charge.state !== ChargeState.Pending) {
    return false;
  }

  if (charge.proof?.state !== ProofState.Pending) {
    return true;
  }

  // A declaration the viewer sent may still receive its file.
  return charge.proof.kind === ProofKind.Declaration && charge.proof.sentByViewer;
}

/** The sender may take back a file nobody reviewed yet, so another one can go up. */
export function canWithdrawProof(charge: ChargeDetail): boolean {
  if (charge.direction !== Direction.Payable || charge.state !== ChargeState.Pending) {
    return false;
  }

  return charge.proof?.state === ProofState.Pending && charge.proof.sentByViewer;
}

/** The creditor settles a pending proof; without one the charge is marked paid directly. */
export function canAcceptProof(charge: ChargeDetail): boolean {
  return charge.direction === Direction.Receivable && charge.state === ChargeState.Pending && charge.proof?.state === ProofState.Pending;
}

/** Whoever collects, plus the owner of a conta a pagar settling a bill nobody else has to confirm. */
export function canMarkPaid(charge: ChargeDetail): boolean {
  if (charge.state !== ChargeState.Pending) {
    return false;
  }

  return charge.direction === Direction.Receivable || (charge.ownedByViewer === true && charge.confirmationRequired !== true);
}

/** Whoever may settle a charge may also take the settlement back while it stands. */
export function canReopenCharge(charge: ChargeDetail): boolean {
  return charge.state === ChargeState.Paid && (charge.direction === Direction.Receivable || charge.ownedByViewer === true);
}

/** Reminders and public links belong to the creditor of a conta a receber only; a conta a pagar and a registro have neither. */
export function canRemind(charge: ChargeDetail): boolean {
  return (
    charge.settled !== true &&
    charge.state === ChargeState.Pending &&
    charge.direction === Direction.Receivable &&
    charge.payer !== ChargePayer.Owner &&
    !!charge.pix &&
    charge.counterpartReachable !== false &&
    // A file under review is the debtor's move already made; nagging now would be noise.
    charge.proofState !== ProofState.Pending
  );
}

/** The message the creditor forwards by hand: what, how much, when, and the public link to pay. */
export function chargeShareText(charge: Pick<ChargeSummary, 'description' | 'amount' | 'dueDate'>, url: string): string {
  return `${charge.description} · ${formatMoney(charge.amount)} · vence em ${chargeDateText(charge.dueDate)}\nPague pelo link: ${url}`;
}

export function canShare(charge: ChargeDetail): boolean {
  return (
    charge.settled !== true &&
    charge.state === ChargeState.Pending &&
    charge.direction === Direction.Receivable &&
    charge.payer !== ChargePayer.Owner &&
    !!charge.pix
  );
}

/** Only the owner cancels a single charge, and never on a conta a pagar: that one is ended as a whole. */
export function canCancelCharge(charge: ChargeDetail): boolean {
  return (
    charge.state === ChargeState.Pending &&
    charge.ownedByViewer !== false &&
    charge.direction === Direction.Receivable &&
    charge.payer !== ChargePayer.Owner
  );
}

/** Only the creditor of a conta a receber pauses the automatic notices of a pending charge; a registro has none to pause. */
export function canSilenceCharge(charge: ChargeDetail): boolean {
  return (
    charge.settled !== true &&
    charge.state === ChargeState.Pending &&
    charge.ownedByViewer !== false &&
    charge.direction === Direction.Receivable &&
    charge.payer !== ChargePayer.Owner
  );
}

/** "Vai pagar para você" / "Vai receber de você" / "Só você": the line under the counterpart's name. */
export function counterpartRoleLabel(charge: ChargeDetail): string {
  if (charge.payer === ChargePayer.Owner) {
    if (charge.direction === Direction.Payable) {
      return charge.recipient.name && charge.counterpartName !== 'Você' ? 'Vai receber de você' : 'Conta só sua';
    }

    return 'Vai pagar para você';
  }

  return charge.direction === Direction.Receivable ? 'Vai pagar para você' : 'Vai receber de você';
}
