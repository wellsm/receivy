import type { DbClient } from '../database';
import { enforceQuota } from '../security/throttle';

export async function throttleProof(db: DbClient, capabilityOrUser: string, now = Date.now(), sourceIp = 'unknown-client') {
  await enforceQuota(db, `proof-ip:${sourceIp}`, 120, now);
  await enforceQuota(db, `capability:${capabilityOrUser}`, 12, now);
}
