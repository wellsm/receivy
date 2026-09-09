import { Order } from '@ez4/database';
import type { DbClient } from '../database';
import type { StorageMessage } from './queue';
import type { ReconciliableProofStorage } from './storage';

/** An object is a candidate only after the longest upload window plus clock skew. */
const GRACE = 24 * 3600_000;

/** Keys this cleanup owns: `temporary/<chargeId>/<intentId>` and `proofs/<chargeId>/<proofId>`. */
export const PROOF_KEY = /^(temporary|proofs)\/([a-f0-9-]{36})\/([a-f0-9-]{36})$/;

/** Bounded work per run; the next hourly pass restarts the scan from the first page. */
const MAX_PAGES = 20;

const PAGE_LIMIT = 100;

const INTENT_LIMIT = 100;

export type StorageSend = (message: StorageMessage) => Promise<void>;

/** True when a committed proof or a live upload intent still needs the object. */
export async function protectedObject(db: DbClient, key: string, chargeId: string | undefined, now: number): Promise<boolean> {
  if (await db.payment_proofs.count({ where: { object_key: key } })) {
    return true;
  }

  const horizon = new Date(now).toISOString();

  if (chargeId) {
    return !!(await db.upload_intents.count({ where: { charge_id: chargeId, state: 'pending', expires_at: { gt: horizon } } }));
  }

  return !!(await db.upload_intents.count({ where: { object_key: key, state: 'pending', expires_at: { gt: horizon } } }));
}

/**
 * A send only happens once its transaction is committed. A failed send leaves the intent
 * `expired` and its object unreferenced, so the next orphan scan queues the object again.
 */
async function publish(send: StorageSend, messages: StorageMessage[]): Promise<number> {
  let published = 0;

  for (const message of messages) {
    try {
      await send(message);

      published++;
    } catch {
      // Purpose only; object keys and owners never reach the logs.
      console.error('Proof deletion enqueue failed', { purpose: message.purpose });
    }
  }

  return published;
}

/** Expired temporary intents are discoverable without enumerating the bucket. */
async function expireIntents(db: DbClient, send: StorageSend, now: number): Promise<number> {
  const stamp = new Date(now).toISOString();

  const intents = await db.upload_intents.findMany({
    select: { id: true, charge_id: true, object_key: true },
    where: { state: 'pending', expires_at: { lt: new Date(now - GRACE).toISOString() } },
    order: { expires_at: Order.Asc },
    take: INTENT_LIMIT
  });

  const messages: StorageMessage[] = [];

  for (const intent of intents.records) {
    await db.transaction(async (tx) => {
      // Shared lock order with finalization, so an in-flight upload cannot lose its intent.
      await tx.charges.findOne({ select: { id: true }, where: { id: intent.charge_id }, lock: true });

      await tx.upload_intents.updateMany({
        where: { id: intent.id, state: 'pending', expires_at: { lte: stamp } },
        data: { state: 'expired' }
      });
    });

    messages.push({ objectKey: intent.object_key, chargeId: intent.charge_id, purpose: 'temporary' });
  }

  return publish(send, messages);
}

async function orphanMessage(db: DbClient, object: { key: string; modifiedAt: string }, now: number): Promise<StorageMessage | undefined> {
  const parsed = PROOF_KEY.exec(object.key);

  if (!parsed) {
    return undefined;
  }

  const modifiedAt = Date.parse(object.modifiedAt);

  if (!Number.isFinite(modifiedAt) || modifiedAt > now - GRACE) {
    return undefined;
  }

  const temporary = parsed[1] === 'temporary';

  const intent = temporary
    ? await db.upload_intents.findOne({ select: { charge_id: true }, where: { object_key: object.key } })
    : undefined;

  // An unknown temporary object cannot be tied to a charge; retain it conservatively.
  const chargeId = temporary ? intent?.charge_id : parsed[2];

  if (!chargeId) {
    return undefined;
  }

  const guarded = await db.transaction(async (tx) => {
    await tx.charges.findOne({ select: { id: true }, where: { id: chargeId }, lock: true });

    return protectedObject(tx, object.key, chargeId, now);
  });

  if (guarded) {
    return undefined;
  }

  return { objectKey: object.key, chargeId, purpose: temporary ? 'temporary' : 'orphan' };
}

/**
 * Body of `StorageCron`: expires stale intents and walks the bucket for unreferenced
 * objects. Nothing is deleted here; every candidate goes to `StorageQueue`, which
 * revalidates the reference before touching the object.
 */
export async function reconcileProofStorage(
  db: DbClient,
  storage: ReconciliableProofStorage,
  send: StorageSend,
  clock = Date.now
): Promise<{ expired: number; scanned: number; queued: number }> {
  const now = clock();
  const expired = await expireIntents(db, send, now);

  let cursor: string | undefined;
  let scanned = 0;
  let queued = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const listing = await storage.list(cursor);

    if (listing.objects.length > PAGE_LIMIT) {
      throw new Error('Storage listing exceeded bounded page.');
    }

    scanned += listing.objects.length;

    const messages: StorageMessage[] = [];

    for (const object of listing.objects) {
      const message = await orphanMessage(db, object, now);

      if (message) {
        messages.push(message);
      }
    }

    queued += await publish(send, messages);

    if (!listing.cursor) {
      break;
    }

    cursor = listing.cursor;
  }

  return { expired, scanned, queued };
}
