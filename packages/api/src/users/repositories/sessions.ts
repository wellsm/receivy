import { HttpUnauthorizedError } from '@ez4/gateway';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { DbClient } from '../../database';

const sqlNull = null as unknown as undefined;

export namespace SessionRepository {
  export type Family = { id: string; user_id: string; revoked_at?: string };

  export type RefreshToken = { id: string; family_id: string; expires_at: string; consumed_at?: string };

  /** Whether the session family still belongs to this person and was not revoked. */
  export async function familyLive(db: DbClient, userId: string, familyId: string): Promise<boolean> {
    const family = await db.session_families.findOne({ select: { id: true }, where: { id: familyId, user_id: userId, revoked_at: { isNull: true } } });

    return !!family;
  }

  export async function assertActive(db: DbClient, identity: SessionIdentity): Promise<void> {
    const family = await familyLive(db, identity.userId, identity.familyId);
    const user = await db.users.findOne({ select: { id: true }, where: { id: identity.userId, deleted_at: { isNull: true } } });

    if (!family || !user) {
      throw new HttpUnauthorizedError();
    }
  }

  export async function family(db: DbClient, id: string, lock = false): Promise<Family | null> {
    const row = await db.session_families.findOne({ select: { id: true, user_id: true, revoked_at: true }, where: { id }, ...(lock ? { lock: true } : {}) });

    return row ?? null;
  }

  export async function familyIdsOf(db: DbClient, userId: string): Promise<string[]> {
    const { records } = await db.session_families.findMany({ select: { id: true }, where: { user_id: userId } });

    return records.map((row) => row.id);
  }

  export async function insertFamily(db: DbClient, input: { id: string; userId: string; deviceName?: string; now: string }): Promise<void> {
    await db.session_families.insertOne({
      select: { id: true },
      data: { id: input.id, user: { id: input.userId }, device_name: input.deviceName, created_at: input.now, last_seen_at: input.now }
    });
  }

  export async function revokeFamily(db: DbClient, id: string, now: string): Promise<void> {
    await db.session_families.updateOne({ select: { id: true }, where: { id }, data: { revoked_at: now } });
  }

  /** Every session of the person ends and forgets the device it was named after. */
  export async function revokeAllOf(db: DbClient, userId: string, now: string): Promise<void> {
    await db.session_families.updateMany({ where: { user_id: userId }, data: { revoked_at: now, device_name: sqlNull } });
  }

  export async function touchFamily(db: DbClient, id: string, now: string): Promise<void> {
    await db.session_families.updateOne({ select: { id: true }, where: { id }, data: { last_seen_at: now } });
  }

  /** The token behind a hash, in whatever state it was left; `lock` takes the row for the caller's transaction. */
  export async function refreshToken(db: DbClient, tokenHash: string): Promise<RefreshToken | null> {
    const row = await db.refresh_tokens.findOne({ select: { id: true, family_id: true, expires_at: true, consumed_at: true }, where: { token_hash: tokenHash } });

    return row ?? null;
  }

  export async function refreshTokenById(db: DbClient, id: string, lock = false): Promise<RefreshToken | null> {
    const row = await db.refresh_tokens.findOne({ select: { id: true, family_id: true, expires_at: true, consumed_at: true }, where: { id }, ...(lock ? { lock: true } : {}) });

    return row ?? null;
  }

  export async function insertRefreshToken(db: DbClient, input: { familyId: string; tokenHash: string; expiresAt: string; now: string }): Promise<void> {
    await db.refresh_tokens.insertOne({
      select: { id: true },
      data: { id: crypto.randomUUID(), family: { id: input.familyId }, token_hash: input.tokenHash, expires_at: input.expiresAt, created_at: input.now }
    });
  }

  export async function consumeRefreshToken(db: DbClient, id: string, now: string): Promise<void> {
    await db.refresh_tokens.updateOne({ select: { id: true }, where: { id }, data: { consumed_at: now } });
  }

  export async function removeRefreshTokensOf(db: DbClient, familyIds: string[]): Promise<void> {
    if (!familyIds.length) {
      return;
    }

    await db.refresh_tokens.deleteMany({ where: { family_id: { isIn: familyIds } } });
  }
}
