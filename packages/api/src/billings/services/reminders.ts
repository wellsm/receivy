import { type BillingReminder, DEFAULT_BILLING_REMINDERS } from '@receivy/common';

/** Kept apart from the repository so the notifier can read reminder settings without importing it. */
export function parseReminders(row: { reminders?: string }): BillingReminder[] | undefined {
  return row.reminders ? (JSON.parse(row.reminders) as BillingReminder[]) : undefined;
}

/** Offsets used for this billing: its own reminders, else the due-date-only default. */
export function effectiveReminders(row: { reminders?: string }): BillingReminder[] {
  return parseReminders(row) ?? DEFAULT_BILLING_REMINDERS;
}
