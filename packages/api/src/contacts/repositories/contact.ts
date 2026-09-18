import { Order } from '@ez4/database';
import { HttpBadRequestError, HttpNotFoundError } from '@ez4/gateway';
import { type Contact, type ContactsPage, ChargeState, type LinkableContact, UserStatus } from '@receivy/common';
import { counterpartId } from '../../charges/utils/columns';
import type { DbClient } from '../../database';
import { avatarRef } from '../../users/utils/avatar';
import { searchTerm } from '../../common/utils/search';
import { decodeRecentCursor, encodeRecentCursor, type RecentCursor, UUID } from '../utils/cursor';
import { type ContactRow, contactOf } from '../utils/dto';

const sqlNull = null as unknown as string | undefined;
const PAGE_SIZE = 50;

/** The name or e-mail filter as the builder compares it: an EXISTS on the person, case-insensitive. */
function searchWhere(query: string) {
  if (!query) {
    return {};
  }

  return { OR: [{ user: { name: { contains: query, insensitive: true } } }, { user: { email: { contains: query, insensitive: true } } }] };
}

/** Latest allocation of the owner's billings per person of the page. */
async function lastBilledDates(db: DbClient, ownerId: string, userIds: string[]): Promise<Map<string, string>> {
  const { records } = await db.allocations.findMany({
    select: { user_id: true, created_at: true },
    where: { user_id: { isIn: userIds }, billing: { owner_id: ownerId } }
  });
  const last = new Map<string, string>();

  for (const row of records) {
    const current = last.get(row.user_id);

    if (!current || row.created_at > current) {
      last.set(row.user_id, row.created_at);
    }
  }

  return last;
}

/** Pending charges between the owner and each person of the page, on either side of the money. */
async function pendingCharges(db: DbClient, ownerId: string, userIds: string[]): Promise<Map<string, number>> {
  const { records } = await db.charges.findMany({
    select: { owner_id: true, creditor_id: true, debtor_id: true },
    where: {
      AND: [{ owner_id: ownerId, state: ChargeState.Pending }, { OR: [{ creditor_id: { isIn: userIds } }, { debtor_id: { isIn: userIds } }] }]
    }
  });
  const active = new Map<string, number>();

  for (const row of records) {
    const personId = counterpartId(row);

    if (personId) {
      active.set(personId, (active.get(personId) ?? 0) + 1);
    }
  }

  return active;
}

async function details(db: DbClient, ownerId: string, rows: ContactRow[]): Promise<Contact[]> {
  if (!rows.length) {
    return [];
  }

  const userIds = [...new Set(rows.map((row) => row.user_id))];
  const billed = await lastBilledDates(db, ownerId, userIds);
  const active = await pendingCharges(db, ownerId, userIds);

  return rows.map((row) => contactOf(row, billed.get(row.user_id) ?? null, active.get(row.user_id) ?? 0));
}

/** The name the `recent` order sorts by: the person's name, then their e-mail. */
function sortName(row: ContactRow): string {
  return row.user.name ?? row.user.email ?? '';
}

