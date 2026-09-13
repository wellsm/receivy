import { HttpForbiddenError, HttpUnauthorizedError } from '@ez4/gateway';
import type { SessionIdentity } from '../../common/authorizers/session';
import { EventRepository } from '../../common/repositories/events';
import { EventableType } from '../../common/schemas/event';
import type { DbClient } from '../../database';

export namespace SessionRepository {
  export async function assertActive(db: DbClient, identity: SessionIdentity) {
    const family = await db.session_families.findOne({
      select: { id: true },
      where: { id: identity.familyId, user_id: identity.userId, revoked_at: { isNull: true } }
    });
    const user = await db.users.findOne({ select: { id: true }, where: { id: identity.userId, deleted_at: { isNull: true } } });
    if (!family || !user) throw new HttpUnauthorizedError();
  }

  /** Caller owns transaction. Keep removal tombstones and accepted delivery observations. */
  export async function disableDevices(tx: DbClient, userId: string, familyId?: string) {
    const devices = await tx.device_tokens.findMany({
      select: { id: true },
      where: { user_id: userId, ...(familyId ? { OR: [{ session_family_id: familyId }, { session_family_id: { isNull: true } }] } : {}) }
    });
    const now = new Date().toISOString();
    for (const device of devices.records) {
      await tx.device_tokens.updateOne({
        where: { id: device.id },
        data: { active: false, token: `removed:${device.id}`, updated_at: now }
      });
    }
  }

  export async function revoke(db: DbClient, userId: string, familyId: string) {
    await db.transaction(async (tx) => {
      await tx.users.findOne({ select: { id: true }, where: { id: userId }, lock: true });
      const family = await tx.session_families.findOne({ select: { user_id: true }, where: { id: familyId }, lock: true });
      if (!family || family.user_id !== userId) throw new HttpForbiddenError();
      const now = new Date().toISOString();
      await tx.session_families.updateOne({ where: { id: familyId }, data: { revoked_at: now } });
      await disableDevices(tx, userId, familyId);
      await EventRepository.record(tx, {
        type: 'account.session_revoked',
        eventableType: EventableType.Account,
        eventableId: userId,
        actorId: userId,
        payload: { familyId },
        at: now
      });
    });
  }
}
