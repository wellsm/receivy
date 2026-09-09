import { createHash, createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { HttpError } from '@ez4/gateway';
import { normalizeEmail } from '@receivy/common';
import type { DbClient } from '../database';

/** Only provider metadata is trusted. Body, query and forwarded headers are not. */
export function trustedClientIp(request: object): string {
  const value = 'sourceIp' in request ? request.sourceIp : undefined;
  return typeof value === 'string' && isIP(value) ? value : 'unknown-client';
}

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

export async function allowEmailCode(db: DbClient, email: string, secret: string, request: object): Promise<boolean> {
  const hash = createHmac('sha256', secret).update(normalizeEmail(email)).digest('hex');
  const ip = await consumeQuota(db, `otp-request-ip:${trustedClientIp(request)}`, 30);
  const address = await consumeQuota(db, `otp-request-email:${hash}`, 5);
  return ip && address;
}

export async function enforceQuota(db: DbClient, scope: string, limit: number, now = Date.now()) {
  if (!(await consumeQuota(db, scope, limit, now))) throw new HttpError(429, 'Too many requests.');
}

/** Per-capability budget of an anonymous read. Writers that reuse the same token get their own. */
export type TokenBucket = { scope: string; limit: number };

const PUBLIC_READ: TokenBucket = { scope: 'public-read-token', limit: 60 };

/** Accepting is idempotent and legitimately retried, so it gets a wider bucket of its own. */
export const INVITE_ACCEPT: TokenBucket = { scope: 'invite-accept', limit: 120 };

export async function throttlePublicRead(db: DbClient, token: string, request: object, bucket = PUBLIC_READ) {
  await enforceQuota(db, `public-read-ip:${trustedClientIp(request)}`, 240);
  await enforceQuota(db, `${bucket.scope}:${token}`, bucket.limit);
}
