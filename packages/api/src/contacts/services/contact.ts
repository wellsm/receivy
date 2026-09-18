import type { Environment, Service } from '@ez4/common';
import type { Factory } from '@ez4/factory';
import { HttpBadRequestError, HttpNotFoundError } from '@ez4/gateway';
import { type Contact, type ContactInput, UserStatus } from '@receivy/common';
import { AllocationRepository } from '../../billings/repositories/allocation';
import { ChargeRepository } from '../../charges/repositories/charge';
import { EventRepository } from '../../common/repositories/events';
import type { Db, DbClient } from '../../database';
import { electDefault, upsertContactKey } from '../../payment-methods/services/payment-method';
import { ProofRepository } from '../../proofs/repositories/proof';
import { AccountRepository } from '../../users/repositories/account';
import { DuplicateContactError, EmailTakenError, LinkedContactError, NotLinkableError, OwnEmailError } from '../errors';
import { ContactRepository } from '../repositories/contact';
import { personName } from '../utils/person';

export const EMAIL_KEPT_MESSAGE = 'O e-mail de um contato não pode ser removido, só corrigido.';

export type ContactClient = {
  /** Creates an agenda entry, or edits one in place; the person behind it is created, found by e-mail or corrected. */
  save(ownerId: string, input: ContactInput, id?: string): Promise<Contact>;
  /** Already archived is a no-op. */
  archive(ownerId: string, id: string): Promise<void>;
};

export declare class ContactService extends Factory.Service<ContactClient> {
  handler: typeof createService;

  services: {
    db: Environment.Service<Db>;
  };
}

/** Finds or creates the agenda entry between the owner and an existing account (invite acceptance, first login). */
export async function ensure(tx: DbClient, ownerId: string, userId: string, now: string): Promise<string> {
  const existing = await ContactRepository.byUser(tx, ownerId, userId, true);

  if (!existing) {
    return ContactRepository.insert(tx, { ownerId, userId, now });
  }

  if (existing.archivedAt) {
    await ContactRepository.restore(tx, existing.id, now);
  }

  return existing.id;
}

/**
 * The owner says a guest who joined by invite is the person behind one of their e-mail-less contacts: every
 * row that named the placeholder now names the guest's account, the agenda entry keeps its nickname and the
 * placeholder disappears. Without an e-mail no other agenda could have found it, so the move stays local.
 */
export async function linkGuest(tx: DbClient, ownerId: string, contactId: string, userId: string, now: string): Promise<void> {
  const contact = await ContactRepository.row(tx, ownerId, contactId, true);

  if (!contact || contact.archivedAt) {
    throw new HttpNotFoundError();
  }

  const placeholder = await AccountRepository.person(tx, contact.userId, true);

  if (placeholder?.status !== UserStatus.Pending || placeholder.email) {
    throw new NotLinkableError();
  }

  if (placeholder.id === userId) {
    return;
  }

  if (await ContactRepository.countOtherAgendas(tx, placeholder.id, ownerId)) {
    throw new NotLinkableError();
  }

  const own = await ContactRepository.byUser(tx, ownerId, userId);

  if (own) {
    await ContactRepository.remove(tx, own.id);
  }

  await ContactRepository.repoint(tx, contact.id, userId, now);
  // A placeholder sits on either side of the money once it is a payee; the owner is never one.
  await ChargeRepository.reassignPerson(tx, placeholder.id, userId, now);
  // The payee of a conta a pagar is an allocation too, so the line above already reaches them.
  await AllocationRepository.reassign(tx, placeholder.id, userId);
  await ProofRepository.reassignSender(tx, placeholder.id, userId);
  await EventRepository.reassignActor(tx, placeholder.id, userId);
  await AccountRepository.remove(tx, placeholder.id);
}

/** The account the entry points at after the edit: corrected, found by e-mail, or created as a placeholder. */
async function resolvePerson(tx: DbClient, ownerId: string, input: ContactInput, currentUserId: string | undefined, now: string): Promise<string> {
  const current = currentUserId ? await AccountRepository.person(tx, currentUserId, true) : null;

  if (currentUserId && !current) {
    throw new HttpNotFoundError();
  }

  if (current?.status === UserStatus.Active) {
    // An active account owns its name and e-mail; the agenda only keeps the nickname it uses.
    if (input.name !== personName(current) || input.email !== (current.email ?? undefined)) {
      throw new LinkedContactError();
    }

    return current.id;
  }

  if (current) {
    // A pending account still belongs to whoever typed it: any agenda holding it may fix name and e-mail.
    // Once an e-mail exists other agendas may have found the account through it, so it never goes blank again.
    if (current.email && !input.email) {
      throw new HttpBadRequestError(EMAIL_KEPT_MESSAGE);
    }

    if (input.email && input.email !== current.email && (await AccountRepository.byEmail(tx, input.email))) {
      throw new EmailTakenError();
    }

    await AccountRepository.rename(tx, current.id, { name: input.name, email: input.email }, now);

    return current.id;
  }

  const match = input.email ? await AccountRepository.byEmail(tx, input.email, true) : null;

  if (!match) {
    return AccountRepository.insertPending(tx, { name: input.name, email: input.email, now });
  }

  const duplicate = await ContactRepository.byUser(tx, ownerId, match.id);

  if (duplicate && !duplicate.archivedAt) {
    throw new DuplicateContactError();
  }

  if (duplicate) {
    await ContactRepository.remove(tx, duplicate.id);
  }

  if (match.id === ownerId) {
    throw new OwnEmailError();
  }

  // Whoever holds an account already named themself; a pending one takes the name typed now.
  if (match.status === UserStatus.Pending) {
    await AccountRepository.rename(tx, match.id, { name: input.name }, now);
  }

  return match.id;
}

async function save(db: DbClient, ownerId: string, input: ContactInput, id?: string): Promise<Contact> {
  return db.transaction(async (tx) => {
    // Serialize agenda mutations so two concurrent inserts cannot both pass the friendly duplicate check.
    await AccountRepository.lock(tx, ownerId);

    const now = new Date().toISOString();
    const existing = id ? await ContactRepository.row(tx, ownerId, id, true) : null;

    if (id && (!existing || existing.archivedAt)) {
      throw new HttpNotFoundError();
    }

    const userId = await resolvePerson(tx, ownerId, input, existing?.userId, now);
    const contactId = existing
      ? existing.id
      : await ContactRepository.insert(tx, { ownerId, userId, nickname: input.nickname, now });

    if (existing) {
      await ContactRepository.setNickname(tx, ownerId, contactId, input.nickname, now);
    }

    if (input.paymentMethod) {
      const keyId = await upsertContactKey(tx, ownerId, contactId, {
        keyType: input.paymentMethod.pixKeyType,
        key: input.paymentMethod.pixKey,
        label: input.paymentMethod.label ?? 'Pix'
      });

      await electDefault(tx, ownerId, keyId);
    }

    return ContactRepository.get(tx, ownerId, contactId);
  });
}

async function archive(db: DbClient, ownerId: string, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    await AccountRepository.lock(tx, ownerId);

    const contact = await ContactRepository.row(tx, ownerId, id, true);

    if (!contact) {
      throw new HttpNotFoundError();
    }

    if (contact.archivedAt) {
      return;
    }

    await ContactRepository.archive(tx, ownerId, id, new Date().toISOString());
  });
}

export function createService({ db }: Service.Context<ContactService>): ContactClient {
  return {
    save: (ownerId, input, id) => save(db, ownerId, input, id),
    archive: (ownerId, id) => archive(db, ownerId, id)
  };
}
