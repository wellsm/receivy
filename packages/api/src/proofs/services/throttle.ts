import { enforceQuota } from '../../common/utils/throttle';
import type { DbClient } from '../../database';

/** Twelve upload actions per link (or per user) per window. Call after the token was resolved. */
export async function throttleProof(db: DbClient, key: string, now = Date.now()) {
  await enforceQuota(db, `capability:${key}`, 12, now);
}
