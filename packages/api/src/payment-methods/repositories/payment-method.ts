import { Order } from '@ez4/database';
import { HttpNotFoundError } from '@ez4/gateway';
import type { PaymentMethod, PixKeyType } from '@receivy/common';
import type { DbClient } from '../../database';
import { paymentMethodOf } from '../utils/dto';

const sqlNull = null as unknown as undefined;

/** The default is one per scope: the owner's own keys, or the keys of one contact. */
function scopeWhere(ownerId: string, contactId?: string | null) {
  return { owner_id: ownerId, contact_id: contactId ? contactId : { isNull: true } } as const;
}

export namespace PaymentMethodRepository {
  /**
   * The key a billing points at, as the charge freezes it. `ownScopeOnly` keeps a conta a receber on the owner's own
   * keys; a conta a pagar takes any key of the owner, since the pointer was checked when it was filed.
   */
  export async function pointer(
    db: DbClient,
    ownerId: string,
    id: string,
    ownScopeOnly: boolean,
    lock = false
  ): Promise<{ keyType: PixKeyType; key: string; label: string; archivedAt: string | null } | null> {
    const row = await db.payment_methods.findOne({
      select: { pix_key_type: true, pix_key: true, label: true, archived_at: true },
      where: { id, owner_id: ownerId, ...(ownScopeOnly ? { contact_id: { isNull: true } } : {}) },
      ...(lock ? { lock: true } : {})
    });

    return row ? { keyType: row.pix_key_type, key: row.pix_key, label: row.label, archivedAt: row.archived_at ?? null } : null;
  }

  /** The live default of one scope: the owner's own keys, or the keys filed under a contact. */
  export async function defaultOf(db: DbClient, ownerId: string, contactId?: string): Promise<{ keyType: PixKeyType; key: string; label: string } | null> {
    const { records } = await db.payment_methods.findMany({
      select: { pix_key_type: true, pix_key: true, label: true },
      where: { owner_id: ownerId, contact_id: contactId ? contactId : { isNull: true }, is_default: true, archived_at: { isNull: true } },
      take: 1
    });
    const row = records[0];

    return row ? { keyType: row.pix_key_type, key: row.pix_key, label: row.label } : null;
  }

  export async function get(db: DbClient, ownerId: string, id: string, lock = false): Promise<PaymentMethod | null> {
    const row = await db.payment_methods.findOne({
      select: { id: true, contact_id: true, pix_key_type: true, pix_key: true, label: true, is_default: true, archived_at: true, created_at: true },
      where: { id, owner_id: ownerId },
      ...(lock ? { lock: true } : {})
    });

    return row ? paymentMethodOf(row) : null;
  }

  /** The live keys of one scope: the owner's own, or the ones filed under a contact. Archived keys are never listed. */
  export async function list(db: DbClient, ownerId: string, contactId?: string): Promise<PaymentMethod[]> {
    const { records } = await db.payment_methods.findMany({
      select: { id: true, contact_id: true, pix_key_type: true, pix_key: true, label: true, is_default: true, archived_at: true, created_at: true },
      where: { ...scopeWhere(ownerId, contactId), archived_at: { isNull: true } },
      order: { created_at: Order.Asc }
    });

    return records.map(paymentMethodOf);
  }

  /** The owner's key with this type and value, whatever its scope or state; the same key never belongs to two scopes. */
  export async function byKey(db: DbClient, ownerId: string, keyType: PixKeyType, key: string): Promise<PaymentMethod | null> {
    const row = await db.payment_methods.findOne({
      select: { id: true, contact_id: true, pix_key_type: true, pix_key: true, label: true, is_default: true, archived_at: true, created_at: true },
      where: { owner_id: ownerId, pix_key_type: keyType, pix_key: key }
    });

    return row ? paymentMethodOf(row) : null;
  }

  /** Whether the scope still has a live key, optionally ignoring one of them. */
  export async function hasLive(db: DbClient, ownerId: string, contactId?: string | null, exceptId?: string): Promise<boolean> {
    const { records } = await db.payment_methods.findMany({
      select: { id: true },
      where: { ...scopeWhere(ownerId, contactId), archived_at: { isNull: true }, ...(exceptId ? { id: { not: exceptId } } : {}) },
      take: 1
    });

    return records.length > 0;
  }

  export async function insert(
    db: DbClient,
    input: { ownerId: string; contactId?: string; keyType: PixKeyType; key: string; label: string; isDefault: boolean; now: string }
  ): Promise<PaymentMethod> {
    const row = await db.payment_methods.insertOne({
      select: { id: true, contact_id: true, pix_key_type: true, pix_key: true, label: true, is_default: true, archived_at: true, created_at: true },
      data: {
        id: crypto.randomUUID(),
        owner: { id: input.ownerId },
        ...(input.contactId ? { contact: { id: input.contactId } } : {}),
        type: 'pix',
        pix_key_type: input.keyType,
        pix_key: input.key,
        label: input.label,
        is_default: input.isDefault,
        created_at: input.now,
        updated_at: input.now
      }
    });

    return paymentMethodOf(row);
  }

  export async function update(
    db: DbClient,
    ownerId: string,
    id: string,
    input: { keyType: PixKeyType; key: string; label: string; now: string }
  ): Promise<PaymentMethod> {
    // `updateOne` hands back the row as it was; the edited one is read again.
    await db.payment_methods.updateOne({
      select: { id: true },
      where: { id, owner_id: ownerId },
      data: { pix_key_type: input.keyType, pix_key: input.key, label: input.label, updated_at: input.now }
    });

    const row = await get(db, ownerId, id);

    if (!row) {
      throw new HttpNotFoundError();
    }

    return row;
  }

  /** Nobody in the scope is the default any more; the caller names the next one. */
  export async function clearDefault(db: DbClient, ownerId: string, contactId?: string | null): Promise<void> {
    await db.payment_methods.updateMany({
      select: { id: true },
      where: { ...scopeWhere(ownerId, contactId), is_default: true },
      data: { is_default: false }
    });
  }

  export async function markDefault(db: DbClient, id: string, now: string): Promise<void> {
    await db.payment_methods.updateOne({ select: { id: true }, where: { id }, data: { is_default: true, updated_at: now } });
  }

  export async function archive(db: DbClient, ownerId: string, id: string, now: string): Promise<void> {
    await db.payment_methods.updateOne({
      select: { id: true },
      where: { id, owner_id: ownerId },
      data: { archived_at: now, is_default: false, updated_at: now }
    });
  }

  export async function removeOf(db: DbClient, ownerId: string): Promise<void> {
    await db.payment_methods.deleteMany({ where: { owner_id: ownerId } });
  }

  export async function restore(db: DbClient, id: string, isDefault: boolean, now: string): Promise<void> {
    await db.payment_methods.updateOne({
      select: { id: true },
      where: { id },
      data: { archived_at: sqlNull, is_default: isDefault, updated_at: now }
    });
  }
}
