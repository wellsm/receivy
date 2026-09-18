import { Order } from '@ez4/database';
import type { DbClient } from '../../database';

export namespace AllocationRepository {
  export type Row = { user_id: string; value?: number | null; sort_order: number; notify: boolean };

  /** The stored parts of one billing, in split order. */
  export async function byBilling(db: DbClient, billingId: string): Promise<Row[]> {
    const { records } = await db.allocations.findMany({
      select: { user_id: true, value: true, sort_order: true, notify: true },
      where: { billing_id: billingId },
      order: { sort_order: Order.Asc }
    });

    return records;
  }

  /** Who sits on the billings of a page; enough for the participant counters. */
  export async function byBillings(db: DbClient, billingIds: string[]): Promise<{ billing_id: string; user_id: string }[]> {
    if (!billingIds.length) {
      return [];
    }

    const { records } = await db.allocations.findMany({ select: { billing_id: true, user_id: true }, where: { billing_id: { isIn: billingIds } } });

    return records;
  }

  /** The stored automatic notices of each participant of a billing, by user id. The owner's own part never counts. */
  export async function notifyOf(db: DbClient, billingId: string, ownerId: string): Promise<Map<string, boolean>> {
    const { records } = await db.allocations.findMany({
      select: { user_id: true, notify: true },
      where: { billing_id: billingId, user_id: { not: ownerId } }
    });

    return new Map(records.map((row) => [row.user_id, row.notify]));
  }

  /** How many people other than the owner take part in a billing. */
  export async function countOthers(db: DbClient, billingId: string, ownerId: string): Promise<number> {
    return db.allocations.count({ where: { billing_id: billingId, user_id: { not: ownerId } } });
  }

  export async function removeOf(db: DbClient, billingId: string): Promise<void> {
    await db.allocations.deleteMany({ where: { billing_id: billingId } });
  }

  /** Participants whose allocation says "Não notificar": every charge created for them starts with the notices off. */
  export async function quietParticipants(db: DbClient, billingId: string, ownerId: string): Promise<Set<string>> {
    const { records } = await db.allocations.findMany({
      select: { user_id: true },
      where: { billing_id: billingId, user_id: { not: ownerId }, notify: false }
    });

    return new Set(records.map((row) => row.user_id));
  }

  /** Rewrites the parts of a billing: everything stored goes, the given rows come in that order. */
  export async function replace(db: DbClient, billingId: string, rows: { userId: string; notify: boolean; value?: number }[], now: string): Promise<void> {
    await db.allocations.deleteMany({ where: { billing_id: billingId } });

    for (const [index, row] of rows.entries()) {
      await db.allocations.insertOne({
        data: {
          id: crypto.randomUUID(),
          billing: { id: billingId },
          user: { id: row.userId },
          notify: row.notify,
          ...(row.value === undefined ? {} : { value: row.value }),
          sort_order: index,
          created_at: now
        }
      });
    }
  }

  export async function setNotify(db: DbClient, billingId: string, userId: string, notify: boolean): Promise<void> {
    await db.allocations.updateMany({ where: { billing_id: billingId, user_id: userId }, data: { notify } });
  }

  /** Every allocation naming `from` now names `to`. */
  export async function reassign(db: DbClient, from: string, to: string): Promise<void> {
    await db.allocations.updateMany({ where: { user_id: from }, data: { user: { id: to } } });
  }
}
