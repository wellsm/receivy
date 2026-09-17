import { Order } from '@ez4/database';
import { HttpBadRequestError, HttpNotFoundError, HttpUnauthorizedError } from '@ez4/gateway';
import { type Contact, type ContactInput, type ContactsPage, type LinkableContact, type UserAvatar, UserStatus } from '@receivy/common';
import type { DbClient } from '../../database';
import { AvatarRepository } from '../../users/repositories/avatar';
import { lockAccountReferences } from '../../users/services/locking';
import { DuplicateContactError, EmailTakenError, LinkedContactError, NotLinkableError, OwnEmailError } from '../errors';

const SELECT = { id: true, owner_id: true, user_id: true, nickname: true, archived_at: true, created_at: true } as const;
const USER_SELECT = { id: true, name: true, email: true, phone: true, status: true, avatar_updated_at: true } as const;
const sqlNull = null as unknown as string | undefined;
const PAGE_SIZE = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ContactRow = {
  id: string;
  owner_id: string;
  user_id: string;
  nickname?: string;
  archived_at?: string;
  created_at: string;
};

type UserRow = { id: string; name?: string; email?: string; phone?: string; status: UserStatus; avatar_updated_at?: string };

async function lockOwner(db: DbClient, ownerId: string) {
  await lockAccountReferences(db, 'write');
  const owner = await db.users.findOne({ select: { id: true }, where: { id: ownerId, deleted_at: { isNull: true } }, lock: true });
  if (!owner) throw new HttpUnauthorizedError();
}

/** Latest allocation of the owner's billings per person of the page; the same date-time format the table reads use. */
async function lastBilledDates(db: DbClient, ownerId: string, userIds: string[]): Promise<Map<string, string>> {
  const rows = await db.rawQuery(
    `SELECT a.user_id, to_char(MAX(a.created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS last
    FROM allocations a JOIN billings b ON b.id = a.billing_id AND b.owner_id = :ownerId::uuid
    WHERE a.user_id = ANY(string_to_array(:ids::text, ',')::uuid[]) AND a.user_id <> b.owner_id GROUP BY a.user_id`,
    { ownerId, ids: userIds.join(',') }
  );
  return new Map(rows.map((row) => [String(row['user_id']), String(row['last'])]));
}

/** Pending charges between the owner and each person of the page, on either side of the money. */
async function pendingCharges(db: DbClient, ownerId: string, userIds: string[]): Promise<Map<string, number>> {
  const rows = await db.rawQuery(
    `SELECT c.debtor_user_id AS user_id, COUNT(*) AS active
    FROM charges c WHERE c.creditor_id = :ownerId::uuid
    AND c.debtor_user_id = ANY(string_to_array(:ids::text, ',')::uuid[])
    AND c.state = 'pending' GROUP BY c.debtor_user_id`,
    { ownerId, ids: userIds.join(',') }
  );
  return new Map(rows.map((row) => [String(row['user_id']), Number(row['active'])]));
}

async function details(db: DbClient, rows: ContactRow[]): Promise<Contact[]> {
  if (!rows.length) return [];
  const ownerId = rows[0]!.owner_id;
  const userIds = [...new Set(rows.map((row) => row.user_id))];
  const { records } = await db.users.findMany({ select: USER_SELECT, where: { id: { isIn: userIds } } });
  const users = new Map(records.map((user) => [user.id, user]));
  const billed = await lastBilledDates(db, ownerId, userIds);
  const active = await pendingCharges(db, ownerId, userIds);
  return rows.map((row) => {
    const user = users.get(row.user_id);
    if (!user) throw new HttpNotFoundError();
    const name = ContactRepository.personName(user);
    return {
      id: row.id,
      userId: row.user_id,
      name,
      nickname: row.nickname ?? null,
      displayName: row.nickname || name,
      avatar: user.status === UserStatus.Removed ? null : AvatarRepository.ref(user.id, user.avatar_updated_at),
      email: user.status === UserStatus.Removed ? '' : (user.email ?? ''),
      phone: user.phone ?? null,
      status: user.status,
      archivedAt: row.archived_at ?? null,
      createdAt: row.created_at,
      lastBilledAt: billed.get(row.user_id) ?? null,
      activeCharges: active.get(row.user_id) ?? 0
    };
  });
}

