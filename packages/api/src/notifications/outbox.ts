import { createHash, randomBytes } from 'node:crypto';
import { Order } from '@ez4/database';
import { addCalendarDays, civilHour, zonedInstant } from '@receivy/common';
import { effectiveReminders } from '../billings/repository';
import { CHARGE_SELECT, type ChargeRow } from '../charges/repository';
import type { DbClient } from '../database';
import { type RenderInputs, renderNotice } from './render';

export interface NotificationConfig {
  publicOrigin: string;
  secret: string;
  from?: string;
  pushAvailable?: boolean;
}
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');

/** Reminders reach the recipient at 09:00 of the billing timezone. */
export const REMINDER_HOUR = 9;

/** Distance between defensive civil-clock re-checks while a reminder is still early. */
export const REMINDER_RETRY_MS = 15 * 60_000;

/** A push notice gets this long to land before the e-mail follow-up becomes available. */
export const EMAIL_FOLLOWUP_MS = 2 * 3600_000;

const types = ['charge.created', 'charge.reminder', 'charge.manual_reminder'];
export function civilDate(now: number, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
}
export async function expandOutbox(db: DbClient, config: NotificationConfig, now: number) {
  const events = await db.outbox_events.findMany({
    select: { id: true, aggregate_id: true },
    where: {
      type: { isIn: types },
      state: 'pending',
      available_at: { lte: new Date(now).toISOString() }
    },
    order: { available_at: Order.Asc },
    take: 100
  });
  for (const event of events.records)
    await db.transaction(async (tx) => {
      // Shared lock order with manual reminders, capability changes and proof finalization.
      const charge = await tx.charges.findOne({
        select: CHARGE_SELECT,
        where: { id: event.aggregate_id },
        lock: true
      });
      const row = await tx.outbox_events.findOne({
        select: { id: true, state: true, type: true, payload: true },
        where: { id: event.id },
        lock: true
      });
      if (!row || row.state !== 'pending') return;
      const stamp = new Date(now).toISOString();
      if (!charge || !(await tx.users.findOne({ select: { id: true }, where: { id: charge.creditor_id, deleted_at: { isNull: true } } }))) {
        await tx.outbox_events.updateOne({
          where: { id: row.id },
          data: { state: 'failed', updated_at: stamp }
        });
        return;
      }
      if (row.type === 'charge.reminder') {
        const schedule = JSON.parse(row.payload) as {
          localDate: string;
          timezone: string;
        };
        const date = civilDate(now, schedule.timezone);
        const early = date < schedule.localDate || (date === schedule.localDate && civilHour(now, schedule.timezone) < REMINDER_HOUR);

        if (early) {
          await tx.outbox_events.updateOne({
            where: { id: row.id },
            data: { available_at: new Date(now + REMINDER_RETRY_MS).toISOString() }
          });
          return;
        }
      }
      if (row.type === 'charge.created' && !JSON.parse(row.payload).notificationResumed) await scheduleReminders(tx, charge, now);
      await planDelivery(tx, charge, row.id, row.type === 'charge.created' ? 'initial' : 'reminder', config, now);
      // This is outbox consumption only; remote status lives exclusively in deliveries.
      await tx.outbox_events.updateOne({
        where: { id: row.id },
        data: { state: 'delivered', updated_at: stamp }
      });
    });
}
async function scheduleReminders(db: DbClient, charge: ChargeRow, now: number) {
  if (charge.state !== 'pending') {
    return;
  }

  const billing = await db.billings.findOne({
    select: { owner_id: true, reminders: true, timezone: true },
    where: { id: charge.billing_id }
  });

  if (!billing) {
    return;
  }

  const offsets = effectiveReminders(billing)
    .filter((reminder) => reminder.enabled)
    .map((reminder) => reminder.offsetDays);

  for (const offset of offsets) {
    const localDate = addCalendarDays(charge.due_date, offset);

    // Scan starts at 09:00 local; the worker re-checks the civil clock defensively.
    await db.outbox_events.insertOne({
      data: {
        id: crypto.randomUUID(),
        aggregate_type: 'charge',
        aggregate_id: charge.id,
        type: 'charge.reminder',
        payload: JSON.stringify({ chargeId: charge.id, localDate, timezone: billing.timezone, offset }),
        state: 'pending',
        attempts: 0,
        available_at: zonedInstant(localDate, '09:00', billing.timezone),
        created_at: new Date(now).toISOString(),
        updated_at: new Date(now).toISOString()
      }
    });
  }
}
type Recipient = {
  channel: 'push' | 'email';
  key: string;
  deviceId?: string;
  availableAt: number;
  followup?: string;
};
async function planDelivery(
  db: DbClient,
  charge: ChargeRow,
  eventId: string,
  template: 'initial' | 'reminder',
  config: NotificationConfig,
  now: number
) {
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
  for (const recipient of recipients) {
    const key = digest(`${eventId}/${recipient.channel}/${recipient.key}`);
    const existing = await db.notification_deliveries.findOne({
      select: { id: true, reason: true, attempts: true },
      where: { idempotency_key: key }
    });
    const data = {
      id: crypto.randomUUID(),
      event_id: eventId,
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
      created_at: stamp,
      updated_at: stamp
    };
    if (existing?.reason === 'pix_required' && existing.attempts === 0) {
      const { id: _id, created_at: _created, ...updated } = data;
      await db.notification_deliveries.updateOne({ where: { id: existing.id }, data: updated });
    } else if (!existing) await db.notification_deliveries.insertOne({ data });
  }
}
