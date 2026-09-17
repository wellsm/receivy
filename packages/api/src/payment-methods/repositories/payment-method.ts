import { Order } from '@ez4/database';
import { HttpNotFoundError, HttpUnauthorizedError } from '@ez4/gateway';
import type { PaymentMethod, PaymentMethodInput, PixSnapshot } from '@receivy/common';
import type { DbClient } from '../../database';
import { PixKeyTakenError } from '../errors';
import { normalizePixKey } from '../services/validation';

const sqlNull = null as unknown as undefined;

const SELECT = { id: true, contact_id: true, pix_key_type: true, pix_key: true, label: true, is_default: true, archived_at: true, created_at: true } as const;

type Row = {
  id: string;
  contact_id?: string;
  pix_key_type: PaymentMethod['pixKeyType'];
  pix_key: string;
  label: string;
  is_default: boolean;
  archived_at?: string;
  created_at: string;
};

function dto(row: Row): PaymentMethod {
  return {
    id: row.id,
    type: 'pix',
    pixKeyType: row.pix_key_type,
    pixKey: row.pix_key,
    label: row.label,
    isDefault: row.is_default,
    contactId: row.contact_id ?? null,
    archivedAt: row.archived_at ?? null,
    createdAt: row.created_at
  };
}

async function lockOwner(db: DbClient, ownerId: string) {
  const owner = await db.users.findOne({ select: { id: true }, where: { id: ownerId, deleted_at: { isNull: true } }, lock: true });
  if (!owner) throw new HttpUnauthorizedError();
}

function normalized(input: PaymentMethodInput) {
  const key = normalizePixKey(input.pixKeyType, input.pixKey);
  const label = input.label?.normalize('NFC').trim() || 'Pix';
  if (label.length > 120) throw new RangeError('Rótulo inválido.');
  return { key, label };
}

/** The default is one per scope: the owner's own keys, or the keys of one contact. */
function scopeWhere(ownerId: string, contactId?: string) {
  return { owner_id: ownerId, contact_id: contactId ? contactId : { isNull: true } } as const;
}

/** The contact must be the owner's and alive; a key filed under someone else's agenda entry is a 404. */
async function assertContact(db: DbClient, ownerId: string, contactId: string): Promise<void> {
  const contact = await db.contacts.findOne({ select: { id: true }, where: { id: contactId, owner_id: ownerId, archived_at: { isNull: true } } });
  if (!contact) throw new HttpNotFoundError();
}

export namespace PaymentMethodRepository {
  export async function list(db: DbClient, ownerId: string, archived = false, contactId?: string): Promise<PaymentMethod[]> {
    const { records } = await db.payment_methods.findMany({
      select: SELECT,
      where: { ...scopeWhere(ownerId, contactId), archived_at: { isNull: !archived } },
      order: { created_at: Order.Asc }
    });
    return records.map(dto);
  }

  export async function save(db: DbClient, ownerId: string, input: PaymentMethodInput, id?: string): Promise<PaymentMethod> {
    const value = normalized(input);
    return db.transaction(async (tx) => {
      await lockOwner(tx, ownerId);
      if (input.contactId) await assertContact(tx, ownerId, input.contactId);
      const existing = id ? await tx.payment_methods.findOne({ select: SELECT, where: { id, owner_id: ownerId }, lock: true }) : undefined;
      if (id && (!existing || existing.archived_at)) throw new HttpNotFoundError();
      const duplicate = await tx.payment_methods.findOne({
        select: { id: true },
        where: { owner_id: ownerId, pix_key_type: input.pixKeyType, pix_key: value.key }
      });
      if (duplicate && duplicate.id !== id) throw new PixKeyTakenError();
      const now = new Date().toISOString();
      if (existing) {
        const changed = await tx.payment_methods.updateOne({
          select: { id: true },
          where: { id: existing.id, owner_id: ownerId },
          data: { pix_key_type: input.pixKeyType, pix_key: value.key, label: value.label, updated_at: now }
        });
        if (!changed) throw new HttpNotFoundError();
        const row = await tx.payment_methods.findOne({ select: SELECT, where: { id: existing.id } });
        if (!row) throw new HttpNotFoundError();
        return dto(row);
      }
      const anyActive = await tx.payment_methods.findMany({
        select: { id: true },
        where: { ...scopeWhere(ownerId, input.contactId), archived_at: { isNull: true } },
        take: 1
      });
      const row = await tx.payment_methods.insertOne({
        select: SELECT,
        data: {
          id: crypto.randomUUID(),
          owner: { id: ownerId },
          ...(input.contactId ? { contact: { id: input.contactId } } : {}),
          type: 'pix',
          pix_key_type: input.pixKeyType,
          pix_key: value.key,
          label: value.label,
          is_default: !anyActive.records.length,
          created_at: now,
          updated_at: now
        }
      });
      return dto(row);
    });
  }

