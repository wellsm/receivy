import { Direction, type PaymentLink, PaymentLinkState, PaymentProvider, type PaymentSnapshot, type PixKeyType } from '@receivy/common';

/**
 * Readers of the charge columns that say who is who and how it is paid. They live outside the repository so
 * services and other repositories can read a row without going through the database layer.
 */

/** The columns that say who is who on a charge. */
export type Axis = {
  /** The billing owner, whichever side of the money they are on. */
  owner_id: string;
  /** Who receives; undefined on a conta a pagar without a payee. */
  creditor_id?: string;
  /** Who pays; undefined on a registro with nobody on the other side. */
  debtor_id?: string;
};

export type PaymentSnapshotColumns = {
  provider: PaymentProvider;
  kind?: PixKeyType | null;
  value: string;
  label: string;
  integrationId?: string;
};

/** How this charge is paid, frozen at the moment it was published. */
export function paymentOf(row: { payment_snapshot?: PaymentSnapshotColumns }): PaymentSnapshotColumns | null {
  return row.payment_snapshot ?? null;
}

/** The snapshot as clients read it. */
export function snapshotDto(payment: PaymentSnapshotColumns | null): PaymentSnapshot | null {
  return payment ? { provider: payment.provider, kind: payment.kind ?? null, value: payment.value, label: payment.label } : null;
}

/** The checkout link of a charge paid through a provider (InfinitePay, PagBank); a Pix charge has none. A link never asked for reads as pending. */
export function paymentLinkOf(row: { payment_snapshot?: PaymentSnapshotColumns; payment_link_url?: string; payment_link_state?: PaymentLinkState }): PaymentLink | null {
  if (!row.payment_snapshot || row.payment_snapshot.provider === PaymentProvider.Pix) {
    return null;
  }

  return { url: row.payment_link_url ?? null, state: row.payment_link_state ?? PaymentLinkState.Pending };
}

/** The owner of the billing behind the charge: every owner power keys on this, never on direction. */
export function ownerOf(row: Axis): string {
  return row.owner_id;
}

/** Who receives; undefined on a conta a pagar without a payee. */
export function creditorOf(row: Axis): string | undefined {
  return row.creditor_id;
}

/** Who pays; undefined on a registro with nobody on the other side. */
export function debtorOf(row: Axis): string | undefined {
  return row.debtor_id;
}

/** A conta a pagar: the owner is the one who pays. */
export function ownerPays(row: Axis): boolean {
  const debtorId = debtorOf(row);

  return debtorId !== undefined && debtorId === ownerOf(row);
}

/** The person on the other side of the owner, whichever side of the money they are on; undefined when there is none. */
export function counterpartId(row: Axis): string | undefined {
  return ownerPays(row) ? creditorOf(row) : debtorOf(row);
}

export function owns(row: Axis, userId: string): boolean {
  return ownerOf(row) === userId;
}

/** Direction is derived, never stored: whoever sits in `creditor_id` collects, anyone else on the charge pays. */
export function directionOf(row: Axis, userId: string): Direction {
  return creditorOf(row) === userId ? Direction.Receivable : Direction.Payable;
}
