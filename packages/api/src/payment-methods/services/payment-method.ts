import type { Environment, Service } from '@ez4/common';
import type { Factory } from '@ez4/factory';
import { HttpBadRequestError, HttpNotFoundError } from '@ez4/gateway';
import { type PaymentMethod, type PaymentMethodInput, PaymentProvider, type PixSnapshot } from '@receivy/common';
import { paymentLinkProvider } from '../../charges/services/payment-link';
import { enforceQuota } from '../../common/utils/throttle';
import { ContactRepository } from '../../contacts/repositories/contact';
import type { Db, DbClient } from '../../database';
import { AccountRepository } from '../../users/repositories/account';
import type { PaymentLinkProvider } from '../../vendors/infinitepay/types';
import { InfinitePayCheckoutDisabledError, PaymentLinkUnavailableError, PaymentMethodTakenError } from '../errors';
import { PaymentMethodRepository } from '../repositories/payment-method';
import { type NormalizedPaymentMethod, normalizePaymentMethod } from '../utils/input';

export type PaymentMethodClient = {
  /** Creates a method, or edits one in place; the same value twice on one owner is refused whatever its scope. */
  save(ownerId: string, input: PaymentMethodInput, id?: string): Promise<PaymentMethod>;
  makeDefault(ownerId: string, id: string): Promise<PaymentMethod>;
  /** Archiving the default hands the title to the oldest live method of the scope. Already archived is a no-op. */
  archive(ownerId: string, id: string): Promise<void>;
};

export declare class PaymentMethodService extends Factory.Service<PaymentMethodClient> {
  handler: typeof createService;

  variables: {
    PUBLIC_WEB_ORIGIN: Environment.VariableOrValue<'PUBLIC_WEB_ORIGIN', 'http://localhost:3000'>;
    APP_STAGE: Environment.Variable<'APP_STAGE'>;
    PAYMENT_METHOD_LINK: Environment.VariableOrValue<'PAYMENT_METHOD_LINK', 'disabled'>;
  };

  services: {
    db: Environment.Service<Db>;
    variables: Environment.ServiceVariables;
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
  const method = normalizePaymentMethod({ provider: PaymentProvider.Pix, kind: pix.keyType, value: pix.key, label: pix.label });

  await ContactRepository.user(tx, ownerId, contactId);

  // Unscoped, like `save`'s duplicate check: the same key can only ever belong to one scope of the owner.
  const existing = await PaymentMethodRepository.byValue(tx, ownerId, PaymentProvider.Pix, method.value);
  const now = new Date().toISOString();

  if (existing) {
    if (existing.contactId !== contactId) {
      throw new PaymentMethodTakenError();
    }

    if (existing.archivedAt) {
      // Resurrecting the scope's only key must not leave it without a default.
      const others = await PaymentMethodRepository.hasLive(tx, ownerId, contactId, existing.id);

      await PaymentMethodRepository.restore(tx, existing.id, !others, now);
    }

    return existing.id;
  }

  const others = await PaymentMethodRepository.hasLive(tx, ownerId, contactId);
  const inserted = await PaymentMethodRepository.insert(tx, { ownerId, contactId, ...method, isDefault: !others, now });

  return inserted.id;
}

/**
 * InfinitePay has no "does this handle exist" call: creating a one-real link is the probe. There is no way to
 * delete it afterwards; nobody pays it. A disabled checkout carries the switch's url back to the client.
 */
async function probeHandle(links: PaymentLinkProvider, handle: string): Promise<void> {
  const result = await links.createLink({
    handle,
    orderNsu: `probe:${crypto.randomUUID()}`,
    items: [{ quantity: 1, price: 100, description: 'Validação Receivy' }]
  });

  if (result.status === 'checkout_disabled') {
    throw new InfinitePayCheckoutDisabledError(result.redirectUrl);
  }

  if (result.status === 'unavailable') {
    throw new PaymentLinkUnavailableError();
  }
}

async function save(db: DbClient, links: PaymentLinkProvider, ownerId: string, input: PaymentMethodInput, id?: string): Promise<PaymentMethod> {
  const method: NormalizedPaymentMethod = normalizePaymentMethod(input);
  const contactId = input.provider === PaymentProvider.Pix ? input.contactId : undefined;

  if (input.provider === PaymentProvider.InfinitePay) {
    // Best-effort pre-flight: the same checks the transaction runs, run once more so a request bound to fail
    // never burns a real InfinitePay link. The transaction below stays the authoritative guard either way.
    const existing = id ? await PaymentMethodRepository.get(db, ownerId, id) : null;

    if (id && (!existing || existing.archivedAt)) {
      throw new HttpNotFoundError();
    }

    if (existing?.contactId) {
      throw new HttpBadRequestError('Um contato só recebe por Pix.');
    }

    const duplicate = await PaymentMethodRepository.byValue(db, ownerId, method.provider, method.value);

    if (duplicate && duplicate.id !== id) {
      throw new PaymentMethodTakenError();
    }

    // The handle did not change: it was already validated, no need to probe (and throttle) again.
    if (!existing || existing.value !== method.value) {
      await enforceQuota(db, `infinitepay-probe:${ownerId}`, 10);
      await probeHandle(links, method.value);
    }
  }

  return db.transaction(async (tx) => {
    await AccountRepository.lock(tx, ownerId);

    if (contactId) {
      await ContactRepository.user(tx, ownerId, contactId);
    }

    const existing = id ? await PaymentMethodRepository.get(tx, ownerId, id, true) : null;

    if (id && (!existing || existing.archivedAt)) {
      throw new HttpNotFoundError();
    }

    // A contact key is always Pix: nobody pays a person through their InfiniteTag.
    if (existing?.contactId && method.provider !== PaymentProvider.Pix) {
      throw new HttpBadRequestError('Um contato só recebe por Pix.');
    }

    const duplicate = await PaymentMethodRepository.byValue(tx, ownerId, method.provider, method.value);

    if (duplicate && duplicate.id !== id) {
      throw new PaymentMethodTakenError();
    }

    const now = new Date().toISOString();

    if (existing) {
      return PaymentMethodRepository.update(tx, ownerId, existing.id, { ...method, now });
    }

    const anyLive = await PaymentMethodRepository.hasLive(tx, ownerId, contactId);

    return PaymentMethodRepository.insert(tx, { ownerId, contactId, ...method, isDefault: !anyLive, now });
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

export function createService({ db, variables }: Service.Context<PaymentMethodService>): PaymentMethodClient {
  const links = paymentLinkProvider(variables);

  return {
    save: (ownerId, input, id) => save(db, links, ownerId, input, id),
    makeDefault: (ownerId, id) =>
      db.transaction(async (tx) => {
        await AccountRepository.lock(tx, ownerId);

        return electDefault(tx, ownerId, id);
      }),
    archive: (ownerId, id) => archive(db, ownerId, id)
  };
}