/** `(last DESC NULLS LAST, name ASC, id ASC)`: the keyset the `recent` cursor stands on. */
function recentOrder(a: RecentCursor, b: RecentCursor): number {
  if (a.last !== b.last) {
    if (a.last === null) {
      return 1;
    }

    if (b.last === null) {
      return -1;
    }

    return a.last > b.last ? -1 : 1;
  }

  if (a.name !== b.name) {
    return a.name < b.name ? -1 : 1;
  }

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Contacts ordered by their latest billing with the owner, never-billed ones last. The agenda is read whole
 * and ordered here: the keyset only decides where the page starts, so the cursor keeps meaning the same thing.
 */
async function recentContacts(db: DbClient, ownerId: string, query: string, archived: boolean, cursor?: string): Promise<ContactsPage> {
  const position = decodeRecentCursor(cursor);
  const { records } = await db.contacts.findMany({
    select: {
      id: true,
      owner_id: true,
      user_id: true,
      nickname: true,
      archived_at: true,
      created_at: true,
      user: { id: true, name: true, email: true, phone: true, status: true, avatar_updated_at: true }
    },
    where: { owner_id: ownerId, archived_at: { isNull: !archived }, ...searchWhere(query) }
  });
  const rows = records as ContactRow[];
  const billed = await lastBilledDates(db, ownerId, [...new Set(rows.map((row) => row.user_id))]);
  const keyed = rows
    .map((row) => ({ row, key: { last: billed.get(row.user_id) ?? null, name: sortName(row), id: row.id } }))
    .sort((a, b) => recentOrder(a.key, b.key))
    .filter((entry) => !position || recentOrder(entry.key, position) > 0);
  const page = keyed.slice(0, PAGE_SIZE);
  const next = keyed.length > PAGE_SIZE ? page.at(-1)!.key : undefined;
  const active = await pendingCharges(db, ownerId, [...new Set(page.map((entry) => entry.row.user_id))]);

  return {
    contacts: page.map(({ row, key }) => contactOf(row, key.last, active.get(row.user_id) ?? 0)),
    nextCursor: next ? encodeRecentCursor(next) : null
  };
}

export namespace ContactRepository {
  export async function get(db: DbClient, ownerId: string, id: string): Promise<Contact> {
    const row = await db.contacts.findOne({
      select: {
        id: true,
        owner_id: true,
        user_id: true,
        nickname: true,
        archived_at: true,
        created_at: true,
        user: { id: true, name: true, email: true, phone: true, status: true, avatar_updated_at: true }
      },
      where: { id, owner_id: ownerId }
    });

    if (!row) {
      throw new HttpNotFoundError();
    }

    return (await details(db, ownerId, [row as ContactRow]))[0]!;
  }

  /** The agenda entry itself, with no person attached; `lock` takes its row for the caller's transaction. */
  export async function row(
    db: DbClient,
    ownerId: string,
    id: string,
    lock = false
  ): Promise<{ id: string; userId: string; nickname: string | null; archivedAt: string | null } | null> {
    const found = await db.contacts.findOne({
      select: { id: true, user_id: true, nickname: true, archived_at: true },
      where: { id, owner_id: ownerId },
      ...(lock ? { lock: true } : {})
    });

    return found ? { id: found.id, userId: found.user_id, nickname: found.nickname ?? null, archivedAt: found.archived_at ?? null } : null;
  }

  /** The owner's entry for a person, archived or not. */
  export async function byUser(
    db: DbClient,
    ownerId: string,
    userId: string,
    lock = false
  ): Promise<{ id: string; archivedAt: string | null } | null> {
    const found = await db.contacts.findOne({
      select: { id: true, archived_at: true },
      where: { owner_id: ownerId, user_id: userId },
      ...(lock ? { lock: true } : {})
    });

    return found ? { id: found.id, archivedAt: found.archived_at ?? null } : null;
  }

  /** The person an unarchived contact of the owner points at; the owner may only bill people in their agenda. */
  export async function user(db: DbClient, ownerId: string, contactId: string): Promise<{ contactId: string; userId: string }> {
    const found = await row(db, ownerId, contactId);

    if (!found || found.archivedAt) {
      throw new HttpNotFoundError();
    }

    return { contactId: found.id, userId: found.userId };
  }

  export async function list(
    db: DbClient,
    ownerId: string,
    cursor?: string,
    archived = false,
    search = '',
    sort?: 'recent'
  ): Promise<ContactsPage> {
    const query = searchTerm(search);

    if (sort === 'recent') {
      return recentContacts(db, ownerId, query, archived, cursor);
    }

    // The parameter is wide enough to carry the `recent` keyset cursor; the default order still reads
    // it as a bare id, so anything else has to be refused before it reaches a uuid comparison.
    if (cursor && !UUID.test(cursor)) {
      throw new HttpBadRequestError('Cursor inválido.');
    }

    const { records } = await db.contacts.findMany({
      select: {
        id: true,
        owner_id: true,
        user_id: true,
        nickname: true,
        archived_at: true,
        created_at: true,
        user: { id: true, name: true, email: true, phone: true, status: true, avatar_updated_at: true }
      },
      where: {
        owner_id: ownerId,
        archived_at: { isNull: !archived },
        ...(cursor ? { id: { gt: cursor } } : {}),
        ...searchWhere(query)
      },
      order: { id: Order.Asc },
      take: PAGE_SIZE + 1
    });
    const page = records.slice(0, PAGE_SIZE) as ContactRow[];

    return { contacts: await details(db, ownerId, page), nextCursor: records.length > PAGE_SIZE ? page.at(-1)!.id : null };
  }

  export async function insert(db: DbClient, input: { ownerId: string; userId: string; nickname?: string; now: string }): Promise<string> {
    const created = await db.contacts.insertOne({
      select: { id: true },
      data: {
        id: crypto.randomUUID(),
        owner: { id: input.ownerId },
        user: { id: input.userId },
        nickname: input.nickname ?? sqlNull,
        created_at: input.now,
        updated_at: input.now
      }
    });

    return created.id;
  }

  export async function setNickname(db: DbClient, ownerId: string, id: string, nickname: string | undefined, now: string): Promise<void> {
    await db.contacts.updateOne({ where: { id, owner_id: ownerId }, data: { nickname: nickname ?? sqlNull, updated_at: now } });
  }

  export async function restore(db: DbClient, id: string, now: string): Promise<void> {
    await db.contacts.updateOne({ where: { id }, data: { archived_at: sqlNull, updated_at: now } });
  }

  export async function archive(db: DbClient, ownerId: string, id: string, now: string): Promise<void> {
    await db.contacts.updateOne({ select: { id: true }, where: { id, owner_id: ownerId }, data: { archived_at: now, updated_at: now } });
  }

  export async function remove(db: DbClient, id: string): Promise<void> {
    await db.contacts.deleteOne({ where: { id } });
  }

  /** The whole agenda of an owner. */
  export async function removeAgenda(db: DbClient, ownerId: string): Promise<void> {
    await db.contacts.deleteMany({ where: { owner_id: ownerId } });
  }

  /** Every agenda that listed the person keeps an archived, unnamed entry so history still reads. */
  export async function archiveMentions(db: DbClient, userId: string, now: string): Promise<void> {
    await db.contacts.updateMany({ where: { user_id: userId }, data: { nickname: sqlNull, archived_at: now, updated_at: now } });
  }

  /** The entry now names another person; nickname and history stay. */
  export async function repoint(db: DbClient, id: string, userId: string, now: string): Promise<void> {
    await db.contacts.updateOne({ where: { id }, data: { user: { id: userId }, updated_at: now } });
  }

  /** How many other agendas list this person; a placeholder nobody else found stays local. */
  export async function countOtherAgendas(db: DbClient, userId: string, ownerId: string): Promise<number> {
    return db.contacts.count({ where: { user_id: userId, owner_id: { not: ownerId } } });
  }

  /** Unarchived contacts of the owner whose person has no e-mail yet: the only ones a guest can be linked to. */
  export async function linkable(db: DbClient, ownerId: string): Promise<LinkableContact[]> {
    const { records } = await db.contacts.findMany({
      select: { id: true, nickname: true, user: { id: true, name: true, avatar_updated_at: true } },
      where: { owner_id: ownerId, archived_at: { isNull: true }, user: { email: { isNull: true }, status: UserStatus.Pending } }
    });

    return records
      .map((entry) => ({
        contactId: entry.id,
        displayName: entry.nickname ?? entry.user.name ?? '',
        avatar: avatarRef(entry.user.id, entry.user.avatar_updated_at)
      }))
      .sort((a, b) => (a.displayName === b.displayName ? (a.contactId < b.contactId ? -1 : 1) : a.displayName < b.displayName ? -1 : 1));
  }

  /** The viewer's nicknames for `userIds`, by person; people the agenda has no nickname for are left out. */
  export async function nicknames(db: DbClient, viewerId: string, userIds: string[]): Promise<Map<string, string>> {
    if (!userIds.length) {
      return new Map();
    }

    const { records } = await db.contacts.findMany({
      select: { user_id: true, nickname: true },
      where: { owner_id: viewerId, user_id: { isIn: userIds } }
    });

    return new Map(records.flatMap((entry) => (entry.nickname ? [[entry.user_id, entry.nickname] as const] : [])));
  }
}
