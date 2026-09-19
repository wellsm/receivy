import { Order } from '@ez4/database';
import { HttpNotFoundError } from '@ez4/gateway';
import { type PaymentMethod, PaymentProvider, type PixKeyType } from '@receivy/common';
import type { DbClient } from '../../database';
import { paymentMethodOf } from '../utils/dto';

const sqlNull = null as unknown as undefined;

/** The four columns a charge freezes from a method. */
export type MethodSnapshot = { provider: PaymentProvider; kind: PixKeyType | null; value: string; label: string; integrationId?: string };

function snapshotOf(row: { provider?: PaymentProvider; kind?: PixKeyType | null; value?: string; label: string; integration_id?: string }): MethodSnapshot | null {
  if (!row.provider || row.value === undefined) {
    return null;
  }

  return { provider: row.provider, kind: row.kind ?? null, value: row.value, label: row.label, ...(row.integration_id ? { integrationId: row.integration_id } : {}) };
}

/** The default is one per scope: the owner's own methods, or the keys of one contact. */
function scopeWhere(ownerId: string, contactId?: string | null) {
  return { owner_id: ownerId, contact_id: contactId ? contactId : { isNull: true } } as const;
}

export namespace PaymentMethodRepository {
  /**
   * The method a billing points at, as the charge freezes it. `ownScopeOnly` keeps a conta a receber on the owner's own
   * methods; a conta a pagar takes any key of the owner, since the pointer was checked when it was filed.
   */
  export async function pointer(db: DbClient, ownerId: string, id: string, ownScopeOnly: boolean, lock = false): Promise<(MethodSnapshot & { archivedAt: string | null }) | null> {
    const row = await db.payment_methods.findOne({
      select: { provider: true, kind: true, value: true, label: true, integration_id: true, archived_at: true },
      where: { id, owner_id: ownerId, ...(ownScopeOnly ? { contact_id: { isNull: true } } : {}) },
      ...(lock ? { lock: true } : {})
    });
    const snapshot = row ? snapshotOf(row) : null;

    return snapshot ? { ...snapshot, archivedAt: row?.archived_at ?? null } : null;
  }

  /** The live default of one scope: the owner's own methods, or the keys filed under a contact. */
  export async function defaultOf(db: DbClient, ownerId: string, contactId?: string): Promise<MethodSnapshot | null> {
    const { records } = await db.payment_methods.findMany({
      select: { provider: true, kind: true, value: true, label: true, integration_id: true },
      where: { owner_id: ownerId, contact_id: contactId ? contactId : { isNull: true }, is_default: true, archived_at: { isNull: true } },
      take: 1
    });
    const row = records[0];

    return row ? snapshotOf(row) : null;
  }

  /** The integration a PagBank method points at, never exposed on the `PaymentMethod` DTO. */
  export async function integrationOf(db: DbClient, ownerId: string, id: string): Promise<string | null> {
    const row = await db.payment_methods.findOne({ select: { integration_id: true }, where: { id, owner_id: ownerId } });

    return row?.integration_id ?? null;
  }

  /** Whether a live method other than `excludeId` still points at this integration; one PagBank integration can back several methods. */
  export async function otherLiveByIntegration(db: DbClient, ownerId: string, integrationId: string, excludeId: string): Promise<boolean> {
    const { records } = await db.payment_methods.findMany({
      select: { id: true },
      where: { owner_id: ownerId, integration_id: integrationId, archived_at: { isNull: true }, id: { not: excludeId } },
      take: 1
    });

    return records.length > 0;
  }

  export async function get(db: DbClient, ownerId: string, id: string, lock = false): Promise<PaymentMethod | null> {
    const row = await db.payment_methods.findOne({
      select: { id: true, contact_id: true, provider: true, kind: true, value: true, label: true, is_default: true, archived_at: true, created_at: true },
      where: { id, owner_id: ownerId },
      ...(lock ? { lock: true } : {})
    });

    return row ? paymentMethodOf(row) : null;
  }

  /** The live methods of one scope: the owner's own, or the ones filed under a contact. Archived methods are never listed. */
  export async function list(db: DbClient, ownerId: string, contactId?: string): Promise<PaymentMethod[]> {
    const { records } = await db.payment_methods.findMany({
      select: { id: true, contact_id: true, provider: true, kind: true, value: true, label: true, is_default: true, archived_at: true, created_at: true },
      where: { ...scopeWhere(ownerId, contactId), archived_at: { isNull: true } },
      order: { created_at: Order.Asc }
    });

    return records.map(paymentMethodOf);
  }

  /** The owner's method with this provider and value, whatever its scope or state; the same value never belongs to two scopes. */
  export async function byValue(db: DbClient, ownerId: string, provider: PaymentProvider, value: string): Promise<PaymentMethod | null> {
    const row = await db.payment_methods.findOne({
      select: { id: true, contact_id: true, provider: true, kind: true, value: true, label: true, is_default: true, archived_at: true, created_at: true },
      where: { owner_id: ownerId, provider, value }
    });

    return row ? paymentMethodOf(row) : null;
  }

  /** Whether the scope still has a live method, optionally ignoring one of them. */
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
    input: {
      ownerId: string;
      contactId?: string;
      provider: PaymentProvider;
      kind: PixKeyType | null;
      value: string;
      label: string;
      isDefault: boolean;
      integrationId?: string | null;
      now: string;
    }
  ): Promise<PaymentMethod> {
    const row = await db.payment_methods.insertOne({
      select: { id: true, contact_id: true, provider: true, kind: true, value: true, label: true, is_default: true, archived_at: true, created_at: true },
      data: {
        id: crypto.randomUUID(),
        owner: { id: input.ownerId },
        ...(input.contactId ? { contact: { id: input.contactId } } : {}),
        provider: input.provider,
        ...(input.kind ? { kind: input.kind } : {}),
        value: input.value,
        label: input.label,
        ...(input.integrationId ? { integration: { id: input.integrationId } } : {}),
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
    input: { provider: PaymentProvider; kind: PixKeyType | null; value: string; label: string; integrationId?: string | null; now: string }
  ): Promise<PaymentMethod> {
    // `updateOne` hands back the row as it was; the edited one is read again.
    await db.payment_methods.updateOne({
      select: { id: true },
      where: { id, owner_id: ownerId },
      data: {
        provider: input.provider,
        kind: input.kind ?? sqlNull,
        value: input.value,
        label: input.label,
        ...('integrationId' in input ? { integration_id: input.integrationId ?? sqlNull } : {}),
        updated_at: input.now
      }
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

  /** Ids of the owner's live InfinitePay/PagBank methods: the ones a free plan cannot bill through. */
  export async function checkoutMethodIds(db: DbClient, ownerId: string): Promise<string[]> {
    const { records } = await db.payment_methods.findMany({
      select: { id: true },
      where: { owner_id: ownerId, provider: { not: PaymentProvider.Pix }, archived_at: { isNull: true } }
    });

    return records.map((row) => row.id);
  }
}
