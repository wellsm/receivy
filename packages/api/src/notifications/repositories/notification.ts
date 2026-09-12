import { Order } from '@ez4/database';
import { HttpBadRequestError, HttpConflictError, HttpError, HttpForbiddenError, HttpNotFoundError } from '@ez4/gateway';
import type { DeviceRegistration, NotificationDelivery, NotificationDevice } from '@receivy/common';
import { findChargeForActor } from '../charges/repository';
import type { DbClient } from '../database';
import { enqueueDue, type NoticeContext, planNotice } from './planner';

async function audit(db: DbClient, userId: string, id: string, type: string) {
  await db.activity_events.insertOne({
    data: {
      id: crypto.randomUUID(),
      actor_user: { id: userId },
      subject_user: { id: userId },
      type,
      aggregate_type: 'notification',
      aggregate_id: id,
      payload: '{}',
      created_at: new Date().toISOString()
    }
  });
}
export async function registerDevice(
  db: DbClient,
  userId: string,
  input: DeviceRegistration,
  familyId?: string
): Promise<NotificationDevice> {
  if (
    !/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/.test(input.token) ||
    input.token.length > 300 ||
    !/^[A-Za-z0-9_-]{1,100}$/.test(input.installationId) ||
    !['ios', 'android'].includes(input.platform)
  )
    throw new HttpBadRequestError('Dispositivo inválido.');
  return db.transaction(async (tx) => {
    if (
      !(await tx.users.findOne({
        select: { id: true },
        where: { id: userId, deleted_at: { isNull: true } },
        lock: true
      }))
    )
      throw new HttpNotFoundError();
    if (
      familyId &&
      !(await tx.session_families.findOne({ select: { id: true }, where: { id: familyId, user_id: userId, revoked_at: { isNull: true } } }))
    )
      throw new HttpForbiddenError();
    const token = await tx.device_tokens.findOne({
      select: { id: true, user_id: true },
      where: { token: input.token }
    });
    if (token && token.user_id !== userId) throw new HttpConflictError('O dispositivo deve ser removido da conta anterior.');
    const existing = await tx.device_tokens.findOne({
      select: { id: true, created_at: true, token: true },
      where: { user_id: userId, installation_id: input.installationId }
    });
    if (token && token.id !== existing?.id) throw new HttpConflictError('Dispositivo já registrado.');
    const now = new Date().toISOString();
    const id = existing?.id ?? crypto.randomUUID();
    if (existing) {
      // Never retarget a queued push to a different token after registration rotation.
      if (existing.token !== input.token)
        await tx.notification_deliveries.updateMany({
          where: { device_id: id, state: 'pending' },
          data: {
            state: 'suppressed',
            reason: 'device_changed',
            updated_at: now
          }
        });
      await tx.device_tokens.updateOne({
        where: { id },
        data: {
          token: input.token,
          session_family_id: familyId,
          platform: input.platform,
          active: true,
          updated_at: now
        }
      });
    } else
      await tx.device_tokens.insertOne({
        data: {
          id,
          user: { id: userId },
          token: input.token,
          installation_id: input.installationId,
          session_family_id: familyId,
          platform: input.platform,
          active: true,
          created_at: now,
          updated_at: now
        }
      });
    await audit(tx, userId, id, 'notifications.device_registered');
    return {
      id,
      platform: input.platform,
      active: true,
      createdAt: existing?.created_at ?? now
    };
  });
}
export async function manualReminder(
  db: DbClient,
  userId: string,
  chargeId: string,
  notice: NoticeContext,
  clock = Date.now
): Promise<{ queued: boolean }> {
  const dueDeliveryIds: string[] = [];

  const result = await db.transaction(async (tx) => {
    const { row, direction } = await findChargeForActor(tx, userId, chargeId, true);

    if (direction !== 'receivable') {
      throw new HttpForbiddenError();
    }

    if (row.state !== 'pending') {
      throw new HttpConflictError('Cobrança encerrada.');
    }

    const now = clock();

    if (
      await tx.notification_deliveries.count({
        where: {
          charge_id: chargeId,
          template: 'manual',
          created_at: { gt: new Date(now - 24 * 3600_000).toISOString() }
        }
      })
    ) {
      throw new HttpError(429, 'Aguarde 24 horas antes de enviar outro lembrete.');
    }

    const planned = await planNotice(tx, row, `charge:${chargeId}:manual:${crypto.randomUUID()}`, 'manual', notice.config, now);

    dueDeliveryIds.push(...planned.due);

    await audit(tx, userId, chargeId, 'notifications.manual_reminder_requested');

    return { queued: true };
  });

  // The rows are committed before the queue learns about them; a lost send is recovered by the cron.
  await enqueueDue(db, notice.queue, dueDeliveryIds, clock());

  return result;
}
export async function listDeliveries(db: DbClient, userId: string, chargeId: string): Promise<NotificationDelivery[]> {
  await findChargeForActor(db, userId, chargeId);
  const rows = await db.notification_deliveries.findMany({
    select: {
      id: true,
      channel: true,
      template: true,
      state: true,
      attempts: true,
      reason: true,
      updated_at: true
    },
    where: { charge_id: chargeId },
    order: { created_at: Order.Desc },
    take: 100
  });
  return rows.records.map((row) => ({
    id: row.id,
    channel: row.channel,
    template: row.template,
    state: row.state,
    attempts: row.attempts,
    reason: row.reason ?? null,
    updatedAt: row.updated_at
  }));
}
