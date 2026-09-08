import { createHash, randomBytes } from 'node:crypto';
import { Order } from '@ez4/database';
import { addCalendarDays } from '@receivy/common';
import { CHARGE_SELECT, type ChargeRow } from '../charges/repository';
import type { DbClient } from '../database';
import { type RenderInputs, renderNotice } from './render';
import { getPreferences } from './repository';

export interface NotificationConfig {
  publicOrigin: string;
  secret: string;
  from?: string;
  pushAvailable?: boolean;
}
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
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
        if (civilDate(now, schedule.timezone) < schedule.localDate) {
          await tx.outbox_events.updateOne({
            where: { id: row.id },
            data: { available_at: new Date(now + 3600_000).toISOString() }
          });
          return;
        }
      }
      if (row.type === 'charge.created' && !JSON.parse(row.payload).notificationResumed)
        await scheduleReminders(
          tx,
          charge,
          now,
          (
            JSON.parse(row.payload) as {
              notificationSchedule?: { offsets: number[]; timezone: string };
            }
          ).notificationSchedule
        );
      await planDelivery(tx, charge, row.id, row.type === 'charge.created' ? 'initial' : 'reminder', config, now);
      // This is outbox consumption only; remote status lives exclusively in deliveries.
      await tx.outbox_events.updateOne({
        where: { id: row.id },
        data: { state: 'delivered', updated_at: stamp }
      });
    });
}
async function scheduleReminders(db: DbClient, charge: ChargeRow, now: number, snapshot?: { offsets: number[]; timezone: string }) {
  if (charge.state !== 'pending') return;
  const owner = await db.users.findOne({
    select: { timezone: true },
    where: { id: charge.creditor_id }
  });
  const occurrence = charge.source_occurrence_id
    ? await db.recurrence_occurrences.findOne({
        select: { reminders_json: true, timezone: true },
        where: { id: charge.source_occurrence_id }
      })
    : undefined;
  const timezone = occurrence?.timezone ?? snapshot?.timezone ?? owner?.timezone ?? 'America/Sao_Paulo';
  const offsets = occurrence
    ? (
        JSON.parse(occurrence.reminders_json) as {
          offsetDays: number;
          enabled: boolean;
        }[]
      )
        .filter((r) => r.enabled)
        .map((r) => r.offsetDays)
    : (snapshot?.offsets ?? (await getPreferences(db, charge.creditor_id)).reminderOffsets);
  for (const offset of offsets) {
    const localDate = addCalendarDays(charge.due_date, offset);
    // UTC midnight is an earliest scan, then the worker compares the stored civil day.
    await db.outbox_events.insertOne({
      data: {
        id: crypto.randomUUID(),
        aggregate_type: 'charge',
        aggregate_id: charge.id,
        type: 'charge.reminder',
        payload: JSON.stringify({
          chargeId: charge.id,
          localDate,
          timezone,
          offset
        }),
        state: 'pending',
        attempts: 0,
        available_at: new Date(`${localDate}T00:00:00Z`).toISOString(),
        created_at: new Date(now).toISOString(),
        updated_at: new Date(now).toISOString()
      }
    });
  }
}
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
  const preferences = user ? await getPreferences(db, user.id) : { emailEnabled: true, pushEnabled: false };
  const devices =
    user && preferences.pushEnabled && config.pushAvailable !== false
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
        : !devices.length && (!inputs.email || !preferences.emailEnabled)
          ? 'no_enabled_channel'
          : undefined;
  const recipients = devices.length
    ? devices.map((d) => ({
        channel: 'push' as const,
        key: d.id,
        deviceId: d.id
      }))
    : [
        {
          channel: 'email' as const,
          key: inputs.email ?? 'manual-only',
          deviceId: undefined
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
      reason: reason ?? (null as unknown as undefined),
      render_inputs: JSON.stringify(inputs),
      body_hash: valid ? digest(JSON.stringify(renderNotice(inputs, template, config.secret))) : '',
      idempotency_key: key,
      attempts: 0,
      available_at: stamp,
      created_at: stamp,
      updated_at: stamp
    };
    if (existing?.reason === 'pix_required' && existing.attempts === 0) {
      const { id: _id, created_at: _created, ...updated } = data;
      await db.notification_deliveries.updateOne({ where: { id: existing.id }, data: updated });
    } else if (!existing) await db.notification_deliveries.insertOne({ data });
  }
}
