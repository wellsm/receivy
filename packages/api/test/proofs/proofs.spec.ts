import { deepEqual, equal, notEqual, ok, rejects } from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { HttpForbiddenError, HttpNotFoundError } from '@ez4/gateway';
import { BucketTester } from '@ez4/local-storage/test';
import { PixKeyType, ProofMime, ProofState } from '@receivy/common';
import { ChargeInReviewError } from '../../src/charges/errors';
import { ChargeRepository } from '../../src/charges/repositories/charge';
import { ApiError, TooManyRequestsError } from '../../src/common/errors';
import { EventRepository } from '../../src/common/repositories/events';
import { ContactRepository } from '../../src/contacts/repositories/contact';
import { NotificationRepository } from '../../src/notifications/repositories/notification';
import { PaymentMethodRepository } from '../../src/payment-methods/repositories/payment-method';
import { publicStartProofUploadHandler } from '../../src/proofs/endpoints/public-start-upload';
import { publicWithdrawProofHandler } from '../../src/proofs/endpoints/public-withdraw';
import { ProofDeclarationForbiddenError, ProofInvalidFileError, UploadMissingError } from '../../src/proofs/errors';
import { ProofRepository } from '../../src/proofs/repositories/proof';

import type { UploadExpirySchedule } from '../../src/proofs/schedulers/upload-expiry';
import { bucketProofStorage } from '../../src/proofs/services/bucket-storage';
import type { ProofStorage } from '../../src/proofs/services/storage';
import { throttleProof } from '../../src/proofs/services/throttle';
import { uploadExpiryIdentifier } from '../../src/proofs/utils/expiry';
import { PublicLinkRepository } from '../../src/public/repositories/public-link';
import { TimelineRepository } from '../../src/timeline/repositories/timeline';
import { cleanupUsers, createOnceCharge, createUser, db } from '../fixtures/financial';
import { fakeNotice, fakeScheduler } from '../fixtures/scheduling';

const OWNER = 'a1111111-1111-4111-8111-111111111111';
const DEBTOR = 'a2222222-2222-4222-8222-222222222222';
const OTHER = 'a3333333-3333-4333-8333-333333333333';
const SECRET = 'proof-native-test-secret-with-enough-entropy';

// Native service-test boundary: EZ4's typed bucket tester holds the bytes, the API only signs and reads.
const bucket = BucketTester.getClientMock('ProofFiles', { keys: {} });
const storage = bucketProofStorage(bucket);
const expiry = fakeScheduler<UploadExpirySchedule>();

const actor = { userId: DEBTOR };
const input = { filename: 'proof.pdf', mime: ProofMime.Pdf, size: 14 };
const PDF = Buffer.from('%PDF-1.7\nproof');

let counter = 0;
let debtorId: string;

async function charge(dueDate = '2027-01-01') {
  if (!debtorId) {
    debtorId = (await ContactRepository.save(db, OWNER, { name: 'Proof Debtor', email: 'proof-debtor@example.com' })).userId;
  }

  return (await createOnceCharge(db, OWNER, `proof-${++counter}`, { userId: debtorId, amountCents: 1234, dueDate })).chargeId;
}

async function row(id: string) {
  const found = await db.charges.findOne({
    select: {
      state: true,
      paid_at: true,
      proof_state: true,
      proof_kind: true,
      proof_file: true,
      proof_sender_user_id: true,
      proof_actor_hash: true,
      proof_expires_at: true,
      proof_sent_at: true,
      proof_reviewed_at: true,
      proof_reason: true
    },
    where: { id }
  });

  ok(found);

  return found;
}

/** Reserves the slot and returns the key the bucket event will name. */
async function reserve(id: string, who: Parameters<typeof ProofRepository.startUpload>[4] = actor, now?: number) {
  const ticket = await ProofRepository.startUpload(db, storage, expiry, id, who, input, now);
  const key = (await row(id)).proof_file!.key;

  return { ticket, key };
}

/** The whole happy path: a reserved slot, the bytes landing, the bucket event turning them into a pending proof. */
async function upload(id: string, who: Parameters<typeof ProofRepository.startUpload>[4] = actor) {
  const { key } = await reserve(id, who);

  await bucket.write(key, PDF);

  equal(await ProofRepository.receiveObject(db, storage, key), 'accepted');

  return key;
}

async function publicActor(id: string) {
  const link = await PublicLinkRepository.createOrRotate(db, OWNER, id, SECRET);

  return { token: link.token, secret: SECRET };
}

