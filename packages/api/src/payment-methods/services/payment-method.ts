import type { Environment, Service } from '@ez4/common';
import type { Factory } from '@ez4/factory';
import { HttpNotFoundError } from '@ez4/gateway';
import type { PaymentMethod, PaymentMethodInput, PixSnapshot } from '@receivy/common';
import { ContactRepository } from '../../contacts/repositories/contact';
import type { Db, DbClient } from '../../database';
import { AccountRepository } from '../../users/repositories/account';
import { PixKeyTakenError } from '../errors';
import { PaymentMethodRepository } from '../repositories/payment-method';
import { normalizePaymentMethod } from '../utils/input';

export type PaymentMethodClient = {
  /** Creates a key, or edits one in place; the same key twice on one owner is refused whatever its scope. */
  save(ownerId: string, input: PaymentMethodInput, id?: string): Promise<PaymentMethod>;
  makeDefault(ownerId: string, id: string): Promise<PaymentMethod>;
  /** Archiving the default hands the title to the oldest live key of the scope. Already archived is a no-op. */
  archive(ownerId: string, id: string): Promise<void>;
};

export declare class PaymentMethodService extends Factory.Service<PaymentMethodClient> {
  handler: typeof createService;

  services: {
    db: Environment.Service<Db>;
  };
}

/** Makes `id` the default of its own scope; runs inside the caller's transaction. */
export async function electDefault(tx: DbClient, ownerId: string, id: string): Promise<PaymentMethod> {
  const target = await PaymentMethodRepository.get(tx, ownerId, id);

  if (!target || target.archivedAt) {
    throw new HttpNotFoundError();
  }

  await PaymentMethodRepository.clearDefault(tx, ownerId, target.contactId);
  await PaymentMethodRepository.markDefault(tx, id, new Date().toISOString());

  return { ...target, isDefault: true };
}

/** The key typed on a conta a pagar, filed under its receiving contact. Same key twice answers the same id. */
export async function upsertContactKey(tx: DbClient, ownerId: string, contactId: string, pix: PixSnapshot): Promise<string> {
  const value = normalizePaymentMethod({ pixKeyType: pix.keyType, pixKey: pix.key, label: pix.label });

  await ContactRepository.user(tx, ownerId, contactId);

  // Unscoped, like `save`'s duplicate check: the same key can only ever belong to one scope of the owner.
  const existing = await PaymentMethodRepository.byKey(tx, ownerId, pix.keyType, value.key);
  const now = new Date().toISOString();

  if (existing) {
    if (existing.contactId !== contactId) {
      throw new PixKeyTakenError();
    }

    if (existing.archivedAt) {
      // Resurrecting the scope's only key must not leave it without a default.
      const others = await PaymentMethodRepository.hasLive(tx, ownerId, contactId, existing.id);

      await PaymentMethodRepository.restore(tx, existing.id, !others, now);
    }

    return existing.id;
  }

  const others = await PaymentMethodRepository.hasLive(tx, ownerId, contactId);
  const inserted = await PaymentMethodRepository.insert(tx, {
    ownerId,
    contactId,
    keyType: pix.keyType,
    key: value.key,
    label: value.label,
    isDefault: !others,
    now
  });

  return inserted.id;
}

async function save(db: DbClient, ownerId: string, input: PaymentMethodInput, id?: string): Promise<PaymentMethod> {
  const value = normalizePaymentMethod(input);

  return db.transaction(async (tx) => {
    await AccountRepository.lock(tx, ownerId);

    if (input.contactId) {
      await ContactRepository.user(tx, ownerId, input.contactId);
    }

    const existing = id ? await PaymentMethodRepository.get(tx, ownerId, id, true) : null;

    if (id && (!existing || existing.archivedAt)) {
      throw new HttpNotFoundError();
    }

    const duplicate = await PaymentMethodRepository.byKey(tx, ownerId, input.pixKeyType, value.key);

    if (duplicate && duplicate.id !== id) {
      throw new PixKeyTakenError();
    }

    const now = new Date().toISOString();

    if (existing) {
      return PaymentMethodRepository.update(tx, ownerId, existing.id, { keyType: input.pixKeyType, key: value.key, label: value.label, now });
    }

    const anyLive = await PaymentMethodRepository.hasLive(tx, ownerId, input.contactId);

    return PaymentMethodRepository.insert(tx, {
      ownerId,
      contactId: input.contactId,
      keyType: input.pixKeyType,
      key: value.key,
      label: value.label,
      isDefault: !anyLive,
      now
    });
  });
}

async function archive(db: DbClient, ownerId: string, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    await AccountRepository.lock(tx, ownerId);

    const target = await PaymentMethodRepository.get(tx, ownerId, id, true);

    if (!target) {
      throw new HttpNotFoundError();
    }

    if (target.archivedAt) {
      return;
    }

    const now = new Date().toISOString();

    await PaymentMethodRepository.archive(tx, ownerId, id, now);

    if (!target.isDefault) {
      return;
    }

    const [replacement] = await PaymentMethodRepository.list(tx, ownerId, target.contactId ?? undefined);

    if (replacement) {
      await PaymentMethodRepository.markDefault(tx, replacement.id, now);
    }
  });
}

export function createService({ db }: Service.Context<PaymentMethodService>): PaymentMethodClient {
  return {
    save: (ownerId, input, id) => save(db, ownerId, input, id),
    makeDefault: (ownerId, id) =>
      db.transaction(async (tx) => {
        await AccountRepository.lock(tx, ownerId);

        return electDefault(tx, ownerId, id);
      }),
    archive: (ownerId, id) => archive(db, ownerId, id)
  };
}