/** Keyset position in the `recent` order; `last` is null once the never-billed tail is reached. */
type RecentCursor = { last: string | null; name: string; id: string };

/** Only the `recent` order sends this shape; the default listing keeps its plain id cursor. */
function decodeRecentCursor(cursor?: string): RecentCursor | undefined {
  if (!cursor) return undefined;
  let parsed: Partial<RecentCursor> | null = null;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<RecentCursor>;
  } catch {
    throw new HttpBadRequestError('Cursor inválido.');
  }
  if (!parsed || typeof parsed !== 'object' || typeof parsed.name !== 'string' || !UUID.test(String(parsed.id))) {
    throw new HttpBadRequestError('Cursor inválido.');
  }
  // An empty `last` is neither a timestamp nor the never-billed tail; it would silently widen the page.
  if (parsed.last !== null && (typeof parsed.last !== 'string' || !parsed.last)) throw new HttpBadRequestError('Cursor inválido.');
  return { last: parsed.last, name: parsed.name, id: parsed.id! };
}

const SEARCH = `(:query::text = '' OR position(:query::text in lower(u.name)) > 0 OR position(:query::text in lower(COALESCE(u.email, ''))) > 0)`;

/**
 * Contacts ordered by their latest billing with the owner, never-billed ones last. The order is a keyset
 * over `(last DESC NULLS LAST, name ASC, id ASC)`; the clause is only spliced in when there is a cursor
 * because an empty uuid/date variable has no type the driver can infer.
 */
async function recentContacts(db: DbClient, ownerId: string, query: string, archived: boolean, cursor?: string): Promise<ContactsPage> {
  const position = decodeRecentCursor(cursor);
  const after = '(ranked.name, ranked.id) > (:cursorName::text, :cursorId::uuid)';
  const paging = !position
    ? ''
    : position.last === null
      ? `WHERE ranked.last_at IS NULL AND ${after}`
      : `WHERE (ranked.last_at IS NULL OR ranked.last_at < :cursorLast::timestamptz
        OR (ranked.last_at = :cursorLast::timestamptz AND ${after}))`;
  const rows = await db.rawQuery(
    `SELECT ranked.id, ranked.name, ranked.last FROM (
      SELECT c.id, COALESCE(u.name, u.email, '') AS name, MAX(a.created_at) AS last_at,
        to_char(MAX(a.created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS last
      FROM contacts c JOIN users u ON u.id = c.user_id
      LEFT JOIN allocations a ON a.user_id = c.user_id AND a.user_id <> c.owner_id
        AND EXISTS (SELECT 1 FROM billings b WHERE b.id = a.billing_id AND b.owner_id = c.owner_id)
      WHERE c.owner_id = :ownerId::uuid AND (c.archived_at IS NOT NULL) = :archived::boolean AND ${SEARCH}
      GROUP BY c.id, u.name, u.email
    ) ranked
    ${paging}
    ORDER BY ranked.last_at DESC NULLS LAST, ranked.name ASC, ranked.id ASC LIMIT ${PAGE_SIZE + 1}`,
    {
      ownerId,
      archived,
      query,
      ...(position ? { cursorName: position.name, cursorId: position.id } : {}),
      ...(position && position.last !== null ? { cursorLast: position.last } : {})
    }
  );
  const page = rows.slice(0, PAGE_SIZE);
  const ids = page.map((row) => String(row['id']));
  if (!ids.length) return { contacts: [], nextCursor: null };
  const { records } = await db.contacts.findMany({ select: SELECT, where: { id: { isIn: ids } } });
  const byId = new Map(records.map((record) => [record.id, record]));
  const ordered = ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  const boundary = rows.length > PAGE_SIZE ? page.at(-1) : undefined;
  const next: RecentCursor | undefined = boundary
    ? { last: boundary['last'] ? String(boundary['last']) : null, name: String(boundary['name']), id: String(boundary['id']) }
    : undefined;
  return { contacts: await details(db, ordered), nextCursor: next ? Buffer.from(JSON.stringify(next)).toString('base64url') : null };
}

/**
 * A pending account is created on behalf of the person; a login with that e-mail later takes it over.
 * Without an e-mail nobody can find it: it stays this owner's placeholder until a guest is linked to it.
 */
