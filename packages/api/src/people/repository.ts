import { Order } from '@ez4/database';
import { HttpBadRequestError, HttpConflictError, HttpNotFoundError, HttpUnauthorizedError } from '@ez4/gateway';
import type { PeoplePage, Person, PersonInput } from '@receivy/common';
import { lockAccountReferences } from '../account/locking';
import type { DbClient } from '../database';

const SELECT = { id: true, name: true, linked_user_id: true, archived_at: true, created_at: true } as const;
const sqlNull = null as unknown as string | undefined;
const PAGE_SIZE = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function lockOwner(db: DbClient, ownerId: string) {
  await lockAccountReferences(db, 'write');
  const owner = await db.users.findOne({ select: { id: true }, where: { id: ownerId, deleted_at: { isNull: true } }, lock: true });
  if (!owner) throw new HttpUnauthorizedError();
}

/** Latest allocation per person of the page; the same date-time format the table reads use. */
async function lastBilledDates(db: DbClient, personIds: string[]): Promise<Map<string, string>> {
  const rows = await db.rawQuery(
    `SELECT a.person_id, to_char(MAX(a.created_at), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS last
    FROM allocations a WHERE a.person_id = ANY(string_to_array(:ids::text, ',')::uuid[]) GROUP BY a.person_id`,
    { ids: personIds.join(',') }
  );
  return new Map(rows.map((row) => [String(row['person_id']), String(row['last'])]));
}

async function details(
  db: DbClient,
  rows: { id: string; name: string; linked_user_id?: string; archived_at?: string; created_at: string }[]
): Promise<Person[]> {
  if (!rows.length) return [];
  const { records } = await db.person_contacts.findMany({
    select: { person_id: true, type: true, value: true },
    where: { person_id: { isIn: rows.map((row) => row.id) } }
  });
  const billed = await lastBilledDates(
    db,
    rows.map((row) => row.id)
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    hasAccount: !!row.linked_user_id,
    archivedAt: row.archived_at ?? null,
    createdAt: row.created_at,
    email: records.find((contact) => contact.person_id === row.id && contact.type === 'email')?.value ?? null,
    phone: records.find((contact) => contact.person_id === row.id && contact.type === 'phone')?.value ?? null,
    lastBilledAt: billed.get(row.id) ?? null
  }));
}

export async function getPerson(db: DbClient, ownerId: string, id: string): Promise<Person> {
  const row = await db.people.findOne({ select: SELECT, where: { id, owner_id: ownerId } });
  if (!row) throw new HttpNotFoundError();
  return (await details(db, [row]))[0]!;
}

/** Keyset position in the `recent` order; `last` is null once the never-billed tail is reached. */
type RecentCursor = { last: string | null; name: string; id: string };

/** Only the `recent` order sends this shape; the default listing keeps its plain id cursor. */
function decodeRecentCursor(cursor?: string): RecentCursor | undefined {
  if (!cursor) {
    return undefined;
  }

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
  if (parsed.last !== null && (typeof parsed.last !== 'string' || !parsed.last)) {
    throw new HttpBadRequestError('Cursor inválido.');
  }

  return { last: parsed.last, name: parsed.name, id: parsed.id! };
}

/**
 * Contacts ordered by their latest billing, never-billed ones last. The order is a keyset over
 * `(last DESC NULLS LAST, name ASC, id ASC)`; the clause is only spliced in when there is a cursor
 * because an empty uuid/date variable has no type the driver can infer. The comparison runs on the
 * raw timestamp instead of its rendered text: the driver types a date-looking parameter as a date,
 * and casting that back to text would not match the format the cursor carries. The cursor itself is
 * rendered `AT TIME ZONE 'UTC'` so a non-UTC session cannot shift the instant it round-trips.
 */
