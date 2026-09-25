import { addCalendarDays, type ReminderRule } from '@receivy/common';
import { isWhatsappTransport, WhatsappTransport } from '../../vendors/whatsapp/client';
import type { TemplateNames } from '../../vendors/whatsapp/templates';
import { templateNamesFrom } from '../../vendors/whatsapp/templates';

export interface NotificationConfig {
  publicOrigin: string;
  /** Public origin of this API: the base of the webhook url the provider posts to. */
  apiOrigin: string;
  secret: string;
  /** The key that seals a provider credential, as `ensurePaymentLink` needs it. */
  credentialKeyB64: string;
  from?: string;
  pushAvailable?: boolean;
  /** Whether the WhatsApp transport can send at all; a rule that wants it is dropped as unavailable until it can. */
  whatsappAvailable: boolean;
  /** The WABA template names in force, as `buildChargeTemplate` needs them. */
  templates: TemplateNames;
}

/** Only the fields the notice pipeline reads; the HTTP provider and every scheduler expose them. */
export interface NotificationVariables {
  PUBLIC_WEB_ORIGIN: string;
  PUBLIC_API_ORIGIN?: string;
  PUBLIC_LINK_HMAC_SECRET: string;
  RESEND_FROM_EMAIL?: string;
  NOTIFICATION_PUSH_TRANSPORT?: string;
  APP_STAGE?: string;
  PAYMENT_METHOD_LINK?: string;
  PAYMENT_CREDENTIAL_KEY_B64?: string;
  WHATSAPP_TRANSPORT?: string;
  EVOLUTION_API_URL?: string;
  WHATSAPP_TEMPLATE_INITIAL?: string;
  WHATSAPP_TEMPLATE_REMINDER?: string;
  WHATSAPP_TEMPLATE_MANUAL?: string;
}

/** Reminders reach the recipient at 06:00 of the billing timezone. */
export const REMINDER_HOUR = 6;

/** How far ahead the daily run plans reminders: one run per day, one window per run. */
export const PLAN_WINDOW_MS = 24 * 3600_000;

/** Whether any WhatsApp transport is on: `disabled` (the default) and a typo both read as off. */
export function whatsappAvailableFrom(variables: { WHATSAPP_TRANSPORT?: string }): boolean {
  return isWhatsappTransport(variables.WHATSAPP_TRANSPORT) && variables.WHATSAPP_TRANSPORT !== WhatsappTransport.Disabled;
}

export function notificationConfigFrom(variables: NotificationVariables): NotificationConfig {
  return {
    publicOrigin: variables.PUBLIC_WEB_ORIGIN,
    apiOrigin: (variables.PUBLIC_API_ORIGIN ?? 'http://127.0.0.1:3735/local-receivy-api').replace(/\/+$/, ''),
    secret: variables.PUBLIC_LINK_HMAC_SECRET,
    credentialKeyB64: variables.PAYMENT_CREDENTIAL_KEY_B64 ?? 'disabled',
    from: variables.RESEND_FROM_EMAIL,
    pushAvailable: variables.NOTIFICATION_PUSH_TRANSPORT === 'expo',
    whatsappAvailable: whatsappAvailableFrom(variables),
    templates: templateNamesFrom(variables)
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

export type InitialNoticeInput = { dueDate: string; now: number; timezone: string; reminders: ReminderRule[] };

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
