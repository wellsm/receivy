import { BillingKind, type BillingType } from '@receivy/common';

/**
 * Block 8 readers of the renamed billing columns. They live outside the repository so the charge side can read
 * them without importing it (billing.ts imports ChargeRepository; a cycle takes the local server down).
 */

/** How the billing repeats. `recurrence` since block 8; `type` still carries it until the backfill runs and the column goes. */
export function billingRecurrence(row: { type: BillingType; recurrence?: BillingType }): BillingType {
  return row.recurrence ?? row.type;
}

/** A live billing or a registro. Rows from before block 8 say it with `settled`, which is no longer written. */
export function billingKind(row: { kind?: BillingKind; settled?: boolean }): BillingKind {
  return row.kind ?? (row.settled ? BillingKind.Record : BillingKind.Live);
}

/** A registro: every charge settles on its due date and nobody is notified. */
export function billingRegistered(row: { kind?: BillingKind; settled?: boolean }): boolean {
  return billingKind(row) === BillingKind.Record;
}
