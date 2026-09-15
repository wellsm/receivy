import { deepEqual, equal } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { ChargeRepository } from '../../src/charges/repositories/charge';
import { ContactRepository } from '../../src/contacts/repositories/contact';
import { TimelineRepository } from '../../src/timeline/repositories/timeline';
import { cleanupUsers, createOnceCharge, createUser, db } from '../fixtures/financial';

const owner = '61000000-0000-4000-8000-0000000000b1';
const debtor = '61000000-0000-4000-8000-0000000000b2';
const version = '2026-09-13T12:00:00.000Z';

describe('avatars on people', () => {
  let chargeId = '';

  before(async () => {
    await cleanupUsers(db, [owner, debtor]);
    await createUser(db, { id: owner, email: 'owner-avatar@example.test', name: 'Dona' });
    await createUser(db, { id: debtor, email: 'debtor-avatar@example.test', name: 'Devedor' });
    await db.users.updateOne({ where: { id: debtor }, data: { avatar_updated_at: version } });
    await ContactRepository.save(db, owner, { name: 'Devedor', email: 'debtor-avatar@example.test' });
    chargeId = (await createOnceCharge(db, owner, 'avatar-people', { userId: debtor, amountCents: 1234, dueDate: '2026-09-01' })).chargeId;
  });

  after(async () => {
    await cleanupUsers(db, [owner, debtor]);
  });

  it('references the debtor photo on the charge detail and the owner timeline', async () => {
    const expected = { url: `avatars/${debtor}`, version };
    const detail = await ChargeRepository.get(db, owner, chargeId);

    deepEqual(detail.recipient.avatar, expected);
    deepEqual(detail.counterpartAvatar, expected);

    const page = await TimelineRepository.get(db, owner, {});
    const item = page.items.find((entry) => entry.charge.id === chargeId);

    deepEqual(item?.charge.counterpartAvatar, expected);
  });

  it('references no photo for a person without one', async () => {
    const detail = await ChargeRepository.get(db, debtor, chargeId);

    equal(detail.counterpartAvatar, null);
  });

  it('references the photo on the owner contact', async () => {
    const person = await ContactRepository.counterpartOf(db, debtor);

    deepEqual(person?.avatar, { url: `avatars/${debtor}`, version });
  });
});
