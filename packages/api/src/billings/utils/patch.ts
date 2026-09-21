import { addCalendarDays, BillingKind, type BillingPatch, BillingRecurrence, BillingState, Direction } from '@receivy/common';
import {
  BillingEndedError,
  BillingNotPausableError,
  BillingSnapshotLockedError,
  EditScopeNotRecurringError,
  PayableHasNoSplitError,
  PendingChargesWithoutStateError,
  ReceivableHasNoPayeeError,
  SettledLockedError
} from '../errors';
import type { BillingRepository } from '../repositories/billing';
import { billingDirection, billingRecurrence, billingRegistered } from './columns';

export function assertPatchAllowed(row: BillingRepository.Row, patch: BillingPatch): void {
  if (row.state === BillingState.Ended) {
    throw new BillingEndedError();
  }

  const settled = billingRegistered(row);

  // A registro stays a registro.
  if (patch.kind !== undefined && (patch.kind === BillingKind.Record) !== settled) {
    throw new SettledLockedError();
  }

  // What creation refused stays out: nobody to split with, pay through or remind.
  const crowded =
    patch.split !== undefined ||
    patch.paymentMethodId !== undefined ||
    patch.contactId !== undefined ||
    patch.reminders !== undefined ||
    patch.clearReminders !== undefined ||
    patch.clearPaymentMethod !== undefined;

  if (settled && crowded) {
    throw new SettledLockedError();
  }

  const settles = patch.state === BillingState.Paused || patch.state === BillingState.Ended;

  if (patch.pendingCharges !== undefined && !settles) {
    throw new PendingChargesWithoutStateError();
  }

  if (patch.applyTo !== undefined && billingRecurrence(row) !== BillingRecurrence.Indefinite) {
    throw new EditScopeNotRecurringError();
  }

  if (patch.state === BillingState.Paused && billingRecurrence(row) !== BillingRecurrence.Indefinite) {
    throw new BillingNotPausableError();
  }

  const payable = billingDirection(row) === Direction.Payable;

  // A conta a pagar has no split: whoever receives it is a contact, never a participant.
  if (payable && patch.split !== undefined) {
    throw new PayableHasNoSplitError();
  }

  // A conta a receber already charges other people: it never turns into the owner's own bill.
  if (!payable && patch.contactId !== undefined) {
    throw new ReceivableHasNoPayeeError();
  }

  const frozen =
    billingRecurrence(row) !== BillingRecurrence.Indefinite &&
    (patch.description !== undefined ||
      patch.totalCents !== undefined ||
      patch.split !== undefined ||
      patch.contactId !== undefined ||
      patch.startDate !== undefined ||
      patch.dueRule !== undefined);

  if (frozen) {
    throw new BillingSnapshotLockedError();
  }
}

/** Whether the patch changes anything a charge carries; reminders and category never reach a materialized charge. */
export function touchesCharges(patch: BillingPatch): boolean {
  return (
    patch.totalCents !== undefined ||
    patch.split !== undefined ||
    patch.description !== undefined ||
    patch.paymentMethodId !== undefined ||
    patch.clearPaymentMethod !== undefined ||
    patch.contactId !== undefined ||
    patch.startDate !== undefined ||
    patch.dueRule !== undefined
  );
}

/** The new due day only governs occurrences not generated yet: the cursor never moves backwards. */
export function rescheduledCursor(row: BillingRepository.Row, startDate: string, today: string): string {
  if (startDate < today) {
    throw new RangeError('O próximo vencimento não pode estar no passado.');
  }

  const boundary = addCalendarDays(startDate, -1);

  return (row.last_occurrence_date ?? boundary) > boundary ? row.last_occurrence_date! : boundary;
}

/** The event names are history already written: they keep the old wording on purpose. */
export function participantNotifyEvent(notify: boolean): string {
  return notify ? 'billing.participant_unsilenced' : 'billing.participant_silenced';
}
