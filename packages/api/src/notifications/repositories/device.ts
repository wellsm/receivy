import type { DevicePlatform } from '@receivy/common';
import type { DbClient } from '../../database';

export namespace DeviceRepository {
  /** The registration a push token belongs to, whoever's it is. */
  export async function byToken(db: DbClient, token: string): Promise<{ id: string; user_id: string } | null> {
    const row = await db.device_tokens.findOne({ select: { id: true, user_id: true }, where: { token } });

    return row ?? null;
  }

  /** What this person registered from this installation before, if anything. */
  export async function byInstallation(db: DbClient, userId: string, installationId: string): Promise<{ id: string; token: string; created_at: string } | null> {
    const row = await db.device_tokens.findOne({ select: { id: true, token: true, created_at: true }, where: { user_id: userId, installation_id: installationId } });

    return row ?? null;
  }

  export async function insert(
    db: DbClient,
    input: { id: string; userId: string; token: string; installationId: string; familyId?: string; platform: DevicePlatform; now: string }
  ): Promise<void> {
    await db.device_tokens.insertOne({
      data: {
        id: input.id,
        user: { id: input.userId },
        token: input.token,
        installation_id: input.installationId,
        session_family_id: input.familyId,
        platform: input.platform,
        active: true,
        created_at: input.now,
        updated_at: input.now
      }
    });
  }

  /** The same installation registered again: the token, session and platform follow, and the device is live. */
  export async function refresh(db: DbClient, id: string, input: { token: string; familyId?: string; platform: DevicePlatform }, now: string): Promise<void> {
    await db.device_tokens.updateOne({
      where: { id },
      data: { token: input.token, session_family_id: input.familyId, platform: input.platform, active: true, updated_at: now }
    });
  }

  /** The devices a push can still reach, ten at most. */
  export async function active(db: DbClient, userId: string): Promise<{ id: string; token: string }[]> {
    const { records } = await db.device_tokens.findMany({ select: { id: true, token: true }, where: { user_id: userId, active: true }, take: 10 });

    return records;
  }

  /**
   * Every device of the person, or those of one session family plus the ones no family claimed, is switched
   * off; the row keeps its tombstone and the deliveries it observed. The caller owns the transaction.
   */
  export async function disableOf(db: DbClient, userId: string, familyId: string | undefined, now: string): Promise<void> {
    const { records } = await db.device_tokens.findMany({
      select: { id: true },
      where: { user_id: userId, ...(familyId ? { OR: [{ session_family_id: familyId }, { session_family_id: { isNull: true } }] } : {}) }
    });

    for (const device of records) {
      await db.device_tokens.updateOne({ where: { id: device.id }, data: { active: false, token: `removed:${device.id}`, updated_at: now } });
    }
  }

  /** The provider no longer knows the device: it is switched off, never retried. */
  export async function deactivate(db: DbClient, id: string, now: string): Promise<void> {
    await db.device_tokens.updateOne({ where: { id }, data: { active: false, updated_at: now } });
  }
}
