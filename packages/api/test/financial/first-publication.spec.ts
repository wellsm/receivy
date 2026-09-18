import { deepEqual, equal, rejects } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { Order } from '@ez4/database';
import { HttpNotFoundError } from '@ez4/gateway';
import { PixKeyType } from '@receivy/common';
import { ApiError } from '../../src/common/errors';
import { EventRepository } from '../../src/common/repositories/events';
import { publishChargeLink, revokeChargeLink } from '../../src/public/services/public-link';
import { LinkableType } from '../../src/public/schemas/link';
import { charges, cleanupUsers, contacts, createOnceCharge, createUser, db, paymentMethods } from '../fixtures/financial';
import { fakeNotice } from '../fixtures/scheduling';

const owner = randomUUID(),
  other = randomUUID();
const secret = 'first-publication-tests-only-secret';
const notice = fakeNotice({ secret });
const { context, sent } = notice;
let chargeId: string;

async function linkColumns() {
  // The link is a row of its own now: "revoked" means the live one is gone, not a column on the charge.
  const { records } = await db.links.findMany({
    select: { public_id: true, revoked_at: true },
    where: { linkable_type: LinkableType.Charge, linkable_id: chargeId },
    order: { created_at: Order.Desc },
    take: 1
  });
  const row = records[0];

  return { publicId: row?.public_id ?? null, revoked: !!row?.revoked_at };
}

describe('explicit first Pix publication', () => {
  before(async () => {
    await createUser(db, { id: owner, name: 'Owner', email: `${owner}@example.com` });
    await createUser(db, { id: other, name: 'Other', email: `${other}@example.com` });

    const person = await contacts.save(owner, { name: 'Debtor', email: 'publication-debtor@example.com' });

    chargeId = (await createOnceCharge(db, owner, 'first-pix', { userId: person.userId, amountCents: 100, dueDate: '2026-01-01' }, context))
      .chargeId;
  });
  after(async () => cleanupUsers(db, [owner, other]));
  it('keeps no-Pix creation possible but refuses first sharing and makes initial notice visibly wait', async () => {
    equal((await charges.get(owner, chargeId)).pix, null);
    equal((await charges.get(owner, chargeId)).sharingState, 'pix_required');

    await rejects(() => publishChargeLink(db, owner, chargeId, secret), ApiError);

    deepEqual(await linkColumns(), { publicId: null, revoked: false });
    equal(sent.emails.length, 0);
    equal(sent.pushes.length, 0);
    deepEqual((await EventRepository.list(db, chargeId, 'notice.skipped'))[0]?.payload, { template: 'initial', reason: 'pix_required' });
    equal((await EventRepository.list(db, chargeId, 'notice.sent')).length, 0);
  });
  it('assigns only an owned selected Pix snapshot once, releases notice once and preserves published history', async () => {
    const foreign = await paymentMethods.save(other, { pixKeyType: PixKeyType.Email, pixKey: 'foreign@example.com' });
    const first = await paymentMethods.save(owner, { pixKeyType: PixKeyType.Email, pixKey: 'first@example.com' });
    const second = await paymentMethods.save(owner, { pixKeyType: PixKeyType.Email, pixKey: 'second@example.com' });

    await rejects(() => publishChargeLink(db, owner, chargeId, secret, false, undefined, foreign.id), HttpNotFoundError);

    // A key the owner keeps about a contact ("how I pay this person") is private and never published.
    const padaria = await contacts.save(owner, { name: 'Padaria' });
    const contactKey = await paymentMethods.save(owner, {
      pixKeyType: PixKeyType.Email,
      pixKey: 'publication-padaria@example.com',
      contactId: padaria.id
    });

    await rejects(() => publishChargeLink(db, owner, chargeId, secret, false, undefined, contactKey.id), HttpNotFoundError);

    const [a, b] = await Promise.all(
      [1, 2].map(() => publishChargeLink(db, owner, chargeId, secret, false, undefined, first.id, context))
    );

    deepEqual(a, b);
    equal((await charges.get(owner, chargeId)).pix?.key, 'first@example.com');
    equal((await charges.get(owner, chargeId)).sharingState, 'ready');

    await rejects(() => publishChargeLink(db, owner, chargeId, secret, false, undefined, second.id), ApiError);

    // The creation notice that had nothing to say goes out exactly once, now that the link exists.
    equal(sent.emails.length, 1);
    equal(sent.emails[0]!.to, 'publication-debtor@example.com');
    equal((await EventRepository.list(db, chargeId, 'notice.sent')).length, 1);

    await publishChargeLink(db, owner, chargeId, secret, false, undefined, first.id, context);

    equal(sent.emails.length, 1, 'a later publication never repeats the hello');

    await paymentMethods.save(owner, { pixKeyType: PixKeyType.Email, pixKey: 'edited@example.com' }, first.id);

    equal((await charges.get(owner, chargeId)).pix?.key, 'first@example.com');
    equal(await db.events.count({ where: { eventable_id: chargeId, type: 'charge.pix_published' } }), 1);
  });
  it('never fills a previously published null-Pix record, including a revoked tombstone', async () => {
    await db.charges.updateOne({
      where: { id: chargeId },
      data: { payment_snapshot: null as unknown as undefined }
    });
    await revokeChargeLink(db, owner, chargeId);

    equal((await linkColumns()).revoked, true);
    equal((await charges.get(owner, chargeId)).sharingState, 'legacy_without_pix');

    const method = await paymentMethods.save(owner, { pixKeyType: PixKeyType.Email, pixKey: 'legacy@example.com' });

    await rejects(() => publishChargeLink(db, owner, chargeId, secret, true, undefined, method.id), ApiError);

    equal((await charges.get(owner, chargeId)).pix, null);
  });
});