async function pendingUser(tx: DbClient, name: string, email: string | undefined, now: string): Promise<UserRow> {
  return tx.users.insertOne({
    select: USER_SELECT,
    data: {
      id: crypto.randomUUID(),
      ...(email ? { email } : {}),
      name,
      status: UserStatus.Pending,
      locale: 'pt-BR',
      timezone: 'America/Sao_Paulo',
      country: 'BR',
      currency: 'BRL',
      created_at: now,
      updated_at: now
    }
  });
}

export namespace ContactRepository {
  export const EMAIL_KEPT_MESSAGE = 'O e-mail de um contato não pode ser removido, só corrigido.';

  /** The person behind a removed account keeps a placeholder name so history still reads. */
  export function personName(user: Pick<UserRow, 'name' | 'status' | 'email'>): string {
    if (user.status === UserStatus.Removed) return 'Conta excluída';
    return user.name?.trim() || user.email || 'Sem nome';
  }

  export async function get(db: DbClient, ownerId: string, id: string): Promise<Contact> {
    const row = await db.contacts.findOne({ select: SELECT, where: { id, owner_id: ownerId } });
    if (!row) throw new HttpNotFoundError();
    return (await details(db, [row]))[0]!;
  }

  /** The person an unarchived contact of the owner points at; the owner may only bill people in their agenda. */
  export async function user(db: DbClient, ownerId: string, contactId: string): Promise<{ contactId: string; userId: string }> {
    const row = await db.contacts.findOne({
      select: { id: true, user_id: true, archived_at: true },
      where: { id: contactId, owner_id: ownerId }
    });
    if (!row || row.archived_at) throw new HttpNotFoundError();
    return { contactId: row.id, userId: row.user_id };
  }

  export async function list(
    db: DbClient,
    ownerId: string,
    cursor?: string,
    archived = false,
    search = '',
    sort?: 'recent'
  ): Promise<ContactsPage> {
    const query = search.normalize('NFC').trim().toLocaleLowerCase('pt-BR').slice(0, 254);
    if (sort === 'recent') return recentContacts(db, ownerId, query, archived, cursor);
    // The parameter is wide enough to carry the `recent` keyset cursor; the default order still reads
    // it as a bare id, so anything else has to be refused before it reaches a uuid comparison.
    if (cursor && !UUID.test(cursor)) throw new HttpBadRequestError('Cursor inválido.');
    let matchingIds: string[] | undefined;
    if (query) {
      const rows = await db.rawQuery(
        `SELECT c.id FROM contacts c JOIN users u ON u.id = c.user_id WHERE c.owner_id = :ownerId::uuid
        AND (c.archived_at IS NOT NULL) = :archived::boolean
        AND (:cursor::uuid IS NULL OR c.id > :cursor::uuid)
        AND ${SEARCH}
        ORDER BY c.id LIMIT ${PAGE_SIZE + 1}`,
        { ownerId, archived, cursor: cursor ?? null, query }
      );
      matchingIds = rows.map((row) => String(row['id']));
      if (!matchingIds.length) return { contacts: [], nextCursor: null };
    }
    const { records } = await db.contacts.findMany({
      select: SELECT,
      where: {
        owner_id: ownerId,
        archived_at: { isNull: !archived },
        ...(matchingIds ? { id: { isIn: matchingIds } } : cursor ? { id: { gt: cursor } } : {})
      },
      order: { id: Order.Asc },
      take: PAGE_SIZE + 1
    });
    const page = records.slice(0, PAGE_SIZE);
    return { contacts: await details(db, page), nextCursor: records.length > PAGE_SIZE ? page.at(-1)!.id : null };
  }

  /** Finds or creates the agenda entry between the owner and an existing account (invite acceptance, first login). */
  export async function ensure(tx: DbClient, ownerId: string, userId: string, now: string): Promise<string> {
    const existing = await tx.contacts.findOne({
      select: { id: true, archived_at: true },
      where: { owner_id: ownerId, user_id: userId },
      lock: true
    });
    if (existing) {
      if (existing.archived_at)
        await tx.contacts.updateOne({ where: { id: existing.id }, data: { archived_at: sqlNull, updated_at: now } });
      return existing.id;
    }
    const created = await tx.contacts.insertOne({
      select: { id: true },
      data: { id: crypto.randomUUID(), owner: { id: ownerId }, user: { id: userId }, created_at: now, updated_at: now }
    });
    return created.id;
  }

