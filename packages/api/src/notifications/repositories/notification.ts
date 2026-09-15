import { HttpBadRequestError, HttpForbiddenError, HttpNotFoundError } from '@ez4/gateway';
import { ChargePayer, ChargeState, DevicePlatform, type DeviceRegistration, Direction, type NotificationDevice } from '@receivy/common';
import { ChargeClosedError, ChargeInReviewError, SettledNoRemindersError } from '../../charges/errors';
import { ChargeRepository } from '../../charges/repositories/charge';
import { StoredProofState } from '../../charges/schemas/charge';
import { EventRepository } from '../../common/repositories/events';
import { EventableType } from '../../common/schemas/event';
import type { DbClient } from '../../database';
import { DeviceOwnedElsewhereError, DeviceRegisteredError, ReminderQuotaError } from '../errors';
import { type NoticeContext, NoticeTemplate, sendChargeNotice } from '../services/send';

async function audit(db: DbClient, userId: string, id: string, type: string) {
  await EventRepository.record(db, { type, eventableType: EventableType.Notification, eventableId: id, actorId: userId });
}

export namespace NotificationRepository {
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
      ![DevicePlatform.Ios, DevicePlatform.Android].includes(input.platform)
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
        !(await tx.session_families.findOne({
          select: { id: true },
          where: { id: familyId, user_id: userId, revoked_at: { isNull: true } }
        }))
      )
        throw new HttpForbiddenError();
      const token = await tx.device_tokens.findOne({
        select: { id: true, user_id: true },
        where: { token: input.token }
      });
      if (token && token.user_id !== userId) throw new DeviceOwnedElsewhereError();
      const existing = await tx.device_tokens.findOne({
        select: { id: true, created_at: true, token: true },
        where: { user_id: userId, installation_id: input.installationId }
      });
      if (token && token.id !== existing?.id) throw new DeviceRegisteredError();
      const now = new Date().toISOString();
      const id = existing?.id ?? crypto.randomUUID();
      if (existing) {
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
    const now = clock();

    await db.transaction(async (tx) => {
      const { row, direction } = await ChargeRepository.findForActor(tx, userId, chargeId, true);

      // Reminders belong to the creditor of a conta a receber; a conta a pagar reminds its own owner on schedule.
      if (direction !== Direction.Receivable || ChargeRepository.payer(row) === ChargePayer.Owner) {
        throw new HttpForbiddenError();
      }

      if (row.state !== ChargeState.Pending) {
        throw new ChargeClosedError();
      }

      const billing = await tx.billings.findOne({ select: { settled: true }, where: { id: row.billing_id } });

      // A registro has nobody to remind: the owner settled it on purpose.
      if (billing?.settled) {
        throw new SettledNoRemindersError();
      }

      if (row.proof_state === StoredProofState.Pending) {
        throw new ChargeInReviewError();
      }

      // Only a reminder that reached someone counts towards the daily quota.
      const recent = (await EventRepository.list(tx, chargeId, 'notice.sent')).filter(
        (event) => event.payload['template'] === NoticeTemplate.Manual && Date.parse(event.created_at) > now - 24 * 3600_000
      );

      if (recent.length) {
        throw new ReminderQuotaError();
      }

      await audit(tx, userId, chargeId, 'notifications.manual_reminder_requested');
    });

    // The creditor pressed the button: every channel at once, no follow-up. `queued` says whether any reached the debtor.
    const { channels } = await sendChargeNotice(db, notice, chargeId, NoticeTemplate.Manual, now, { channel: 'both' });

    return { queued: channels.length > 0 };
  }
}
