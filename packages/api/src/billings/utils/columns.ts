import { BillingKind, type BillingRecurrence, Direction } from '@receivy/common';

/**
 * Readers of the billing columns block 8 renamed. They live outside the repository so the charge side can read
 * them without importing it (billing.ts imports ChargeRepository; a cycle takes the local server down).
 */

/** How the billing repeats. */
export function billingRecurrence(row: { recurrence: BillingRecurrence }): BillingRecurrence {
  return row.recurrence;
}

/** A live billing or a registro. */
export function billingKind(row: { kind: BillingKind }): BillingKind {
  return row.kind;
}

/** Which way the money goes: a receiving contact makes it the owner's own bill; without one the owner collects. */
export function billingDirection(row: { contact_id?: string }): Direction {
  return row.contact_id ? Direction.Payable : Direction.Receivable;
}

/** A registro: every charge settles on its due date and nobody is notified. */
export function billingRegistered(row: { kind: BillingKind }): boolean {
  return billingKind(row) === BillingKind.Record;
}
