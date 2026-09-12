import { createHash, randomBytes } from 'node:crypto';
import { Order } from '@ez4/database';
import type { Client } from '@ez4/queue';
import { addCalendarDays, type BillingReminder } from '@receivy/common';
import type { ChargeRow } from '../charges/repository';
import type { DbClient } from '../database';
import { type RenderInputs, renderNotice } from './render';

export interface NotificationConfig {
  publicOrigin: string;
  secret: string;
  from?: string;
  pushAvailable?: boolean;
}

/** Only the fields the notice pipeline reads; both the HTTP provider and the queue expose them. */
export interface NotificationVariables {
  PUBLIC_WEB_ORIGIN: string;
  PUBLIC_LINK_HMAC_SECRET: string;
  RESEND_FROM_EMAIL?: string;
  NOTIFICATION_PUSH_TRANSPORT?: string;
}

export type NoticeMessage = { deliveryId: string };

/** Structural view of the queue client so producers never import the queue declaration. */
export type NoticeQueue = Pick<Client<NoticeMessage, { fairMode: true }>, 'sendMessage'>;

export type NoticeContext = { config: NotificationConfig; queue: NoticeQueue };

export type PlannedNotice = { deliveryIds: string[]; due: string[] };

export const digest = (value: string) => createHash('sha256').update(value).digest('hex');

/** Reminders reach the recipient at 09:00 of the billing timezone. */
export const REMINDER_HOUR = 9;

/** A push notice gets this long to land before the e-mail follow-up becomes available. */
export const EMAIL_FOLLOWUP_MS = 2 * 3600_000;

/** A delivery queued longer than this without settling is treated as a lost message. */
export const QUEUE_STALE_MS = 15 * 60_000;

const sqlNull = null as unknown as string | undefined;

export function civilDate(now: number, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
}

export function notificationConfigFrom(variables: NotificationVariables): NotificationConfig {
  return {
    publicOrigin: variables.PUBLIC_WEB_ORIGIN,
    secret: variables.PUBLIC_LINK_HMAC_SECRET,
    from: variables.RESEND_FROM_EMAIL,
    pushAvailable: variables.NOTIFICATION_PUSH_TRANSPORT === 'expo'
  };
}

/** Enabled offsets whose reminder date is exactly `today` in the billing timezone. */
export function dueReminderOffsets(reminders: BillingReminder[], dueDate: string, today: string): number[] {
  return reminders
    .filter((reminder) => reminder.enabled)
    .map((reminder) => reminder.offsetDays)
    .filter((offset) => addCalendarDays(dueDate, offset) === today);
}

type Recipient = {
  channel: 'push' | 'email';
  key: string;
  deviceId?: string;
  availableAt: number;
  followup?: string;
};

/**
 * Resolves recipient, devices, public link and suppressions for one notice and writes the
 * delivery rows. The idempotency key makes a repeated call for the same event key inert.
 */
