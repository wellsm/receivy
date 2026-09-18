import { Direction, type PixKeyType } from '@receivy/common';
import type { PaymentMethodKind } from '../schemas/charge';

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
  method: PaymentMethodKind;
  type: PixKeyType;
  value: string;
  label: string;
};

/** How this charge is paid, frozen at the moment it was published. */
export function paymentOf(row: { payment_snapshot?: PaymentSnapshotColumns }): PaymentSnapshotColumns | null {
  return row.payment_snapshot ?? null;
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