  export async function save(db: DbClient, ownerId: string, input: ContactInput, id?: string): Promise<Contact> {
    return db.transaction(async (tx) => {
      // Serialize agenda mutations so two concurrent inserts cannot both pass the friendly duplicate check.
      await lockOwner(tx, ownerId);
      const now = new Date().toISOString();
      const existing = id ? await tx.contacts.findOne({ select: SELECT, where: { id, owner_id: ownerId }, lock: true }) : undefined;
      if (id && (!existing || existing.archived_at)) throw new HttpNotFoundError();
      const current = existing ? await tx.users.findOne({ select: USER_SELECT, where: { id: existing.user_id }, lock: true }) : undefined;
      if (existing && !current) throw new HttpNotFoundError();
      const contactId = existing?.id ?? crypto.randomUUID();
      let userId = existing?.user_id;

      if (current && current.status === UserStatus.Active) {
        // An active account owns its name and e-mail; the agenda only keeps the nickname it uses.
        if (input.name !== personName(current) || input.email !== current.email) throw new LinkedContactError();
      } else if (current) {
        // A pending account still belongs to whoever typed it: any agenda holding it may fix name and e-mail.
        // Once an e-mail exists other agendas may have found the account through it, so it never goes blank again.
        if (current.email && !input.email) throw new HttpBadRequestError(EMAIL_KEPT_MESSAGE);
        if (input.email && input.email !== current.email) {
          const taken = await tx.users.findOne({ select: { id: true }, where: { email: input.email } });
          if (taken) throw new EmailTakenError();
        }
        await tx.users.updateOne({
          where: { id: current.id },
          data: { name: input.name, ...(input.email ? { email: input.email } : {}), updated_at: now }
        });
      } else {
        const match = input.email ? await tx.users.findOne({ select: USER_SELECT, where: { email: input.email }, lock: true }) : undefined;
        if (match) {
          const duplicate = await tx.contacts.findOne({
            select: { id: true, archived_at: true },
            where: { owner_id: ownerId, user_id: match.id }
          });
          if (duplicate && !duplicate.archived_at) throw new DuplicateContactError();
          if (duplicate) await tx.contacts.deleteOne({ where: { id: duplicate.id } });
          if (match.id === ownerId) throw new OwnEmailError();
          // Whoever holds an account already named themself; a pending one takes the name typed now.
          if (match.status === UserStatus.Pending)
            await tx.users.updateOne({ where: { id: match.id }, data: { name: input.name, updated_at: now } });
          userId = match.id;
        } else {
          userId = (await pendingUser(tx, input.name, input.email, now)).id;
        }
      }

      const data = { nickname: input.nickname ?? sqlNull, updated_at: now };
      if (existing) {
        await tx.contacts.updateOne({ where: { id: contactId, owner_id: ownerId }, data });
      } else {
        await tx.contacts.insertOne({
          select: { id: true },
          data: { id: contactId, owner: { id: ownerId }, user: { id: userId! }, ...data, created_at: now }
        });
      }
      const saved = await tx.contacts.findOne({ select: SELECT, where: { id: contactId, owner_id: ownerId } });
      if (!saved) throw new HttpNotFoundError();
      return (await details(tx, [saved]))[0]!;
    });
  }

  export async function archive(db: DbClient, ownerId: string, id: string): Promise<void> {
    await db.transaction(async (tx) => {
      await lockOwner(tx, ownerId);
      const row = await tx.contacts.findOne({ select: { id: true, archived_at: true }, where: { id, owner_id: ownerId }, lock: true });
      if (!row) throw new HttpNotFoundError();
      if (row.archived_at) return;
      const now = new Date().toISOString();
      await tx.contacts.updateOne({ select: { id: true }, where: { id, owner_id: ownerId }, data: { archived_at: now, updated_at: now } });
    });
  }