async function recentPeople(db: DbClient, ownerId: string, query: string, archived: boolean, cursor?: string): Promise<PeoplePage> {
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
      SELECT p.id, p.name, MAX(a.created_at) AS last_at,
        to_char(MAX(a.created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS last
      FROM people p LEFT JOIN allocations a ON a.person_id = p.id
      WHERE p.owner_id = :ownerId::uuid AND (p.archived_at IS NOT NULL) = :archived::boolean
      AND (:query::text = '' OR position(:query::text in lower(p.name)) > 0 OR EXISTS
        (SELECT 1 FROM person_contacts c WHERE c.person_id = p.id AND position(:query::text in lower(c.value)) > 0))
      GROUP BY p.id, p.name
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
  if (!ids.length) return { people: [], nextCursor: null };
  const { records } = await db.people.findMany({ select: SELECT, where: { id: { isIn: ids } } });
  const byId = new Map(records.map((record) => [record.id, record]));
  const ordered = ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  const boundary = rows.length > PAGE_SIZE ? page.at(-1) : undefined;
  const next: RecentCursor | undefined = boundary
    ? { last: boundary['last'] ? String(boundary['last']) : null, name: String(boundary['name']), id: String(boundary['id']) }
    : undefined;
  return {
    people: await details(db, ordered),
    nextCursor: next ? Buffer.from(JSON.stringify(next)).toString('base64url') : null
  };
}

export async function listPeople(
  db: DbClient,
  ownerId: string,
  cursor?: string,
  archived = false,
  search = '',
  sort?: 'recent'
): Promise<PeoplePage> {
  const query = search.normalize('NFC').trim().toLocaleLowerCase('pt-BR').slice(0, 254);
  if (sort === 'recent') return recentPeople(db, ownerId, query, archived, cursor);
  // The parameter is wide enough to carry the `recent` keyset cursor; the default order still reads
  // it as a bare id, so anything else has to be refused before it reaches a uuid comparison.
  if (cursor && !UUID.test(cursor)) throw new HttpBadRequestError('Cursor inválido.');
  let matchingIds: string[] | undefined;
  if (query) {
    const rows = await db.rawQuery(
      `SELECT p.id FROM people p WHERE p.owner_id = :ownerId::uuid
      AND (p.archived_at IS NOT NULL) = :archived::boolean
      AND (:cursor::uuid IS NULL OR p.id > :cursor::uuid)
      AND (position(:query::text in lower(p.name)) > 0 OR EXISTS
        (SELECT 1 FROM person_contacts c WHERE c.person_id = p.id AND position(:query::text in lower(c.value)) > 0))
      ORDER BY p.id LIMIT ${PAGE_SIZE + 1}`,
      { ownerId, archived, cursor: cursor ?? null, query }
    );
    matchingIds = rows.map((row) => String(row['id']));
    if (!matchingIds.length) return { people: [], nextCursor: null };
  }
  const { records } = await db.people.findMany({
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
  return { people: await details(db, page), nextCursor: records.length > PAGE_SIZE ? page.at(-1)!.id : null };
}

export async function savePerson(db: DbClient, ownerId: string, input: PersonInput, id?: string): Promise<Person> {
  return db.transaction(async (tx) => {
    // Serialize agenda mutations so two concurrent inserts cannot both pass the
    // friendly duplicate check. The unique index is the final invariant.
    await lockOwner(tx, ownerId);
    const existing = id
      ? await tx.people.findOne({
          select: { id: true, active_email: true, archived_at: true },
          where: { id, owner_id: ownerId },
          lock: true
        })
      : undefined;
    if (id && (!existing || existing.archived_at)) throw new HttpNotFoundError();
    if (input.email) {
      const duplicate = await tx.people.findOne({
        select: { id: true },
        where: { owner_id: ownerId, active_email: input.email }
      });
      if (duplicate && duplicate.id !== id) throw new HttpConflictError('Já existe um contato ativo com esse e-mail.');
    }
    const verifiedUser = input.email
      ? await tx.users.findOne({
          select: { id: true },
          where: { email: input.email, verified_email: input.email, deleted_at: { isNull: true } }
        })
      : undefined;
    const now = new Date().toISOString();
    const personId = id ?? crypto.randomUUID();
    const data = { name: input.name, active_email: input.email ?? sqlNull, updated_at: now };
    const row = existing
      ? await tx.people.updateOne({
          select: SELECT,
          where: { id: personId, owner_id: ownerId },
          data: { ...data, linked_user: { id: verifiedUser?.id ?? sqlNull } }
        })
      : await tx.people.insertOne({
          select: SELECT,
          data: {
            id: personId,
            owner: { id: ownerId },
            ...data,
            created_at: now,
            ...(verifiedUser ? { linked_user: { id: verifiedUser.id } } : {})
          }
        });
    if (!row) throw new HttpNotFoundError();
    for (const type of ['email', 'phone'] as const) {
      const value = input[type];
      const previous = await tx.person_contacts.findOne({ select: { id: true }, where: { person_id: personId, type } });
      if (!value) {
        if (previous) await tx.person_contacts.deleteOne({ where: { id: previous.id } });
      } else if (previous) {
        await tx.person_contacts.updateOne({
          select: { id: true },
          where: { id: previous.id },
          data: { value, normalized_value: value, updated_at: now }
        });
      } else {
        await tx.person_contacts.insertOne({
          select: { id: true },
          data: {
            id: crypto.randomUUID(),
            person: { id: personId },
            type,
            value,
            normalized_value: value,
            created_at: now,
            updated_at: now
          }
        });
      }
    }
    return {
      id: row.id,
      name: row.name,
      hasAccount: !!verifiedUser,
      email: input.email ?? null,
      phone: input.phone ?? null,
      archivedAt: null,
      createdAt: row.created_at,
      lastBilledAt: existing ? ((await lastBilledDates(tx, [personId])).get(personId) ?? null) : null
    };
  });
}

export async function archivePerson(db: DbClient, ownerId: string, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    await lockOwner(tx, ownerId);
    const row = await tx.people.findOne({ select: { id: true, archived_at: true }, where: { id, owner_id: ownerId }, lock: true });
    if (!row) throw new HttpNotFoundError();
    if (row.archived_at) return;
    await tx.people.updateOne({
      select: { id: true },
      where: { id, owner_id: ownerId },
      data: { archived_at: new Date().toISOString(), active_email: sqlNull, updated_at: new Date().toISOString() }
    });
  });
}

export async function linkVerifiedPeople(db: DbClient, userId: string, email: string): Promise<void> {
  await db.transaction(async (tx) => {
    await lockAccountReferences(tx, 'write');
    if (
      !(await tx.users.updateOne({
        select: { id: true },
        where: { id: userId, email, deleted_at: { isNull: true } },
        data: { verified_email: email }
      }))
    )
      return;
    await tx.people.updateMany({
      where: { active_email: email, linked_user_id: { isNull: true } },
      data: { linked_user: { id: userId }, updated_at: new Date().toISOString() }
    });
  });
}
