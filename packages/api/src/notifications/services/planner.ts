import { addCalendarDays, type BillingReminder } from '@receivy/common';

export interface NotificationConfig {
  publicOrigin: string;
  secret: string;
  from?: string;
  pushAvailable?: boolean;
}

/** Only the fields the notice pipeline reads; the HTTP provider and every scheduler expose them. */
export interface NotificationVariables {
  PUBLIC_WEB_ORIGIN: string;
  PUBLIC_LINK_HMAC_SECRET: string;
  RESEND_FROM_EMAIL?: string;
  NOTIFICATION_PUSH_TRANSPORT?: string;
}

/** Reminders reach the recipient at 06:00 of the billing timezone. */
export const REMINDER_HOUR = 6;

/** A push that got no answer (no proof, charge still open) is followed by an e-mail this much later. */
export const EMAIL_FOLLOWUP_MS = 2 * 3600_000;

/** How far ahead the daily run plans reminders: one run per day, one window per run. */
export const PLAN_WINDOW_MS = 24 * 3600_000;

export function notificationConfigFrom(variables: NotificationVariables): NotificationConfig {
  return {
    publicOrigin: variables.PUBLIC_WEB_ORIGIN,
    secret: variables.PUBLIC_LINK_HMAC_SECRET,
    from: variables.RESEND_FROM_EMAIL,
    pushAvailable: variables.NOTIFICATION_PUSH_TRANSPORT === 'expo'
  };
}

export function civilDate(now: number, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
}

/** The instant of `date` at `hour:00` in `timezone`, as the wall clock there reads it. */
export function instantAt(date: string, hour: number, timezone: string): Date {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(year, month - 1, day, hour);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).formatToParts(new Date(guess));
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(read('year'), read('month') - 1, read('day'), read('hour'), read('minute'));

  return new Date(guess - (asUtc - guess));
}

export type InitialNoticeInput = { dueDate: string; now: number; timezone: string; reminders: BillingReminder[] };

/** A charge due today or earlier is announced at once; a later one waits for its first reminder, unless none is left to fire. */
export function shouldSendInitialNotice({ dueDate, now, timezone, reminders }: InitialNoticeInput): boolean {
  if (dueDate <= civilDate(now, timezone)) {
    return true;
  }

  const reachable = reminders.some((reminder) => {
    if (!reminder.enabled) {
      return false;
    }

    return instantAt(addCalendarDays(dueDate, reminder.offsetDays), REMINDER_HOUR, timezone).getTime() >= now;
  });

  return !reachable;
}