export async function planNotice(
  db: DbClient,
  charge: ChargeRow,
  eventKey: string,
  template: 'initial' | 'reminder' | 'manual',
  config: NotificationConfig,
  now: number
): Promise<PlannedNotice> {
  const stamp = new Date(now).toISOString();

  const user = charge.recipient_user_id
    ? await db.users.findOne({
        select: { id: true },
        where: { id: charge.recipient_user_id, deleted_at: { isNull: true } }
      })
    : charge.recipient_email_snapshot
      ? await db.users.findOne({
          select: { id: true },
          where: {
            email: charge.recipient_email_snapshot,
            verified_email: charge.recipient_email_snapshot,
            deleted_at: { isNull: true }
          }
        })
      : undefined;

  const devices =
    user && config.pushAvailable !== false
      ? (
          await db.device_tokens.findMany({
            select: { id: true },
            where: { user_id: user.id, active: true },
            order: { created_at: Order.Desc },
            take: 10
          })
        ).records
      : [];

  let link = await db.public_links.findOne({
    select: {
      public_id: true,
      token_version: true,
      expires_at: true,
      revoked_at: true
    },
    where: { charge_id: charge.id }
  });

  const hasPix = !!charge.pix_key_snapshot && !!charge.pix_key_type_snapshot;

  if (!link && charge.state === 'pending' && hasPix) {
    link = await db.public_links.insertOne({
      select: {
        public_id: true,
        token_version: true,
        expires_at: true,
        revoked_at: true
      },
      data: {
        id: crypto.randomUUID(),
        charge: { id: charge.id },
        public_id: randomBytes(16).toString('base64url'),
        token_version: 1,
        expires_at: new Date(now + 90 * 86400_000).toISOString(),
        created_at: stamp,
        updated_at: stamp
      }
    });
  }

  const inputs: RenderInputs = {
    email: charge.recipient_email_snapshot,
    name: charge.recipient_name_snapshot,
    description: charge.description,
    cents: charge.amount_cents,
    dueDate: charge.due_date,
    publicId: link?.public_id ?? '',
    version: link?.token_version ?? 0,
    expires: link ? Math.floor(Date.parse(link.expires_at) / 1000) : 0,
    origin: config.publicOrigin,
    from: config.from ?? 'disabled'
  };

  const valid = charge.state === 'pending' && hasPix && link && !link.revoked_at && Date.parse(link.expires_at) > now;

  const reason =
    charge.state === 'pending' && !hasPix
      ? 'pix_required'
      : !valid
        ? 'charge_or_capability_inactive'
        : !devices.length && !inputs.email
          ? 'no_enabled_channel'
          : undefined;

  // Push goes out now; the e-mail only follows when the push has had two hours to land.
  const recipients: Recipient[] = devices.length
    ? [
        ...devices.map((device) => ({
          channel: 'push' as const,
          key: device.id,
          deviceId: device.id,
          availableAt: now
        })),
        ...(inputs.email
          ? [
              {
                channel: 'email' as const,
                key: inputs.email,
                deviceId: undefined,
                availableAt: now + EMAIL_FOLLOWUP_MS,
                followup: 'push_followup'
              }
            ]
          : [])
      ]
    : [
        {
          channel: 'email' as const,
          key: inputs.email ?? 'manual-only',
          deviceId: undefined,
          availableAt: now
        }
      ];

  const deliveryIds: string[] = [];
  const due: string[] = [];

  for (const recipient of recipients) {
    const key = digest(`${eventKey}/${recipient.channel}/${recipient.key}`);

    const existing = await db.notification_deliveries.findOne({
      select: { id: true, reason: true, attempts: true },
      where: { idempotency_key: key }
    });

    const data = {
      id: crypto.randomUUID(),
      event_id: eventKey,
      charge_id: charge.id,
      recipient_key: recipient.key,
      recipient_user_id: user?.id,
      device_id: recipient.deviceId,
      channel: recipient.channel,
      template,
      state: reason ? ('suppressed' as const) : ('pending' as const),
      reason: reason ?? recipient.followup ?? (null as unknown as undefined),
      render_inputs: JSON.stringify(inputs),
      body_hash: valid ? digest(JSON.stringify(renderNotice(inputs, template, config.secret))) : '',
      idempotency_key: key,
      attempts: 0,
      available_at: new Date(recipient.availableAt).toISOString(),
      queued_at: sqlNull,
      created_at: stamp,
      updated_at: stamp
    };

    if (existing?.reason === 'pix_required' && existing.attempts === 0) {
      const { id: _id, created_at: _created, ...updated } = data;

      await db.notification_deliveries.updateOne({ where: { id: existing.id }, data: updated });

      deliveryIds.push(existing.id);

      if (!reason && recipient.availableAt <= now) {
        due.push(existing.id);
      }

      continue;
    }

    if (existing) {
      continue;
    }

    await db.notification_deliveries.insertOne({ data });

    deliveryIds.push(data.id);

    if (!reason && recipient.availableAt <= now) {
      due.push(data.id);
    }
  }

  return { deliveryIds, due };
}

/** Publishes the already committed rows. A failed send leaves `queued_at` null for the cron. */
export async function enqueueDue(db: DbClient, queue: NoticeQueue, ids: string[], now: number): Promise<number> {
  if (!ids.length) {
    return 0;
  }

  const stamp = new Date(now).toISOString();

  let enqueued = 0;

  for (const deliveryId of ids) {
    try {
      await queue.sendMessage({ deliveryId });

      await db.notification_deliveries.updateOne({
        where: { id: deliveryId },
        data: { queued_at: stamp, updated_at: stamp }
      });

      enqueued++;
    } catch {
      // The row stays with a null/stale `queued_at`; the next cron pass publishes it again.
      console.error('Notification enqueue failed', { deliveryId });
    }
  }

  return enqueued;
}
