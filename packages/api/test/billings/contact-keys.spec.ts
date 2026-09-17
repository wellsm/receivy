import { equal, rejects } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { HttpNotFoundError } from '@ez4/gateway';
import { BillingRecurrence, Direction, PixKeyType } from '@receivy/common';
import { BillingRepository } from '../../src/billings/repositories/billing';
import { ContactRepository } from '../../src/contacts/repositories/contact';
import { PixKeyTakenError } from '../../src/payment-methods/errors';
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

  it('refuses to file under a contact a key the owner already holds elsewhere', async () => {
    await rejects(
      () => PaymentMethodRepository.upsertContactKey(db, OWNER, padaria, { keyType: PixKeyType.Email, key: 'dona@example.com', label: 'Dona' }),
      PixKeyTakenError
    );
  });

  it('brings an archived contact key back as the default when its scope has none', async () => {
    const id = await PaymentMethodRepository.upsertContactKey(db, OWNER, padaria, { keyType: PixKeyType.Random, key: '123e4567-e89b-12d3-a456-426614174000', label: 'Padaria' });
    for (const method of await PaymentMethodRepository.list(db, OWNER, false, padaria)) {
      await PaymentMethodRepository.archive(db, OWNER, method.id);
    }

    const back = await PaymentMethodRepository.upsertContactKey(db, OWNER, padaria, { keyType: PixKeyType.Random, key: '123e4567-e89b-12d3-a456-426614174000', label: 'Padaria' });

    equal(back, id);
    equal((await PaymentMethodRepository.list(db, OWNER, false, padaria)).map((method) => `${method.id}:${method.isDefault}`).join(), `${id}:true`);
  });

  it('creates a conta a pagar from a contact, files its key and pays the contact user', async () => {
    const billing = await BillingRepository.create(db, OWNER, 'contact-keys-1', {
      recurrence: BillingRecurrence.Once,
      description: 'Pão',
      totalCents: 1500,
      startDate: '2026-10-05',
      timezone: 'America/Sao_Paulo',
      contactId: padaria,
      pix: { keyType: PixKeyType.Email, key: 'padaria@example.com', label: 'Padaria' }
    });
    const detail = await BillingRepository.get(db, OWNER, billing.id);

    equal(detail.type, Direction.Payable);
    equal(detail.contact?.id, padaria);
    equal(detail.pix?.key, 'padaria@example.com');

    const keys = await PaymentMethodRepository.list(db, OWNER, false, padaria);

    equal(keys.some((method) => method.id === detail.paymentMethodId), true);

    const charge = detail.charges[0]!;
    const contactUserId = (await ContactRepository.user(db, OWNER, padaria)).userId;

    equal(charge.direction, Direction.Payable);
    equal(charge.hasPix, true);

    const row = await db.charges.findOne({ select: { creditor_id: true, debtor_id: true }, where: { id: charge.id } });

    equal(row?.creditor_id, contactUserId, 'the contact receives: they sit on the creditor side');
    equal(row?.debtor_id, OWNER, 'the owner pays their own bill');
  });
});
