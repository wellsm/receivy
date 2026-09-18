import type { DbClient } from '../../database';
import type { PersonRow } from '../../contacts/utils/person';
import { BillingGuestState } from '../schemas/billing-guest';

const sqlNull = null as unknown as undefined;

export namespace BillingGuestRepository {
  export type Row = { id: string; billing_id: string; owner_id: string; user_id: string; state: BillingGuestState; created_at: string };

  export async function get(db: DbClient, ownerId: string, billingId: string, id: string, lock = false): Promise<Row | null> {
    const row = await db.billing_guests.findOne({
      select: { id: true, billing_id: true, owner_id: true, user_id: true, state: true, created_at: true },
      where: { id, billing_id: billingId, owner_id: ownerId },
      ...(lock ? { lock: true } : {})
    });

    return row ?? null;
  }

  /** The guests in one state on a billing, oldest first, with the live account of each. */
  export async function byState(db: DbClient, billingId: string, state: BillingGuestState): Promise<(Row & { user: PersonRow })[]> {
    const { records } = await db.billing_guests.findMany({
      select: {
        id: true,
        billing_id: true,
        owner_id: true,
        user_id: true,
        state: true,
        created_at: true,
        user: { id: true, name: true, email: true, phone: true, status: true, avatar_updated_at: true }
      },
      where: { billing_id: billingId, state }
    });

    return (records as (Row & { user: PersonRow })[]).sort((left, right) => left.created_at.localeCompare(right.created_at));
  }

  /** The guest row of a person on a billing, in whatever state it was left. */
  export async function byUser(db: DbClient, billingId: string, userId: string): Promise<Pick<Row, 'id' | 'state'> | null> {
    const row = await db.billing_guests.findOne({ select: { id: true, state: true }, where: { billing_id: billingId, user_id: userId } });

    return row ?? null;
  }

  export async function insert(db: DbClient, input: { billingId: string; ownerId: string; userId: string; now: string }): Promise<void> {
    await db.billing_guests.insertOne({
      data: {
        id: crypto.randomUUID(),
        billing: { id: input.billingId },
        owner: { id: input.ownerId },
        user: { id: input.userId },
        state: BillingGuestState.Pending,
        created_at: input.now
      }
    });
  }

  /** Back in line for the owner, as if never answered. */
  export async function park(db: DbClient, id: string, now: string): Promise<void> {
    await db.billing_guests.updateOne({ where: { id }, data: { state: BillingGuestState.Pending, created_at: now, resolved_at: sqlNull } });
  }

  /** Every guest row naming the person, as owner or as guest. */
  export async function removeOf(db: DbClient, userId: string): Promise<void> {
    await db.billing_guests.deleteMany({ where: { OR: [{ owner_id: userId }, { user_id: userId }] } });
  }

  export async function resolve(db: DbClient, id: string, state: BillingGuestState, now: string): Promise<void> {
    await db.billing_guests.updateOne({ where: { id }, data: { state, resolved_at: now } });
  }
}
