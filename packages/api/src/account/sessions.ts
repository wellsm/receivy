import { HttpForbiddenError, HttpUnauthorizedError } from '@ez4/gateway';
import type { SessionIdentity } from '../authorizers/session';
import type { DbClient } from '../database';

export async function assertActiveSession(db: DbClient, identity: SessionIdentity) {
  const family = await db.session_families.findOne({
    select: { id: true },
    where: { id: identity.familyId, user_id: identity.userId, revoked_at: { isNull: true } }
  });
  const user = await db.users.findOne({ select: { id: true }, where: { id: identity.userId, deleted_at: { isNull: true } } });
  if (!family || !user) throw new HttpUnauthorizedError();
}

/** Caller owns transaction. Keep removal tombstones and accepted delivery observations. */
export async function disableSessionDevices(tx: DbClient, userId: string, familyId?: string) {
  const devices = await tx.device_tokens.findMany({
    select: { id: true },
    where: { user_id: userId, ...(familyId ? { OR: [{ session_family_id: familyId }, { session_family_id: { isNull: true } }] } : {}) }
  });
  const now = new Date().toISOString();
  for (const device of devices.records) {
    await tx.notification_deliveries.updateMany({
      where: { device_id: device.id, state: 'pending' },
      data: { state: 'suppressed', reason: 'session_revoked', render_inputs: '{}', updated_at: now }
    });
    await tx.device_tokens.updateOne({ where: { id: device.id }, data: { active: false, token: `removed:${device.id}`, updated_at: now } });
  }
}

export async function revokeSession(db: DbClient, userId: string, familyId: string) {
  await db.transaction(async (tx) => {
    await tx.users.findOne({ select: { id: true }, where: { id: userId }, lock: true });
    const family = await tx.session_families.findOne({ select: { user_id: true }, where: { id: familyId }, lock: true });
    if (!family || family.user_id !== userId) throw new HttpForbiddenError();
    const now = new Date().toISOString();
    await tx.session_families.updateOne({ where: { id: familyId }, data: { revoked_at: now } });
    await disableSessionDevices(tx, userId, familyId);
    await tx.activity_events.insertOne({
      data: {
        id: crypto.randomUUID(),
        subject_user: { id: userId },
        actor_user: { id: userId },
        type: 'account.session_revoked',
        aggregate_type: 'session',
        aggregate_id: familyId,
        payload: '{}',
        created_at: now
      }
    });
  });
}
