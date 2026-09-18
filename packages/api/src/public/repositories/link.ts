import { randomBytes } from 'node:crypto';
import { Order } from '@ez4/database';
import type { DbClient } from '../../database';
import { LinkableType } from '../schemas/link';

const sqlNull = null as unknown as undefined;

export type LinkRow = {
  id: string;
  linkable_type: LinkableType;
  linkable_id: string;
  public_id: string;
  expires_at: string;
  revoked_at?: string;
  accepted_count?: number;
  created_at: string;
};

export namespace LinkRepository {
  /**
   * The live link of a target: issued, not revoked, and — when `nowSeconds` is given — not expired yet.
   * "One live link per target" is held here and by the callers' transactions: EZ4 declares no partial index.
   */
  export async function live(
    db: DbClient,
    linkableType: LinkableType,
    linkableId: string,
    nowSeconds?: number,
    lock = false
  ): Promise<LinkRow | null> {
    const { records } = await db.links.findMany({
      select: { id: true, linkable_type: true, linkable_id: true, public_id: true, expires_at: true, revoked_at: true, accepted_count: true, created_at: true },
      where: { linkable_type: linkableType, linkable_id: linkableId, revoked_at: { isNull: true } },
      order: { created_at: Order.Desc },
      take: 1,
      ...(lock ? { lock: true } : {})
    });

    const row = records[0];

    if (!row) {
      return null;
    }

    if (nowSeconds !== undefined && Date.parse(row.expires_at) / 1000 <= nowSeconds) {
      return null;
    }

    return row;
  }

  /** Revokes whatever is live for the target; rotating is this plus a fresh row, which leaves the history. */
  export async function revokeLive(db: DbClient, linkableType: LinkableType, linkableId: string, now: string): Promise<void> {
    await db.links.updateMany({
      where: { linkable_type: linkableType, linkable_id: linkableId, revoked_at: { isNull: true } },
      data: { revoked_at: now }
    });
  }

  /** Issues a link for the target, revoking the live one first: the new row is what rotating means. */
  export async function issue(
    db: DbClient,
    input: { linkableType: LinkableType; linkableId: string; expiresAt: string; acceptedCount?: number },
    now: string
  ): Promise<LinkRow> {
    await revokeLive(db, input.linkableType, input.linkableId, now);

    return db.links.insertOne({
      select: { id: true, linkable_type: true, linkable_id: true, public_id: true, expires_at: true, revoked_at: true, accepted_count: true, created_at: true },
      data: {
        id: crypto.randomUUID(),
        linkable_type: input.linkableType,
        linkable_id: input.linkableId,
        public_id: randomBytes(16).toString('base64url'),
        expires_at: input.expiresAt,
        revoked_at: sqlNull,
        ...(input.acceptedCount === undefined ? {} : { accepted_count: input.acceptedCount }),
        created_at: now
      }
    });
  }

  /**
   * Whether the target ever had a link, revoked or not. A charge published before it had a Pix key is
   * recognised by this, not by a live link: revoking one must not turn it back into "never published".
   */
  export async function everIssued(db: DbClient, linkableType: LinkableType, linkableId: string): Promise<boolean> {
    return !!(await db.links.count({ where: { linkable_type: linkableType, linkable_id: linkableId } }));
  }

  /** Which of `linkableIds` ever had a link, revoked ones included: one read for a whole page. */
  export async function issuedFor(db: DbClient, linkableType: LinkableType, linkableIds: string[]): Promise<Set<string>> {
    if (!linkableIds.length) {
      return new Set();
    }

    const { records } = await db.links.findMany({
      select: { linkable_id: true },
      where: { linkable_type: linkableType, linkable_id: { isIn: linkableIds } }
    });

    return new Set(records.map((record) => record.linkable_id));
  }

  /** The tally of acceptances an invite link carries. */
  export async function setAcceptedCount(db: DbClient, id: string, acceptedCount: number): Promise<void> {
    await db.links.updateOne({ where: { id }, data: { accepted_count: acceptedCount } });
  }

  /** Every link ever issued for the target, live or not. */
  export async function removeFor(db: DbClient, linkableType: LinkableType, linkableId: string): Promise<void> {
    await db.links.deleteMany({ where: { linkable_type: linkableType, linkable_id: linkableId } });
  }

  /** One row by id, for a caller that already resolved it and now needs it under lock. */
  export async function byId(db: DbClient, id: string, lock = false): Promise<LinkRow | null> {
    const row = await db.links.findOne({ select: { id: true, linkable_type: true, linkable_id: true, public_id: true, expires_at: true, revoked_at: true, accepted_count: true, created_at: true }, where: { id }, ...(lock ? { lock: true } : {}) });

    return row ?? null;
  }

  /** The row behind a handle, whatever its state: the caller decides what revoked or expired means. */
  export async function byPublicId(db: DbClient, publicId: string): Promise<LinkRow | null> {
    const row = await db.links.findOne({ select: { id: true, linkable_type: true, linkable_id: true, public_id: true, expires_at: true, revoked_at: true, accepted_count: true, created_at: true }, where: { public_id: publicId } });

    return row ?? null;
  }
}
