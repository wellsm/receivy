import { Order } from "@ez4/database";
import type { DbClient } from "../database";
import type { ProofStorage, ReconciliableProofStorage } from "./storage";

const GRACE = 24 * 3600_000;
const KEY = /^(temporary|proofs)\/([a-f0-9-]{36})\/([a-f0-9-]{36})$/;
/** Caller owns the transaction and charge lock. Task6 must remove the reference/invalidate intents first.
 * No FK to user/charge: the journal survives account deletion and can retry after those rows disappear. */
export async function enqueueStorageDeletion(
  db: DbClient,
  input: {
    key: string;
    chargeId: string;
    purpose: "orphan" | "temporary" | "account";
  },
  now = Date.now(),
) {
  if (!KEY.test(input.key)) throw new RangeError("Invalid proof object key.");
  const existing = await db.storage_deletions.findOne({
    select: { id: true, state: true },
    where: { object_key: input.key },
  });
  const stamp = new Date(now).toISOString();
  if (existing) {
    if (existing.state === "blocked")
      await db.storage_deletions.updateOne({
        where: { id: existing.id },
        data: {
          state: "pending",
          attempts: 0,
          available_at: stamp,
          updated_at: stamp,
        },
      });
    return existing.id;
  }
  const id = crypto.randomUUID();
  await db.storage_deletions.insertOne({
    data: {
      id,
      object_key: input.key,
      charge_id: input.chargeId,
      purpose: input.purpose,
      state: "pending",
      attempts: 0,
      available_at: stamp,
      created_at: stamp,
      updated_at: stamp,
    },
  });
  return id;
}
async function protectedObject(
  db: DbClient,
  key: string,
  chargeId: string,
  now: number,
) {
  if (await db.payment_proofs.count({ where: { object_key: key } }))
    return true;
  return !!(await db.upload_intents.count({
    where: {
      charge_id: chargeId,
      state: "pending",
      expires_at: { gt: new Date(now).toISOString() },
    },
  }));
}
export async function reconcileProofStorage(
  db: DbClient,
  storage: ReconciliableProofStorage,
  clock = Date.now,
) {
  const now = clock();
  const stamp = new Date(now).toISOString();
  // Expired/finalized temporary intents are discoverable without bucket enumeration.
  const intents = await db.upload_intents.findMany({
    select: { id: true, charge_id: true, object_key: true },
    where: {
      state: "pending",
      expires_at: { lt: new Date(now - GRACE).toISOString() },
    },
    order: { expires_at: Order.Asc },
    take: 100,
  });
  for (const intent of intents.records)
    await db.transaction(async (tx) => {
      await tx.charges.findOne({
        select: { id: true },
        where: { id: intent.charge_id },
        lock: true,
      });
      await tx.upload_intents.updateMany({
        where: { id: intent.id, state: "pending", expires_at: { lte: stamp } },
        data: { state: "expired" },
      });
      await enqueueStorageDeletion(
        tx,
        {
          key: intent.object_key,
          chargeId: intent.charge_id,
          purpose: "temporary",
        },
        now,
      );
    });
  const progress = await db.storage_cleanup_cursors.findOne({
    select: { cursor: true },
    where: { id: "proof-objects" },
  });
  const page = await storage.list(progress?.cursor);
  if (page.objects.length > 100)
    throw new Error("Storage listing exceeded bounded page.");
  let queued = 0;
  for (const object of page.objects) {
    const parsed = KEY.exec(object.key);
    if (
      !parsed ||
      !Number.isFinite(Date.parse(object.modifiedAt)) ||
      Date.parse(object.modifiedAt) > now - GRACE
    )
      continue;
    const intent =
      parsed[1] === "temporary"
        ? await db.upload_intents.findOne({
            select: { charge_id: true },
            where: { object_key: object.key },
          })
        : undefined;
    // Unknown temporary namespace cannot be associated with a charge. It has no valid
    // intent after 24h, but retain conservatively until explicit account/journal work.
    const chargeId = parsed[1] === "proofs" ? parsed[2]! : intent?.charge_id;
    if (!chargeId) continue;
    await db.transaction(async (tx) => {
      await tx.charges.findOne({
        select: { id: true },
        where: { id: chargeId },
        lock: true,
      });
      if (await protectedObject(tx, object.key, chargeId, now)) return;
      await enqueueStorageDeletion(
        tx,
        {
          key: object.key,
          chargeId,
          purpose: parsed[1] === "proofs" ? "orphan" : "temporary",
        },
        now,
      );
      queued++;
    });
  }
  // A failed DB read/list never advances this cursor or proves an object unreferenced.
  await db.rawQuery(
    "INSERT INTO storage_cleanup_cursors (id, cursor, updated_at) VALUES ('proof-objects', :cursor, :now) ON CONFLICT (id) DO UPDATE SET cursor = :cursor, updated_at = :now",
    { cursor: page.cursor, now: stamp },
  );
  return { scanned: page.objects.length, queued };
}
export async function drainStorageDeletions(
  db: DbClient,
  storage: ProofStorage,
  clock = Date.now,
) {
  const candidates = await db.storage_deletions.findMany({
    select: { id: true, charge_id: true },
    where: {
      state: { isIn: ["pending", "deleting"] },
      available_at: { lte: new Date(clock()).toISOString() },
    },
    order: { available_at: Order.Asc },
    take: 100,
  });
  let deleted = 0;
  for (const candidate of candidates.records) {
    const claim = await db.transaction(async (tx) => {
      await tx.charges.findOne({
        select: { id: true },
        where: { id: candidate.charge_id },
        lock: true,
      });
      const row = await tx.storage_deletions.findOne({
        select: {
          id: true,
          object_key: true,
          charge_id: true,
          state: true,
          attempts: true,
          available_at: true,
          lease_until: true,
        },
        where: { id: candidate.id },
        lock: true,
      });
      const now = clock();
      const stamp = new Date(now).toISOString();
      if (
        !row ||
        !["pending", "deleting"].includes(row.state) ||
        Date.parse(row.available_at) > now ||
        (row.lease_until && Date.parse(row.lease_until) > now)
      )
        return;
      if (await protectedObject(tx, row.object_key, row.charge_id, now)) {
        await tx.storage_deletions.updateOne({
          where: { id: row.id },
          data: {
            state: "blocked",
            reason: "object_referenced_or_inflight",
            updated_at: stamp,
          },
        });
        return;
      }
      const lease = new Date(now + 60_000).toISOString();
      await tx.storage_deletions.updateOne({
        where: { id: row.id },
        data: {
          state: "deleting",
          attempts: row.attempts + 1,
          available_at: lease,
          lease_until: lease,
          updated_at: stamp,
        },
      });
      return { ...row, lease };
    });
    if (!claim) continue;
    let success = false;
    try {
      await storage.delete(claim.object_key);
      success = true;
    } catch {
      /* Safe reason only; object bodies/URLs never logged. */
    }
    const now = clock();
    await db.storage_deletions.updateMany({
      where: { id: claim.id, state: "deleting", lease_until: claim.lease },
      data: {
        state: success
          ? "deleted"
          : claim.attempts >= 4
            ? "blocked"
            : "pending",
        reason: success ? "deleted" : "storage_delete_failed",
        available_at: new Date(
          now + 60_000 * 2 ** Math.min(claim.attempts, 6),
        ).toISOString(),
        lease_until: new Date(now).toISOString(),
        updated_at: new Date(now).toISOString(),
      },
    });
    if (success) deleted++;
  }
  return { deleted };
}
