import { BillingKind, type BillingType, Direction } from '@receivy/common';

/**
 * Readers of the billing columns block 8 renamed. They live outside the repository so the charge side can read
 * them without importing it (billing.ts imports ChargeRepository; a cycle takes the local server down).
 */

/** How the billing repeats. */
export function billingRecurrence(row: { recurrence: BillingType }): BillingType {
  return row.recurrence;
}

/** A live billing or a registro. */
export function billingKind(row: { kind: BillingKind }): BillingKind {
  return row.kind;
}

/**
 * Which way the money goes. `type` since block 8; `direction` still carries it until the backfill runs and the
 * column goes. Rows from before contas a pagar existed carry neither: the owner collects.
 */
export function billingDirection(row: { type?: Direction; direction?: Direction }): Direction {
  return row.type ?? row.direction ?? Direction.Receivable;
}

/** A registro: every charge settles on its due date and nobody is notified. */
export function billingRegistered(row: { kind: BillingKind }): boolean {
  return billingKind(row) === BillingKind.Record;
}
