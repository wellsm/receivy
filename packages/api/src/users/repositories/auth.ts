import type { AuthProvider } from '@receivy/common';
import type { DbClient } from '../../database';
import type { OauthProvider } from '../services/oauth';

const sqlNull = null as unknown as undefined;

export namespace AuthRepository {
  export type LoginCode = { id: string; code_hash: string; attempts: number; expires_at: string; consumed_at?: string; created_at: string };

  export type Attempt = { id: string; destination: string; code_verifier: string; client_challenge: string; nonce: string; expires_at: string; consumed_at?: string };

  export type Grant = { id: string; user_id: string; expires_at: string; consumed_at?: string };

  /**
   * Serializes the callers that share one e-mail for the rest of the transaction. No row exists on the first
   * code request, so a row lock has nothing to take: the advisory lock is what keeps SELECT-then-INSERT single.
   */
  export async function lockEmail(db: DbClient, key: string): Promise<void> {
    await db.rawQuery('SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))', { key });
  }

  /** The one code row of an address, taken under lock. */
  export async function loginCode(db: DbClient, email: string): Promise<LoginCode | null> {
    const row = await db.login_codes.findOne({
      select: { id: true, code_hash: true, attempts: true, expires_at: true, consumed_at: true, created_at: true },
      where: { email },
      lock: true
    });

    return row ?? null;
  }

  export async function insertLoginCode(db: DbClient, input: { email: string; codeHash: string; expiresAt: string; now: string }): Promise<void> {
    await db.login_codes.insertOne({
      select: { id: true },
      data: { id: crypto.randomUUID(), email: input.email, code_hash: input.codeHash, attempts: 0, expires_at: input.expiresAt, consumed_at: sqlNull, created_at: input.now }
    });
  }

  /** A fresh code over the old row: the counter restarts, the consumption is forgotten. */
  export async function replaceLoginCode(db: DbClient, id: string, input: { codeHash: string; expiresAt: string; now: string }): Promise<void> {
    await db.login_codes.updateOne({
      select: { id: true },
      where: { id },
      data: { code_hash: input.codeHash, attempts: 0, expires_at: input.expiresAt, consumed_at: sqlNull, created_at: input.now }
    });
  }

  export async function countLoginAttempt(db: DbClient, id: string, attempts: number): Promise<void> {
    await db.login_codes.updateOne({ select: { id: true }, where: { id }, data: { attempts } });
  }

  export async function consumeLoginCode(db: DbClient, id: string, now: string): Promise<void> {
    await db.login_codes.updateOne({ select: { id: true }, where: { id }, data: { consumed_at: now } });
  }

  export async function removeLoginCodes(db: DbClient, email: string): Promise<void> {
    await db.login_codes.deleteMany({ where: { email } });
  }

  /** Whose account a provider subject signs into; `lock` takes the identity for the caller's transaction. */
  export async function identityOwner(db: DbClient, provider: AuthProvider, subject: string, lock = false): Promise<string | null> {
    const row = await db.auth_identities.findOne({ select: { user_id: true }, where: { provider, provider_user_id: subject }, ...(lock ? { lock: true } : {}) });

    return row?.user_id ?? null;
  }

  export async function insertIdentity(db: DbClient, input: { userId: string; provider: AuthProvider; subject: string; email: string; now: string }): Promise<void> {
    await db.auth_identities.insertOne({
      select: { id: true },
      data: {
        id: crypto.randomUUID(),
        user: { id: input.userId },
        provider: input.provider,
        provider_user_id: input.subject,
        email: input.email,
        email_verified: true,
        created_at: input.now,
        updated_at: input.now
      }
    });
  }

  export async function removeIdentities(db: DbClient, userId: string): Promise<void> {
    await db.auth_identities.deleteMany({ where: { user_id: userId } });
  }

  export async function insertAttempt(
    db: DbClient,
    input: { provider: OauthProvider; stateHash: string; clientChallenge: string; destination: string; codeVerifier: string; nonce: string; expiresAt: string; now: string }
  ): Promise<void> {
    await db.oauth_attempts.insertOne({
      select: { id: true },
      data: {
        id: crypto.randomUUID(),
        provider: input.provider,
        state_hash: input.stateHash,
        client_challenge: input.clientChallenge,
        destination: input.destination,
        code_verifier: input.codeVerifier,
        nonce: input.nonce,
        expires_at: input.expiresAt,
        created_at: input.now
      }
    });
  }

  /** The attempt a provider callback answers, taken under lock. */
  export async function attempt(db: DbClient, provider: OauthProvider, stateHash: string): Promise<Attempt | null> {
    const row = await db.oauth_attempts.findOne({
      select: { id: true, destination: true, code_verifier: true, client_challenge: true, nonce: true, expires_at: true, consumed_at: true },
      where: { provider, state_hash: stateHash },
      lock: true
    });

    return row ?? null;
  }

  export async function consumeAttempt(db: DbClient, id: string, now: string): Promise<void> {
    await db.oauth_attempts.updateOne({ select: { id: true }, where: { id }, data: { consumed_at: now } });
  }

  export async function insertGrant(db: DbClient, input: { userId: string; grantHash: string; clientChallenge: string; expiresAt: string; now: string }): Promise<void> {
    await db.oauth_grants.insertOne({
      select: { id: true },
      data: { id: crypto.randomUUID(), user: { id: input.userId }, grant_hash: input.grantHash, client_challenge: input.clientChallenge, expires_at: input.expiresAt, created_at: input.now }
    });
  }

  /** The grant a client exchanges, taken under lock. */
  export async function grant(db: DbClient, grantHash: string, clientChallenge: string): Promise<Grant | null> {
    const row = await db.oauth_grants.findOne({
      select: { id: true, user_id: true, expires_at: true, consumed_at: true },
      where: { grant_hash: grantHash, client_challenge: clientChallenge },
      lock: true
    });

    return row ?? null;
  }

  export async function consumeGrant(db: DbClient, id: string, now: string): Promise<void> {
    await db.oauth_grants.updateOne({ select: { id: true }, where: { id }, data: { consumed_at: now } });
  }

  export async function removeGrants(db: DbClient, userId: string): Promise<void> {
    await db.oauth_grants.deleteMany({ where: { user_id: userId } });
  }
}