async function eventTypes(id: string) {
  return (await EventRepository.list(db, id)).map((event) => event.type);
}

describe('proof slot, bucket event and review on PostgreSQL', () => {
  before(async () => {
    const [database] = await db.rawQuery('SELECT current_database() AS name');

    equal(database?.['name'], 'receivy_tests');

    await createUser(db, { id: OWNER, email: 'proof-owner@example.com', name: 'Proof Owner' });
    await PaymentMethodRepository.save(db, OWNER, { pixKeyType: PixKeyType.Email, pixKey: 'proof-owner@example.com' });
    await createUser(db, { id: DEBTOR, email: 'proof-debtor@example.com', name: 'Proof Debtor' });
    await createUser(db, { id: OTHER, email: 'proof-other@example.com', name: 'Other' });
  });

  after(async () => cleanupUsers(db, [OWNER, DEBTOR, OTHER]));

  it('reserves the slot only for the side that pays and arms its expiry', async () => {
    const id = await charge();
    const now = Date.now();

    await rejects(() => ProofRepository.startUpload(db, storage, expiry, id, { userId: OWNER }, input), HttpForbiddenError);
    await rejects(() => ProofRepository.startUpload(db, storage, expiry, id, { userId: OTHER }, input), HttpForbiddenError);
    await rejects(() => ProofRepository.startUpload(db, storage, expiry, id, actor, { ...input, mime: 'text/html' as never }), ApiError);
    await rejects(() => ProofRepository.startUpload(db, storage, expiry, id, actor, { ...input, size: 0 }), ApiError);

    const { ticket, key } = await reserve(id, actor, now);

    ok(ticket.uploadUrl.includes(key), 'the signed PUT targets the reserved key');
    equal(ticket.expiresAt, new Date(now + ProofRepository.UPLOAD_TTL_MS).toISOString());
    deepEqual(expiry.events.get(uploadExpiryIdentifier(id)), { date: new Date(ticket.expiresAt), event: { chargeId: id, key } });

    const reserved = await row(id);

    equal(reserved.proof_state, 'uploading');
    equal(reserved.proof_sender_user_id, DEBTOR);
    equal(reserved.proof_actor_hash, ProofRepository.actorHash(actor));
    equal(reserved.proof_expires_at, ticket.expiresAt);
    ok(key.startsWith(`proofs/${id}/`));

    // A reserved slot is nobody's business yet: neither side sees a proof.
    equal((await ChargeRepository.get(db, OWNER, id)).proof, null);
    equal((await ChargeRepository.get(db, OWNER, id)).proofState, null);

    // The public link reserves its own slot on a fresh charge, with no sender account behind it.
    const publicId = await charge();
    const token = await publicActor(publicId);

    await reserve(publicId, token);

    const anonymous = await row(publicId);

    equal(anonymous.proof_state, 'uploading');
    equal(anonymous.proof_sender_user_id ?? null, null);
    equal(anonymous.proof_actor_hash, ProofRepository.actorHash(token));
  });

  it('lets the same actor re-reserve, refuses another actor while the slot is live and drops the abandoned key', async () => {
    const id = await charge();
    const token = await publicActor(id);
    const first = await reserve(id);

    await bucket.write(first.key, Buffer.from('half-uploaded'));
    await rejects(() => ProofRepository.startUpload(db, storage, expiry, id, token, input), ApiError);

    const second = await reserve(id);

    notEqual(second.key, first.key);
    equal(await bucket.exists(first.key), false, 'the abandoned object has no row pointing at it any more');
    equal(expiry.events.get(uploadExpiryIdentifier(id))?.event.key, second.key);

    // Once the slot has expired it is up for grabs again, whoever held it.
    const later = Date.now() + ProofRepository.UPLOAD_TTL_MS + 1;
    const taken = await reserve(id, token, later);

    notEqual(taken.key, second.key);
    equal((await row(id)).proof_actor_hash, ProofRepository.actorHash(token));
  });

  it('turns the landed bytes into a pending proof with its hash and history', async () => {
    // Due this month at the latest, so the feed assertion below can see it.
    const id = await charge('2026-09-01');
    const key = await upload(id);
    const stored = await row(id);

    equal(stored.proof_state, 'pending');
    equal(stored.proof_file?.sha256, createHash('sha256').update(PDF).digest('hex'));
    equal(stored.proof_file?.size, PDF.length);
    equal(stored.proof_expires_at ?? null, null);
    ok(stored.proof_sent_at);

    const uploaded = (await EventRepository.list(db, id, 'proof.uploaded'))[0];

    equal(uploaded?.actor_user_id, DEBTOR);
    deepEqual(uploaded?.payload, { name: 'proof.pdf', mime: 'application/pdf', size: 14 });

    // One proof at a time: the slot stays taken while the file is under review.
    const token = await publicActor(id);

    await rejects(() => ProofRepository.startUpload(db, storage, expiry, id, actor, input), ApiError);
    await rejects(() => ProofRepository.startUpload(db, storage, expiry, id, token, input), ApiError);

    const mine = (await ChargeRepository.get(db, DEBTOR, id)).proof;
    const theirs = (await ChargeRepository.get(db, OWNER, id)).proof;

    equal(mine?.state, 'pending');
    equal(mine?.sentByViewer, true);
    equal(theirs?.sentByViewer, false);
    deepEqual(theirs?.file, { name: 'proof.pdf', mime: 'application/pdf', size: 14 });
    equal((await ChargeRepository.get(db, OWNER, id)).proofState, 'pending');

    // The bucket may deliver the same event twice: the attached file must survive the replay.
    equal(await ProofRepository.receiveObject(db, storage, key), 'ignored');
    equal(await bucket.exists(key), true);
    equal((await row(id)).proof_state, 'pending');
    ok((await TimelineRepository.get(db, OWNER, {})).items.some((item) => item.charge.id === id && item.charge.proofState === 'pending'));
  });

  it('attaches the landed bytes when the client completes, whether or not the bucket event comes', async () => {
    const id = await charge();
    const { key } = await reserve(id);

    // Nothing landed yet: an empty slot cannot be completed, and it stays reserved.
    await rejects(() => ProofRepository.completeUpload(db, storage, id, actor), UploadMissingError);
    equal((await row(id)).proof_state, 'uploading');

    await bucket.write(key, PDF);

    await rejects(() => ProofRepository.completeUpload(db, storage, id, { userId: OTHER }));
    equal((await ProofRepository.completeUpload(db, storage, id, actor)).proof_state, 'pending');
    equal((await row(id)).proof_file?.sha256, createHash('sha256').update(PDF).digest('hex'));

    // The late bucket event and a retried complete both find nothing to do.
    equal(await ProofRepository.receiveObject(db, storage, key), 'ignored');
    equal((await ProofRepository.completeUpload(db, storage, id, actor)).proof_state, 'pending');
    equal((await EventRepository.list(db, id, 'proof.uploaded')).length, 1);

    // A file that fails validation releases the slot and says why.
    const invalidId = await charge();
    const invalid = await reserve(invalidId);

    await bucket.write(invalid.key, Buffer.from('not a proof file'));
    await rejects(() => ProofRepository.completeUpload(db, storage, invalidId, actor), ProofInvalidFileError);
    equal((await row(invalidId)).proof_state ?? null, null);
  });

  it('releases the slot and drops the bytes when the file is invalid or lies about its size', async () => {
    const id = await charge();
    const { key } = await reserve(id);

    await bucket.write(key, Buffer.from('<html>bad</html>'));

    equal(await ProofRepository.receiveObject(db, storage, key), 'invalid');

    const cleared = await row(id);

    equal(cleared.proof_state ?? null, null);
    equal(cleared.proof_file ?? null, null);
    equal(cleared.proof_actor_hash ?? null, null);
    equal(await bucket.exists(key), false);

    const invalid = (await EventRepository.list(db, id, 'proof.invalid'))[0];

    equal(invalid?.actor_user_id, DEBTOR);
    equal(invalid?.payload['name'], 'proof.pdf');
    ok(invalid?.payload['reason']);

    // A valid PDF that is not the size the client declared is refused the same way.
    const oversized = await reserve(id);

    await bucket.write(oversized.key, Buffer.concat([PDF, Buffer.from(' and then some')]));

    equal(await ProofRepository.receiveObject(db, storage, oversized.key), 'invalid');
    equal((await row(id)).proof_state ?? null, null);
    equal(await bucket.exists(oversized.key), false);
    equal((await EventRepository.list(db, id, 'proof.invalid')).length, 2);

    // The slot is free again, so the same person may try once more.
    await upload(id);
  });

  it('ignores an unknown or stale key, drops its object, and keeps the slot on a storage outage', async () => {
    const id = await charge();
    const stray = `proofs/${id}/${crypto.randomUUID()}`;

    await bucket.write(stray, PDF);

    equal(await ProofRepository.receiveObject(db, storage, stray), 'ignored');
    equal(await bucket.exists(stray), false);
    equal(await ProofRepository.receiveObject(db, storage, 'not-a-proof-key'), 'ignored');
    equal(await ProofRepository.receiveObject(db, storage, `proofs/${crypto.randomUUID()}/${crypto.randomUUID()}`), 'ignored');

    // A key the charge stopped waiting for is stale even though it once was its slot.
    const old = await reserve(id);
    const live = await reserve(id);

    await bucket.write(old.key, PDF);

    equal(await ProofRepository.receiveObject(db, storage, old.key), 'ignored');
    equal(await bucket.exists(old.key), false);
    equal((await row(id)).proof_file?.key, live.key);

    // Storage hiccups retry through the bucket event: the slot stays reserved.
    const unavailable: ProofStorage = {
      ...storage,
      read: async () => {
        throw new Error('temporary storage outage');
      }
    };

    await bucket.write(live.key, PDF);
    await rejects(() => ProofRepository.receiveObject(db, unavailable, live.key), /temporary storage outage/);
    equal((await row(id)).proof_state, 'uploading');
    equal(await ProofRepository.receiveObject(db, storage, live.key), 'accepted');
  });

  it('expires only a live slot and never the file that already landed', async () => {
    const id = await charge();
    const { key } = await reserve(id);

    await bucket.write(key, Buffer.from('half'));

    equal(await ProofRepository.expireUpload(db, storage, id, `proofs/${id}/${crypto.randomUUID()}`), false);
    equal((await row(id)).proof_state, 'uploading');
    equal(await ProofRepository.expireUpload(db, storage, id, key), true);
    equal((await row(id)).proof_state ?? null, null);
    equal(await bucket.exists(key), false);
    equal(await ProofRepository.expireUpload(db, storage, id, key), false, 'a retry finds nothing to do');

    // The schedule fires after the bytes were accepted: the pending proof and its object stay.
    const attached = await upload(id);

    equal(await ProofRepository.expireUpload(db, storage, id, attached), false);
    equal((await row(id)).proof_state, 'pending');
    equal(await bucket.exists(attached), true);
  });

  it('lets only the sender withdraw a file under review', async () => {
    const id = await charge();
    const key = await upload(id);

    // A stranger never reaches the charge; the creditor reaches it but did not send the file.
    await rejects(() => ProofRepository.withdraw(db, storage, id, { userId: OTHER }), HttpForbiddenError);
    await rejects(() => ProofRepository.withdraw(db, storage, id, { userId: OWNER }), HttpNotFoundError);
    await ProofRepository.withdraw(db, storage, id, actor);

    equal((await row(id)).proof_state ?? null, null);
    equal(await bucket.exists(key), false);
    equal((await EventRepository.list(db, id, 'proof.withdrawn'))[0]?.actor_user_id, DEBTOR);
    await rejects(() => ProofRepository.withdraw(db, storage, id, actor), HttpNotFoundError, 'nothing left to take back');

    // A reserved slot can be given up too; a reviewed file cannot.
    const reserved = await reserve(id);

    await ProofRepository.withdraw(db, storage, id, actor);
    equal(await bucket.exists(reserved.key), false);
    await upload(id);
    await ProofRepository.review(db, id, OWNER, { decision: ProofState.Accepted });
    await rejects(() => ProofRepository.withdraw(db, storage, id, actor), ApiError);
  });

  it('lets the public sender withdraw their own upload, and nobody else', async () => {
    const id = await charge();
    const token = await publicActor(id);

    await upload(id, token);

    // The signed-in debtor did not send this file, so it is not theirs to take back.
    await rejects(() => ProofRepository.withdraw(db, storage, id, actor), HttpNotFoundError);
    await rejects(() => ProofRepository.withdraw(db, storage, id, { token: 'forged.token', secret: SECRET }), HttpNotFoundError);

    await ProofRepository.withdraw(db, storage, id, token);

    deepEqual(await ProofRepository.publicState(db, token.token, SECRET), { state: null, kind: null, reason: null, file: null });
    equal((await row(id)).proof_state ?? null, null);
    equal((await EventRepository.list(db, id, 'proof.withdrawn'))[0]?.actor_user_id ?? null, null);
    ok(await ProofRepository.startUpload(db, storage, expiry, id, token, input));
  });

  it('settles the charge when the creditor accepts and explains when they reject', async () => {
    const id = await charge();

    await rejects(() => ProofRepository.review(db, id, OWNER, { decision: ProofState.Accepted }), ApiError, 'nothing under review yet');
    await upload(id);
    await rejects(() => ProofRepository.review(db, id, DEBTOR, { decision: ProofState.Accepted }), HttpForbiddenError);
    await rejects(() => ProofRepository.review(db, id, OTHER, { decision: ProofState.Accepted }), HttpForbiddenError);
    await rejects(() => ProofRepository.review(db, id, OWNER, { decision: 'maybe' as never }), ApiError);

    const results = await Promise.allSettled([
      ProofRepository.review(db, id, OWNER, { decision: ProofState.Accepted }),
      ProofRepository.review(db, id, OWNER, { decision: ProofState.Accepted })
    ]);

    equal(results.filter((result) => result.status === 'fulfilled').length, 1);

    const settled = await row(id);

    equal(settled.state, 'paid');
    ok(settled.paid_at);
    equal(settled.proof_state, 'accepted');
    ok(settled.proof_reviewed_at);

    const types = await eventTypes(id);

    ok(types.includes('proof.accepted'));
    equal(types.filter((type) => type === 'charge.paid').length, 1);
    deepEqual((await EventRepository.list(db, id, 'charge.paid'))[0]?.payload, { via: 'proof' });
    equal((await ChargeRepository.get(db, OWNER, id)).proof?.state, 'accepted');

    // Rejecting keeps the charge open and leaves a reason the sender can read; the file may then be replaced.
    const rejectedId = await charge();
    const first = await upload(rejectedId);

    await ProofRepository.review(db, rejectedId, OWNER, { decision: ProofState.Rejected, reason: '  Confira o valor  ' });

    const rejected = await row(rejectedId);

    equal(rejected.state, 'pending');
    equal(rejected.proof_state, 'rejected');
    equal(rejected.proof_reason, 'Confira o valor');
    equal((await ChargeRepository.get(db, DEBTOR, rejectedId)).proof?.reason, 'Confira o valor');
    deepEqual((await EventRepository.list(db, rejectedId, 'proof.rejected'))[0]?.payload, { name: 'proof.pdf', reason: 'Confira o valor' });
    await rejects(() => ProofRepository.review(db, rejectedId, OWNER, { decision: ProofState.Accepted }), ApiError);

    const replacement = await reserve(rejectedId);

    equal(await bucket.exists(first), false, 'the rejected file goes when its replacement is reserved');
    equal((await row(rejectedId)).proof_reason ?? null, null);
    await bucket.write(replacement.key, PDF);
    equal(await ProofRepository.receiveObject(db, storage, replacement.key), 'accepted');
    equal((await ProofRepository.review(db, rejectedId, OWNER, { decision: ProofState.Accepted })).state, 'paid');
  });

  it('lets the paying side declare a payment without a file and the creditor answer it', async () => {
    const id = await charge();

    await rejects(() => ProofRepository.declare(db, storage, id, { userId: OWNER }), ProofDeclarationForbiddenError);
    await rejects(() => ProofRepository.declare(db, storage, id, { userId: OTHER }), HttpForbiddenError);

    const declared = await ProofRepository.declare(db, storage, id, actor);

    equal(declared.proof_state, 'pending');
    equal(declared.proof_kind, 'declaration');
    equal(declared.proof_file ?? null, null);
    equal(declared.proof_sender_user_id, DEBTOR);
    ok((await eventTypes(id)).includes('proof.declared'));
    await rejects(() => ProofRepository.declare(db, storage, id, actor), ChargeInReviewError);

    const seen = await ChargeRepository.get(db, OWNER, id);

    equal(seen.proofState, 'pending');
    equal(seen.proofKind, 'declaration');
    equal(seen.proof?.file, null);
    equal(seen.confirmationRequired, true);
    await rejects(() => ProofRepository.downloadUrl(db, storage, id, OWNER), HttpNotFoundError);

    equal((await ProofRepository.review(db, id, OWNER, { decision: ProofState.Accepted })).state, 'paid');
    deepEqual((await EventRepository.list(db, id, 'charge.paid'))[0]?.payload, { via: 'declaration' });

    const refusedId = await charge();

    await ProofRepository.declare(db, storage, refusedId, actor);
    await ProofRepository.review(db, refusedId, OWNER, { decision: ProofState.Rejected, reason: 'Não caiu' });

    const refused = await ChargeRepository.get(db, DEBTOR, refusedId);

    equal(refused.state, 'pending');
    equal(refused.proof?.kind, 'declaration');
    equal(refused.proof?.reason, 'Não caiu');
    ok(await ProofRepository.declare(db, storage, refusedId, actor), 'a refused declaration may be sent again');
  });

  it('lets the sender take back or attach a file over their own declaration, and nobody else', async () => {
    const id = await charge();
    const token = await publicActor(id);

    await ProofRepository.declare(db, storage, id, token);
    await rejects(() => ProofRepository.startUpload(db, storage, expiry, id, actor, input), ApiError);
    await rejects(() => ProofRepository.withdraw(db, storage, id, actor), HttpNotFoundError);
    deepEqual(await ProofRepository.publicState(db, token.token, SECRET), {
      state: 'pending',
      kind: 'declaration',
      reason: null,
      file: null
    });

    await upload(id, token);

    equal((await row(id)).proof_kind, 'file');
    equal((await ChargeRepository.get(db, OWNER, id)).proofKind, 'file');

    const withdrawnId = await charge();

    await ProofRepository.declare(db, storage, withdrawnId, actor);
    await ProofRepository.withdraw(db, storage, withdrawnId, actor);
    equal((await row(withdrawnId)).proof_state ?? null, null);
  });

  it("drops the sender's own live upload when they declare and refuses over someone else's", async () => {
    const id = await charge();
    const { key } = await reserve(id);

    await ProofRepository.declare(db, storage, id, actor);
    equal(await bucket.exists(key), false);

    const busyId = await charge();

    await reserve(busyId, await publicActor(busyId));
    await rejects(() => ProofRepository.declare(db, storage, busyId, actor), ApiError);
  });

  it('keeps a declaration under review while its file is on the way and restores it when the upload fails', async () => {
    const id = await charge();
    const declared = await ProofRepository.declare(db, storage, id, actor);
    const { context } = fakeNotice();

    // The slot rides on the declaration: it stays pending, with its sent time, for both sides.
    const expired = await reserve(id);
    const during = await row(id);

    equal(during.proof_state, 'pending');
    equal(during.proof_kind, 'declaration');
    equal(during.proof_sent_at, declared.proof_sent_at);
    equal(during.proof_file?.key, expired.key);

    const seen = await ChargeRepository.get(db, OWNER, id);

    equal(seen.proofState, 'pending');
    equal(seen.proofKind, 'declaration');
    equal(seen.proof?.file, null, 'the file on its way is nobody’s business yet');
    await rejects(() => ProofRepository.downloadUrl(db, storage, id, OWNER), HttpNotFoundError);
    await rejects(() => NotificationRepository.manualReminder(db, OWNER, id, context), ChargeInReviewError);

    // The slot expires: the declaration is back as it was, still in review.
    await bucket.write(expired.key, Buffer.from('half'));

    equal(await ProofRepository.expireUpload(db, storage, id, expired.key), true);
    equal(await bucket.exists(expired.key), false);

    const restored = await row(id);

    equal(restored.proof_state, 'pending');
    equal(restored.proof_kind, 'declaration');
    equal(restored.proof_sent_at, declared.proof_sent_at);
    equal(restored.proof_sender_user_id, DEBTOR);
    equal(restored.proof_file ?? null, null);
    equal(restored.proof_expires_at ?? null, null);
    await rejects(() => NotificationRepository.manualReminder(db, OWNER, id, context), ChargeInReviewError);

    // Bytes that fail validation leave the declaration standing too.
    const invalid = await reserve(id);

    await bucket.write(invalid.key, Buffer.from('not a proof file'));
    await rejects(() => ProofRepository.completeUpload(db, storage, id, actor), ProofInvalidFileError);

    const kept = await row(id);

    equal(kept.proof_state, 'pending');
    equal(kept.proof_kind, 'declaration');
    equal(kept.proof_sent_at, declared.proof_sent_at);
    equal(kept.proof_file ?? null, null);
    ok((await eventTypes(id)).includes('proof.invalid'));

    // Once the file lands it replaces the declaration.
    const landed = await reserve(id);

    await bucket.write(landed.key, PDF);

    const attached = await ProofRepository.completeUpload(db, storage, id, actor);

    equal(attached.proof_state, 'pending');
    equal(attached.proof_kind, 'file');
    equal(attached.proof_file?.sha256, createHash('sha256').update(PDF).digest('hex'));
    equal(attached.proof_expires_at ?? null, null);
    notEqual(attached.proof_sent_at, declared.proof_sent_at);
    deepEqual((await ChargeRepository.get(db, OWNER, id)).proof?.file, { name: 'proof.pdf', mime: 'application/pdf', size: 14 });
  });

  it('lets the creditor answer a declaration while its file is on the way and drops the late file', async () => {
    const id = await charge();

    await ProofRepository.declare(db, storage, id, actor);

    const { key } = await reserve(id);

    equal((await ProofRepository.review(db, id, OWNER, { decision: ProofState.Accepted })).state, 'paid');
    deepEqual((await EventRepository.list(db, id, 'charge.paid'))[0]?.payload, { via: 'declaration' });

    // The bytes land after the answer: there is nothing left to attach them to, so they go and the answer stands.
    await bucket.write(key, PDF);
    await rejects(() => ProofRepository.completeUpload(db, storage, id, actor), UploadMissingError);
    equal(await ProofRepository.receiveObject(db, storage, key), 'ignored');
    equal(await bucket.exists(key), false);
    equal(await ProofRepository.expireUpload(db, storage, id, key), false);

    const settled = await row(id);

    equal(settled.state, 'paid');
    equal(settled.proof_state, 'accepted');
    equal(settled.proof_kind, 'declaration');
    equal(settled.proof_file ?? null, null);

    // "Não recebi" while the file is on the way answers the declaration the same way.
    const refusedId = await charge();

    await ProofRepository.declare(db, storage, refusedId, actor);

    const refusedSlot = await reserve(refusedId);

    await ProofRepository.review(db, refusedId, OWNER, { decision: ProofState.Rejected, reason: 'Não caiu' });
    await bucket.write(refusedSlot.key, PDF);
    equal(await ProofRepository.receiveObject(db, storage, refusedSlot.key), 'ignored');

    const refused = await row(refusedId);

    equal(refused.proof_state, 'rejected');
    equal(refused.proof_kind, 'declaration');
    equal(refused.proof_file ?? null, null);

    // Settling by hand answers it too.
    const paidId = await charge();

    await ProofRepository.declare(db, storage, paidId, actor);

    const paidSlot = await reserve(paidId);

    await ChargeRepository.pay(db, OWNER, paidId);
    deepEqual((await EventRepository.list(db, paidId, 'charge.paid'))[0]?.payload, { via: 'declaration' });
    equal((await row(paidId)).proof_file ?? null, null);
    equal(await ProofRepository.expireUpload(db, storage, paidId, paidSlot.key), false);
  });

  it('hands a download URL to the creditor for any file and to the debtor only for their own', async () => {
    const id = await charge();

    await reserve(id);
    await rejects(() => ProofRepository.downloadUrl(db, storage, id, OWNER), HttpNotFoundError, 'a reserved slot has no file yet');

    await upload(id);

    const link = await ProofRepository.downloadUrl(db, storage, id, OWNER);

    ok(link.url);
    equal(link.expiresIn, 60);
    ok(await ProofRepository.downloadUrl(db, storage, id, DEBTOR));
    await rejects(() => ProofRepository.downloadUrl(db, storage, id, OTHER), HttpForbiddenError);

    const anonymousId = await charge();

    await upload(anonymousId, await publicActor(anonymousId));

    ok(await ProofRepository.downloadUrl(db, storage, anonymousId, OWNER));
    await rejects(() => ProofRepository.downloadUrl(db, storage, anonymousId, DEBTOR), HttpNotFoundError);
  });

  it('keeps the public state private to the token that uploaded', async () => {
    const id = await charge();
    const token = await publicActor(id);

    await upload(id);

    deepEqual(await ProofRepository.publicState(db, token.token, SECRET), { state: null, kind: null, reason: null, file: null });
    equal((await PublicLinkRepository.getCharge(db, token.token, SECRET)).uploadsEnabled, false);

    const ownId = await charge();
    const own = await publicActor(ownId);

    await reserve(ownId, own);
    equal((await ProofRepository.publicState(db, own.token, SECRET)).state, 'uploading');

    await upload(ownId, own);

    deepEqual(await ProofRepository.publicState(db, own.token, SECRET), {
      state: 'pending',
      kind: 'file',
      reason: null,
      file: { name: 'proof.pdf', mime: 'application/pdf', size: 14 }
    });
    await ProofRepository.review(db, ownId, OWNER, { decision: ProofState.Rejected, reason: 'Confira a data' });
    equal((await ProofRepository.publicState(db, own.token, SECRET)).reason, 'Confira a data');
    await rejects(() => ProofRepository.publicState(db, 'forged.token', SECRET), HttpNotFoundError);
  });

  it('answers what waits in review on manual settlement, leaves it alone on cancellation and reopens an accepted one', async () => {
    const id = await charge();

    await upload(id);
    await ChargeRepository.pay(db, OWNER, id);

    equal((await row(id)).proof_state, 'accepted', 'settling by hand accepts the file under review');
    ok((await eventTypes(id)).includes('proof.accepted'));
    deepEqual((await EventRepository.list(db, id, 'charge.paid'))[0]?.payload, { via: 'proof' });
    await rejects(() => ProofRepository.review(db, id, OWNER, { decision: ProofState.Accepted }), ApiError);
    await rejects(() => ProofRepository.startUpload(db, storage, expiry, id, actor, input), ApiError);
    ok(await ProofRepository.downloadUrl(db, storage, id, OWNER));

    const reopened = await ChargeRepository.reopen(db, OWNER, id);

    equal(reopened.state, 'pending');
    equal(reopened.paidAt, null);
    equal(reopened.proof?.state, 'pending', 'an accepted file goes back under review');
    equal((await row(id)).proof_reviewed_at ?? null, null);
    ok((await eventTypes(id)).includes('charge.reopened'));
    await rejects(() => ChargeRepository.reopen(db, OWNER, id), ApiError);
    equal((await ProofRepository.review(db, id, OWNER, { decision: ProofState.Accepted })).state, 'paid');

    const declaredId = await charge();

    await ProofRepository.declare(db, storage, declaredId, actor);
    await ChargeRepository.pay(db, OWNER, declaredId);
    deepEqual((await EventRepository.list(db, declaredId, 'charge.paid'))[0]?.payload, { via: 'declaration' });

    const cancelledId = await charge();

    await upload(cancelledId);
    await ChargeRepository.cancel(db, OWNER, cancelledId);

    equal((await row(cancelledId)).proof_state, 'pending');
    await rejects(() => ProofRepository.startUpload(db, storage, expiry, cancelledId, actor, input), ApiError);
    await rejects(() => ProofRepository.withdraw(db, storage, cancelledId, actor), ApiError);
    ok(await ProofRepository.downloadUrl(db, storage, cancelledId, OWNER));
  });

  it('persists the capability quota across invocations and windows', async () => {
    const now = Date.now() + 600_000;

    for (let attempt = 0; attempt < 12; attempt++) await throttleProof(db, 'quota-native-proof', now);
    await rejects(() => throttleProof(db, 'quota-native-proof', now), TooManyRequestsError);
    // Other capabilities keep their own budget; a new window resets the exhausted one.
    await throttleProof(db, 'quota-another', now);
    await throttleProof(db, 'quota-native-proof', now + 600_001);
    await db.proof_throttles.deleteMany({});
  });

  it('resolves the capability before charging its quota, so guesses never consume anything', async () => {
    const context = { db, variables: { PUBLIC_LINK_HMAC_SECRET: SECRET } } as Parameters<typeof publicStartProofUploadHandler>[1];
    const before = await db.proof_throttles.count({});

    for (let attempt = 0; attempt < 30; attempt++) {
      const start = { parameters: { token: `invalid-${attempt}` }, body: input };
      const withdraw = { parameters: { token: `invalid-${attempt}` } };

      await rejects(() => publicStartProofUploadHandler(start, context), HttpNotFoundError);
      await rejects(() => publicWithdrawProofHandler(withdraw, context), HttpNotFoundError);
    }

    equal(await db.proof_throttles.count({}), before);

    // A real link is charged twelve actions per window, whatever the outcome of each action.
    const id = await charge();
    const { token } = await PublicLinkRepository.createOrRotate(db, OWNER, id, SECRET);

    for (let attempt = 0; attempt < 12; attempt++) {
      await rejects(
        () => publicWithdrawProofHandler({ parameters: { token } }, context),
        (error) => !(error instanceof TooManyRequestsError)
      );
    }

    await rejects(() => publicWithdrawProofHandler({ parameters: { token } }, context), TooManyRequestsError);
    await db.proof_throttles.deleteMany({});
  });
});
