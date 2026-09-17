import { equal, rejects } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { HttpNotFoundError } from '@ez4/gateway';
import { PixKeyType } from '@receivy/common';
import { ContactRepository } from '../../src/contacts/repositories/contact';
import { PaymentMethodRepository } from '../../src/payment-methods/repositories/payment-method';
import { cleanupUsers, createUser, db } from '../fixtures/financial';

const OWNER = '91000000-0000-4000-8000-000000000001';
let padaria: string;

describe('contact keys', () => {
  before(async () => {
    await createUser(db, { id: OWNER, email: 'contact-keys-owner@example.com', name: 'Dona' });
    padaria = (await ContactRepository.save(db, OWNER, { name: 'Padaria' })).id;
  });

  after(async () => {
    await cleanupUsers(db, [OWNER]);
  });

  it('keeps a contact key apart from the owner keys and defaults each scope on its own', async () => {
    const mine = await PaymentMethodRepository.save(db, OWNER, { pixKeyType: PixKeyType.Email, pixKey: 'dona@example.com' });
    const theirs = await PaymentMethodRepository.save(db, OWNER, { pixKeyType: PixKeyType.Email, pixKey: 'padaria@example.com', contactId: padaria });

    equal(mine.contactId, null);
    equal(mine.isDefault, true);
    equal(theirs.contactId, padaria);
    equal(theirs.isDefault, true);
    equal((await PaymentMethodRepository.list(db, OWNER)).map((method) => method.id).includes(theirs.id), false);
    equal((await PaymentMethodRepository.list(db, OWNER, false, padaria)).map((method) => method.id).join(), theirs.id);
  });

  it('makes a second contact key the default without touching the owner default', async () => {
    const mine = (await PaymentMethodRepository.list(db, OWNER))[0]!;
    const second = await PaymentMethodRepository.save(db, OWNER, { pixKeyType: PixKeyType.Phone, pixKey: '+5511999990000', contactId: padaria });

    await PaymentMethodRepository.makeDefault(db, OWNER, second.id);

    const keys = await PaymentMethodRepository.list(db, OWNER, false, padaria);
    equal(keys.filter((method) => method.isDefault).map((method) => method.id).join(), second.id);
    equal((await PaymentMethodRepository.list(db, OWNER)).find((method) => method.id === mine.id)?.isDefault, true);
  });

  it('upserts the contact key a billing types and answers the same id twice', async () => {
    const first = await PaymentMethodRepository.upsertContactKey(db, OWNER, padaria, { keyType: PixKeyType.Cpf, key: '52998224725', label: 'Padaria' });
    const again = await PaymentMethodRepository.upsertContactKey(db, OWNER, padaria, { keyType: PixKeyType.Cpf, key: '529.982.247-25', label: 'Padaria' });

    equal(first, again);
  });

  it('refuses a key for a contact the owner does not have', async () => {
    await rejects(
      () => PaymentMethodRepository.save(db, OWNER, { pixKeyType: PixKeyType.Email, pixKey: 'x@example.com', contactId: crypto.randomUUID() }),
      HttpNotFoundError
    );
  });
});
