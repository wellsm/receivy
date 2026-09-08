import { Order } from '@ez4/database';
import { HttpConflictError, HttpNotFoundError, HttpUnauthorizedError } from '@ez4/gateway';
import type { PaymentMethod, PaymentMethodInput } from '@receivy/common';
import type { DbClient } from '../database';
import { normalizePixKey } from './validation';

const SELECT = { id: true, pix_key_type: true, pix_key: true, label: true, is_default: true, archived_at: true, created_at: true } as const;

type Row = {
  id: string;
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
    archivedAt: row.archived_at ?? null,
    createdAt: row.created_at
  };
}

async function lockOwner(db: DbClient, ownerId: string) {
  const owner = await db.users.findOne({ select: { id: true }, where: { id: ownerId, deleted_at: { isNull: true } }, lock: true });
  if (!owner) throw new HttpUnauthorizedError();
}

export async function listPaymentMethods(db: DbClient, ownerId: string, archived = false): Promise<PaymentMethod[]> {
  const { records } = await db.payment_methods.findMany({
    select: SELECT,
    where: { owner_id: ownerId, archived_at: { isNull: !archived } },
    order: { created_at: Order.Asc }
  });
  return records.map(dto);
}

function normalized(input: PaymentMethodInput) {
  const key = normalizePixKey(input.pixKeyType, input.pixKey);
  const label = input.label?.normalize('NFC').trim() || 'Pix';
  if (label.length > 120) throw new RangeError('Rótulo inválido.');
  return { key, label };
}

export async function savePaymentMethod(db: DbClient, ownerId: string, input: PaymentMethodInput, id?: string): Promise<PaymentMethod> {
  const value = normalized(input);
  return db.transaction(async (tx) => {
    await lockOwner(tx, ownerId);
    const existing = id ? await tx.payment_methods.findOne({ select: SELECT, where: { id, owner_id: ownerId }, lock: true }) : undefined;
    if (id && (!existing || existing.archived_at)) throw new HttpNotFoundError();
    const duplicate = await tx.payment_methods.findOne({
      select: { id: true },
      where: { owner_id: ownerId, pix_key_type: input.pixKeyType, pix_key: value.key }
    });
    if (duplicate && duplicate.id !== id) throw new HttpConflictError('Esta chave Pix já foi cadastrada.');
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
      where: { owner_id: ownerId, archived_at: { isNull: true } },
      take: 1
    });
    const row = await tx.payment_methods.insertOne({
      select: SELECT,
      data: {
        id: crypto.randomUUID(),
        owner: { id: ownerId },
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

export async function makeDefaultPaymentMethod(db: DbClient, ownerId: string, id: string): Promise<PaymentMethod> {
  return db.transaction(async (tx) => {
    await lockOwner(tx, ownerId);
    const target = await tx.payment_methods.findOne({ select: SELECT, where: { id, owner_id: ownerId }, lock: true });
    if (!target || target.archived_at) throw new HttpNotFoundError();
    await tx.payment_methods.updateMany({
      select: { id: true },
      where: { owner_id: ownerId, is_default: true },
      data: { is_default: false }
    });
    const changed = await tx.payment_methods.updateOne({
      select: { id: true },
      where: { id, owner_id: ownerId },
      data: { is_default: true, updated_at: new Date().toISOString() }
    });
    if (!changed) throw new HttpNotFoundError();
    const row = await tx.payment_methods.findOne({ select: SELECT, where: { id } });
    if (!row) throw new HttpNotFoundError();
    return dto(row);
  });
}

export async function archivePaymentMethod(db: DbClient, ownerId: string, id: string): Promise<void> {
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
        where: { owner_id: ownerId, archived_at: { isNull: true } },
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
