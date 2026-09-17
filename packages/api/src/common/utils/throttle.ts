import { createHash, createHmac } from 'node:crypto';
import { normalizeEmail } from '@receivy/common';
import type { DbClient } from '../../database';
import { TooManyRequestsError } from '../errors';

export async function consumeQuota(db: DbClient, scope: string, limit: number, now = Date.now()): Promise<boolean> {
  const id = createHash('sha256').update(scope).digest('hex');
  const rows = await db.rawQuery(
    `INSERT INTO proof_throttles (id, attempts, expires_at) VALUES (:id, 1, :expiry)
    ON CONFLICT (id) DO UPDATE SET attempts = CASE WHEN proof_throttles.expires_at <= :now THEN 1 ELSE LEAST(proof_throttles.attempts + 1, 1000000) END,
    expires_at = CASE WHEN proof_throttles.expires_at <= :now THEN :expiry ELSE proof_throttles.expires_at END RETURNING attempts`,
    { id, expiry: new Date(now + 600000).toISOString(), now: new Date(now).toISOString() }
  );
  return Number(rows[0]?.['attempts']) <= limit;
}

/** Five codes per normalized address per window; the 60 s cooldown in `replaceLoginCode` handles resends. */
export async function allowEmailCode(db: DbClient, email: string, secret: string): Promise<boolean> {
  const hash = createHmac('sha256', secret).update(normalizeEmail(email)).digest('hex');
  return consumeQuota(db, `otp-request-email:${hash}`, 5);
}

export async function enforceQuota(db: DbClient, scope: string, limit: number, now = Date.now()) {
  if (!(await consumeQuota(db, scope, limit, now))) {
    throw new TooManyRequestsError();
  }
}

/** Per-link budget of an anonymous read. Writers that reuse the same link get their own. */
export type TokenBucket = { scope: string; limit: number };

const PUBLIC_READ: TokenBucket = { scope: 'public-read', limit: 60 };

/** Accepting is idempotent and legitimately retried, so it gets a wider bucket of its own. */
export const INVITE_ACCEPT: TokenBucket = { scope: 'invite-accept', limit: 120 };

/**
 * Call only after the token was resolved: the key names what the token opened — the charge, or the
 * invite handle — so a guessed token costs one read and a 404, never a throttle row.
 */
export async function throttlePublicRead(db: DbClient, key: string, bucket = PUBLIC_READ) {
  await enforceQuota(db, `${bucket.scope}:${key}`, bucket.limit);
}
