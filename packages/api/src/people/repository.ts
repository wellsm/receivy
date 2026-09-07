import { Order } from "@ez4/database";
import { HttpConflictError, HttpNotFoundError, HttpUnauthorizedError } from "@ez4/gateway";
import type { Person, PersonInput, PeoplePage } from "@receivy/common";
import type { DbClient } from "../database";
import { lockAccountReferences } from "../account/locking";

const SELECT = { id: true, name: true, archived_at: true, created_at: true } as const;
const sqlNull = null as unknown as string | undefined;

async function lockOwner(db: DbClient, ownerId: string) {
  await lockAccountReferences(db, "write");
  const owner = await db.users.findOne({ select: { id: true }, where: { id: ownerId, deleted_at: { isNull: true } }, lock: true });
  if (!owner) throw new HttpUnauthorizedError();
}

async function details(db: DbClient, rows: { id: string; name: string; archived_at?: string; created_at: string }[]): Promise<Person[]> {
  if (!rows.length) return [];
  const { records } = await db.person_contacts.findMany({
    select: { person_id: true, type: true, value: true },
    where: { person_id: { isIn: rows.map(row => row.id) } },
  });
  return rows.map(row => ({
    id: row.id, name: row.name, archivedAt: row.archived_at ?? null, createdAt: row.created_at,
    email: records.find(contact => contact.person_id === row.id && contact.type === "email")?.value ?? null,
    phone: records.find(contact => contact.person_id === row.id && contact.type === "phone")?.value ?? null,
  }));
}

export async function listPeople(db: DbClient, ownerId: string, cursor?: string, archived = false): Promise<PeoplePage> {
  const { records } = await db.people.findMany({
    select: SELECT,
    where: { owner_id: ownerId, archived_at: { isNull: !archived }, ...(cursor ? { id: { gt: cursor } } : {}) },
    order: { id: Order.Asc }, take: 51,
  });
  const page = records.slice(0, 50);
  return { people: await details(db, page), nextCursor: records.length > 50 ? page.at(-1)!.id : null };
}

export async function savePerson(db: DbClient, ownerId: string, input: PersonInput, id?: string): Promise<Person> {
  return db.transaction(async tx => {
    // Serialize agenda mutations so two concurrent inserts cannot both pass the
    // friendly duplicate check. The unique index is the final invariant.
    await lockOwner(tx, ownerId);
    const existing = id ? await tx.people.findOne({
      select: { id: true, active_email: true, archived_at: true }, where: { id, owner_id: ownerId }, lock: true,
    }) : undefined;
    if (id && (!existing || existing.archived_at)) throw new HttpNotFoundError();
    if (input.email) {
      const duplicate = await tx.people.findOne({
        select: { id: true }, where: { owner_id: ownerId, active_email: input.email },
      });
      if (duplicate && duplicate.id !== id) throw new HttpConflictError("Já existe um contato ativo com esse e-mail.");
    }
    const verifiedUser = input.email ? await tx.users.findOne({
      select: { id: true }, where: { email: input.email, verified_email: input.email, deleted_at: { isNull: true } },
    }) : undefined;
    const now = new Date().toISOString();
    const personId = id ?? crypto.randomUUID();
    const data = { name: input.name, active_email: input.email ?? sqlNull, updated_at: now };
    const row = existing ? await tx.people.updateOne({
      select: SELECT,
      where: { id: personId, owner_id: ownerId },
      data: { ...data, linked_user: { id: verifiedUser?.id ?? sqlNull } },
    }) : await tx.people.insertOne({
      select: SELECT,
      data: { id: personId, owner: { id: ownerId }, ...data, created_at: now,
        ...(verifiedUser ? { linked_user: { id: verifiedUser.id } } : {}),
      },
    });
    if (!row) throw new HttpNotFoundError();
    for (const type of ["email", "phone"] as const) {
      const value = input[type];
      const previous = await tx.person_contacts.findOne({ select: { id: true }, where: { person_id: personId, type } });
      if (!value) {
        if (previous) await tx.person_contacts.deleteOne({ where: { id: previous.id } });
      } else if (previous) {
        await tx.person_contacts.updateOne({ select: { id: true }, where: { id: previous.id },
          data: { value, normalized_value: value, updated_at: now } });
      } else {
        await tx.person_contacts.insertOne({ select: { id: true },
          data: { id: crypto.randomUUID(), person: { id: personId }, type, value, normalized_value: value, created_at: now, updated_at: now } });
      }
    }
    return { id: row.id, name: row.name, email: input.email ?? null, phone: input.phone ?? null, archivedAt: null, createdAt: row.created_at };
  });
}

export async function archivePerson(db: DbClient, ownerId: string, id: string): Promise<void> {
  await db.transaction(async tx => {
    await lockOwner(tx, ownerId);
    const row = await tx.people.findOne({ select: { id: true, archived_at: true }, where: { id, owner_id: ownerId }, lock: true });
    if (!row) throw new HttpNotFoundError();
    if (row.archived_at) return;
    await tx.people.updateOne({ select: { id: true }, where: { id, owner_id: ownerId },
      data: { archived_at: new Date().toISOString(), active_email: sqlNull, updated_at: new Date().toISOString() } });
  });
}

export async function linkVerifiedPeople(db: DbClient, userId: string, email: string): Promise<void> {
  await db.transaction(async tx => {
    await lockAccountReferences(tx, "write");
    if (!await tx.users.updateOne({ select: { id: true }, where: { id: userId, email, deleted_at: { isNull: true } }, data: { verified_email: email } })) return;
    await tx.people.updateMany({
      where: { active_email: email, linked_user_id: { isNull: true } },
      data: { linked_user: { id: userId }, updated_at: new Date().toISOString() },
    });
  });
}