  /** Makes `id` the default of its own scope; runs inside the caller's transaction. */
  export async function electDefault(db: DbClient, ownerId: string, id: string): Promise<void> {
    const target = await db.payment_methods.findOne({ select: SELECT, where: { id, owner_id: ownerId } });
    if (!target || target.archived_at) throw new HttpNotFoundError();
    await db.payment_methods.updateMany({
      select: { id: true },
      where: { ...scopeWhere(ownerId, target.contact_id), is_default: true },
      data: { is_default: false }
    });
    await db.payment_methods.updateOne({
      select: { id: true },
      where: { id, owner_id: ownerId },
      data: { is_default: true, updated_at: new Date().toISOString() }
    });
  }

  export async function makeDefault(db: DbClient, ownerId: string, id: string): Promise<PaymentMethod> {
    return db.transaction(async (tx) => {
      await lockOwner(tx, ownerId);
      await electDefault(tx, ownerId, id);
      const row = await tx.payment_methods.findOne({ select: SELECT, where: { id } });
      if (!row) throw new HttpNotFoundError();
      return dto(row);
    });
  }

  export async function archive(db: DbClient, ownerId: string, id: string): Promise<void> {
    await db.transaction(async (tx) => {
      await lockOwner(tx, ownerId);
      const target = await tx.payment_methods.findOne({ select: SELECT, where: { id, owner_id: ownerId }, lock: true });
      if (!target) throw new HttpNotFoundError();
      if (target.archived_at) return;
      const now = new Date().toISOString();
      await tx.payment_methods.updateOne({
        select: { id: true },
        where: { id, owner_id: ownerId },
        data: { archived_at: now, is_default: false, updated_at: now }
      });
      if (target.is_default) {
        const replacement = await tx.payment_methods.findMany({
          select: { id: true },
          where: { ...scopeWhere(ownerId, target.contact_id), archived_at: { isNull: true } },
          take: 1
        });
        if (replacement.records[0])
          await tx.payment_methods.updateOne({
            select: { id: true },
            where: { id: replacement.records[0].id },
            data: { is_default: true, updated_at: now }
          });
      }
    });
  }

  /** The key typed on a conta a pagar, filed under its receiving contact. Same key twice answers the same id. */
  export async function upsertContactKey(db: DbClient, ownerId: string, contactId: string, pix: PixSnapshot): Promise<string> {
    const value = normalized({ pixKeyType: pix.keyType, pixKey: pix.key, label: pix.label });
    await assertContact(db, ownerId, contactId);
    // Unscoped, like `save`'s duplicate check: the same key can only ever belong to one scope of the owner.
    const existing = await db.payment_methods.findOne({
      select: { id: true, contact_id: true, archived_at: true },
      where: { owner_id: ownerId, pix_key_type: pix.keyType, pix_key: value.key }
    });
    const now = new Date().toISOString();

    if (existing) {
      if ((existing.contact_id ?? null) !== contactId) throw new PixKeyTakenError();
      if (existing.archived_at) {
        // Resurrecting the scope's only key must not leave it without a default.
        const others = await db.payment_methods.findMany({
          select: { id: true },
          where: { ...scopeWhere(ownerId, contactId), archived_at: { isNull: true }, id: { not: existing.id } },
          take: 1
        });
        await db.payment_methods.updateOne({
          select: { id: true },
          where: { id: existing.id },
          data: { archived_at: sqlNull, is_default: others.records.length === 0, updated_at: now }
        });
      }
      return existing.id;
    }

    const others = await db.payment_methods.findMany({
      select: { id: true },
      where: { ...scopeWhere(ownerId, contactId), archived_at: { isNull: true } },
      take: 1
    });
    const inserted = await db.payment_methods.insertOne({
      select: { id: true },
      data: {
        id: crypto.randomUUID(),
        owner: { id: ownerId },
        contact: { id: contactId },
        type: 'pix',
        pix_key_type: pix.keyType,
        pix_key: value.key,
        label: value.label,
        is_default: others.records.length === 0,
        created_at: now,
        updated_at: now
      }
    });
    return inserted.id;
  }
}