  /** Unarchived contacts of the owner whose person has no e-mail yet: the only ones a guest can be linked to. */
  export async function linkable(db: DbClient, ownerId: string): Promise<LinkableContact[]> {
    const rows = await db.rawQuery(
      `SELECT c.id, COALESCE(c.nickname, u.name, '') AS display_name, u.id AS user_id, u.avatar_updated_at
      FROM contacts c JOIN users u ON u.id = c.user_id
      WHERE c.owner_id = :ownerId::uuid AND c.archived_at IS NULL AND u.email IS NULL AND u.status = 'pending'
      ORDER BY display_name ASC, c.id ASC`,
      { ownerId }
    );
    return rows.map((row) => ({
      contactId: String(row['id']),
      displayName: String(row['display_name']),
      avatar: AvatarRepository.ref(String(row['user_id']), row['avatar_updated_at'] as string | Date | null)
    }));
  }

  /**
   * The owner says a guest who joined by invite is the person behind one of their e-mail-less contacts: every
   * row that named the placeholder now names the guest's account, the agenda entry keeps its nickname and the
   * placeholder disappears. Without an e-mail no other agenda could have found it, so the move stays local.
   */
  export async function linkGuest(tx: DbClient, ownerId: string, contactId: string, userId: string, now: string): Promise<void> {
    const contact = await tx.contacts.findOne({ select: SELECT, where: { id: contactId, owner_id: ownerId }, lock: true });
    if (!contact || contact.archived_at) throw new HttpNotFoundError();
    const placeholder = await tx.users.findOne({ select: USER_SELECT, where: { id: contact.user_id }, lock: true });
    if (placeholder?.status !== UserStatus.Pending || placeholder.email) throw new NotLinkableError();
    if (placeholder.id === userId) return;
    const [foreign] = await tx.rawQuery(`SELECT COUNT(*) AS total FROM contacts WHERE user_id = :id::uuid AND owner_id <> :ownerId::uuid`, {
      id: placeholder.id,
      ownerId
    });
    if (Number(foreign?.total ?? 0)) throw new NotLinkableError();
    const own = await tx.contacts.findOne({ select: { id: true }, where: { owner_id: ownerId, user_id: userId } });
    if (own) await tx.contacts.deleteOne({ where: { id: own.id } });
    const params = { from: placeholder.id, to: userId, now };
    await tx.rawQuery(`UPDATE contacts SET user_id = :to::uuid, updated_at = :now::timestamptz WHERE id = :contactId::uuid`, {
      ...params,
      contactId: contact.id
    });
    await tx.rawQuery(
      `UPDATE charges SET debtor_user_id = :to::uuid, updated_at = :now::timestamptz WHERE debtor_user_id = :from::uuid`,
      params
    );
    await tx.rawQuery(`UPDATE allocations SET user_id = :to::uuid WHERE user_id = :from::uuid`, params);
    await tx.rawQuery(
      `UPDATE billings SET payee_user_id = :to::uuid, updated_at = :now::timestamptz WHERE payee_user_id = :from::uuid`,
      params
    );
    await tx.rawQuery(`UPDATE proofs SET sender_user_id = :to::uuid WHERE sender_user_id = :from::uuid`, params);
    await tx.rawQuery(`UPDATE events SET actor_user_id = :to::uuid WHERE actor_user_id = :from::uuid`, params);
    await tx.users.deleteOne({ where: { id: placeholder.id } });
  }

  /** Display name of `userId` as `viewerId` knows them: their nickname when the agenda has one, else the person's name. */
  export async function displayNameFor(db: DbClient, viewerId: string, userId: string): Promise<string> {
    const user = await db.users.findOne({ select: USER_SELECT, where: { id: userId } });
    if (!user) return 'Conta excluída';
    const contact = await db.contacts.findOne({ select: { nickname: true }, where: { owner_id: viewerId, user_id: userId } });
    return contact?.nickname || personName(user);
  }

  /** Live counterpart data for a charge DTO; a removed account keeps its placeholder. */
  export async function counterpartOf(
    db: DbClient,
    userId: string | undefined
  ): Promise<{ name: string; email: string | null; phone: string | null; status: UserStatus; avatar: UserAvatar | null } | null> {
    if (!userId) return null;
    const user = await db.users.findOne({ select: USER_SELECT, where: { id: userId } });
    if (!user) return null;
    return {
      name: personName(user),
      email: user.status === UserStatus.Removed ? null : (user.email ?? null),
      phone: user.status === UserStatus.Removed ? null : (user.phone ?? null),
      status: user.status,
      avatar: user.status === UserStatus.Removed ? null : AvatarRepository.ref(user.id, user.avatar_updated_at)
    };
  }
}
