import { deepEqual, equal, rejects } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { HttpNotFoundError } from '@ez4/gateway';
import { getCharge } from '../../src/charges/repositories/charge';
import { ApiError } from '../../src/common/errors';
import { listEvents } from '../../src/common/repositories/events';
import { saveContact } from '../../src/contacts/repositories/contact';
import { savePaymentMethod } from '../../src/payment-methods/repositories/payment-method';
import { createOrRotatePublicLink, revokePublicLink } from '../../src/public/repositories/public-link';
import { cleanupUsers, createOnceCharge, createUser, db } from '../fixtures/financial';
import { fakeNotice } from '../fixtures/scheduling';

const owner = randomUUID(),
  other = randomUUID();
const secret = 'first-publication-tests-only-secret';
const notice = fakeNotice({ secret });
const { context, sent } = notice;
let chargeId: string;

async function linkColumns() {
  const row = await db.charges.findOne({ select: { public_id: true, link_revoked_at: true }, where: { id: chargeId } });
  return { publicId: row?.public_id ?? null, revoked: !!row?.link_revoked_at };
}

describe('explicit first Pix publication', () => {
  before(async () => {
    await createUser(db, { id: owner, name: 'Owner', email: `${owner}@example.com` });
    await createUser(db, { id: other, name: 'Other', email: `${other}@example.com` });
    const person = await saveContact(db, owner, { name: 'Debtor', email: 'publication-debtor@example.com' });
    chargeId = (await createOnceCharge(db, owner, 'first-pix', { userId: person.userId, amountCents: 100, dueDate: '2030-01-01' }, context))
      .chargeId;
  });
  after(async () => cleanupUsers(db, [owner, other]));
  it('keeps no-Pix creation possible but refuses first sharing and makes initial notice visibly wait', async () => {
    equal((await getCharge(db, owner, chargeId)).pix, null);
    equal((await getCharge(db, owner, chargeId)).sharingState, 'pix_required');
    await rejects(() => createOrRotatePublicLink(db, owner, chargeId, secret), ApiError);
    deepEqual(await linkColumns(), { publicId: null, revoked: false });
    equal(sent.emails.length, 0);
    equal(sent.pushes.length, 0);
    deepEqual((await listEvents(db, chargeId, 'notice.skipped'))[0]?.payload, { template: 'initial', reason: 'pix_required' });
    equal((await listEvents(db, chargeId, 'notice.sent')).length, 0);
  });
  it('assigns only an owned selected Pix snapshot once, releases notice once and preserves published history', async () => {
    const foreign = await savePaymentMethod(db, other, { pixKeyType: 'email', pixKey: 'foreign@example.com' });
    const first = await savePaymentMethod(db, owner, { pixKeyType: 'email', pixKey: 'first@example.com' });
    const second = await savePaymentMethod(db, owner, { pixKeyType: 'email', pixKey: 'second@example.com' });
    await rejects(() => createOrRotatePublicLink(db, owner, chargeId, secret, false, undefined, foreign.id), HttpNotFoundError);
    const [a, b] = await Promise.all(
      [1, 2].map(() => createOrRotatePublicLink(db, owner, chargeId, secret, false, undefined, first.id, context))
    );
    deepEqual(a, b);
    equal((await getCharge(db, owner, chargeId)).pix?.key, 'first@example.com');
    equal((await getCharge(db, owner, chargeId)).sharingState, 'ready');
    await rejects(() => createOrRotatePublicLink(db, owner, chargeId, secret, false, undefined, second.id), ApiError);
    // The creation notice that had nothing to say goes out exactly once, now that the link exists.
    equal(sent.emails.length, 1);
    equal(sent.emails[0]!.to, 'publication-debtor@example.com');
    equal((await listEvents(db, chargeId, 'notice.sent')).length, 1);
    await createOrRotatePublicLink(db, owner, chargeId, secret, false, undefined, first.id, context);
    equal(sent.emails.length, 1, 'a later publication never repeats the hello');
    await savePaymentMethod(db, owner, { pixKeyType: 'email', pixKey: 'edited@example.com' }, first.id);
    equal((await getCharge(db, owner, chargeId)).pix?.key, 'first@example.com');
    equal(await db.events.count({ where: { eventable_id: chargeId, type: 'charge.pix_published' } }), 1);
  });
  it('never fills a previously published null-Pix record, including a revoked tombstone', async () => {
    await db.charges.updateOne({
      where: { id: chargeId },
      data: { pix_key_snapshot: null as unknown as undefined, pix_key_type_snapshot: null as unknown as undefined }
    });
    await revokePublicLink(db, owner, chargeId);
    equal((await linkColumns()).revoked, true);
    equal((await getCharge(db, owner, chargeId)).sharingState, 'legacy_without_pix');
    const method = await savePaymentMethod(db, owner, { pixKeyType: 'email', pixKey: 'legacy@example.com' });
    await rejects(() => createOrRotatePublicLink(db, owner, chargeId, secret, true, undefined, method.id), ApiError);
    equal((await getCharge(db, owner, chargeId)).pix, null);
  });
});
