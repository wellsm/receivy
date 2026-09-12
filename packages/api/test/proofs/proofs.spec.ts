import { deepEqual, equal, notEqual, ok, rejects } from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { HttpForbiddenError, HttpNotFoundError } from '@ez4/gateway';
import { BucketTester } from '@ez4/local-storage/test';
import { cancelCharge, getCharge, payCharge, reopenCharge } from '../../src/charges/repositories/charge';
import { ApiError, TooManyRequestsError } from '../../src/common/errors';
import { listEvents } from '../../src/common/repositories/events';
import { saveContact } from '../../src/contacts/repositories/contact';
import { savePaymentMethod } from '../../src/payment-methods/repositories/payment-method';
import { publicStartProofUploadHandler } from '../../src/proofs/endpoints/public-start-upload';
import { publicWithdrawProofHandler } from '../../src/proofs/endpoints/public-withdraw';
import {
  actorHash,
  expireProofUpload,
  proofDownloadUrl,
  publicProofState,
  receiveProofObject,
  reviewProof,
  startProofUpload,
  UPLOAD_TTL_MS,
  withdrawProof
} from '../../src/proofs/repositories/proof';

import type { UploadExpirySchedule } from '../../src/proofs/schedulers/upload-expiry';
import { uploadExpiryIdentifier } from '../../src/proofs/schedulers/upload-expiry';
import { bucketProofStorage } from '../../src/proofs/services/bucket-storage';
import type { ProofStorage } from '../../src/proofs/services/storage';
import { throttleProof } from '../../src/proofs/services/throttle';
import { createOrRotatePublicLink, getPublicCharge } from '../../src/public/repositories/public-link';
import { getTimeline } from '../../src/timeline/repositories/timeline';
import { cleanupUsers, createOnceCharge, createUser, db } from '../fixtures/financial';
import { fakeScheduler } from '../fixtures/scheduling';

const OWNER = 'a1111111-1111-4111-8111-111111111111';
const DEBTOR = 'a2222222-2222-4222-8222-222222222222';
const OTHER = 'a3333333-3333-4333-8333-333333333333';
const SECRET = 'proof-native-test-secret-with-enough-entropy';

// Native service-test boundary: EZ4's typed bucket tester holds the bytes, the API only signs and reads.
const bucket = BucketTester.getClientMock('ProofFiles', { keys: {} });
const storage = bucketProofStorage(bucket);
const expiry = fakeScheduler<UploadExpirySchedule>();

const actor = { userId: DEBTOR };
const input = { filename: 'proof.pdf', mime: 'application/pdf' as const, size: 14 };
const PDF = Buffer.from('%PDF-1.7\nproof');

let counter = 0;
let debtorId: string;

async function charge() {
  if (!debtorId) {
    debtorId = (await saveContact(db, OWNER, { name: 'Proof Debtor', email: 'proof-debtor@example.com' })).userId;
  }

  return (await createOnceCharge(db, OWNER, `proof-${++counter}`, { userId: debtorId, amountCents: 1234, dueDate: '2027-01-01' })).chargeId;
}

async function row(id: string) {
  const found = await db.charges.findOne({
    select: {
      state: true,
      paid_at: true,
      proof_state: true,
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
async function reserve(id: string, who: Parameters<typeof startProofUpload>[4] = actor, now?: number) {
  const ticket = await startProofUpload(db, storage, expiry, id, who, input, now);
  const key = (await row(id)).proof_file!.key;

  return { ticket, key };
}

/** The whole happy path: a reserved slot, the bytes landing, the bucket event turning them into a pending proof. */
async function upload(id: string, who: Parameters<typeof startProofUpload>[4] = actor) {
  const { key } = await reserve(id, who);

  await bucket.write(key, PDF);

  equal(await receiveProofObject(db, storage, key), 'accepted');

  return key;
}

async function publicActor(id: string) {
  const link = await createOrRotatePublicLink(db, OWNER, id, SECRET);

  return { token: link.token, secret: SECRET };
}

async function eventTypes(id: string) {
  return (await listEvents(db, id)).map((event) => event.type);
}

describe('proof slot, bucket event and review on PostgreSQL', () => {
  before(async () => {
    const [database] = await db.rawQuery('SELECT current_database() AS name');

    equal(database?.['name'], 'receivy_tests');

    await createUser(db, { id: OWNER, email: 'proof-owner@example.com', name: 'Proof Owner' });
    await savePaymentMethod(db, OWNER, { pixKeyType: 'email', pixKey: 'proof-owner@example.com' });
    await createUser(db, { id: DEBTOR, email: 'proof-debtor@example.com', name: 'Proof Debtor' });
    await createUser(db, { id: OTHER, email: 'proof-other@example.com', name: 'Other' });
  });

  after(async () => cleanupUsers(db, [OWNER, DEBTOR, OTHER]));

  it('reserves the slot only for the side that pays and arms its expiry', async () => {
    const id = await charge();
    const now = Date.now();

    await rejects(() => startProofUpload(db, storage, expiry, id, { userId: OWNER }, input), HttpForbiddenError);
    await rejects(() => startProofUpload(db, storage, expiry, id, { userId: OTHER }, input), HttpForbiddenError);
    await rejects(() => startProofUpload(db, storage, expiry, id, actor, { ...input, mime: 'text/html' as never }), ApiError);
    await rejects(() => startProofUpload(db, storage, expiry, id, actor, { ...input, size: 0 }), ApiError);

    const { ticket, key } = await reserve(id, actor, now);

    ok(ticket.uploadUrl.includes(key), 'the signed PUT targets the reserved key');
    equal(ticket.expiresAt, new Date(now + UPLOAD_TTL_MS).toISOString());
    deepEqual(expiry.events.get(uploadExpiryIdentifier(id)), { date: new Date(ticket.expiresAt), event: { chargeId: id, key } });

    const reserved = await row(id);

    equal(reserved.proof_state, 'uploading');
    equal(reserved.proof_sender_user_id, DEBTOR);
    equal(reserved.proof_actor_hash, actorHash(actor));
    equal(reserved.proof_expires_at, ticket.expiresAt);
    ok(key.startsWith(`proofs/${id}/`));

    // A reserved slot is nobody's business yet: neither side sees a proof.
    equal((await getCharge(db, OWNER, id)).proof, null);
    equal((await getCharge(db, OWNER, id)).proofState, null);

    // The public link reserves its own slot on a fresh charge, with no sender account behind it.
    const publicId = await charge();
    const token = await publicActor(publicId);

    await reserve(publicId, token);

    const anonymous = await row(publicId);

    equal(anonymous.proof_state, 'uploading');
    equal(anonymous.proof_sender_user_id ?? null, null);
    equal(anonymous.proof_actor_hash, actorHash(token));
  });

  it('lets the same actor re-reserve, refuses another actor while the slot is live and drops the abandoned key', async () => {
    const id = await charge();
    const token = await publicActor(id);
    const first = await reserve(id);

    await bucket.write(first.key, Buffer.from('half-uploaded'));
    await rejects(() => startProofUpload(db, storage, expiry, id, token, input), ApiError);

    const second = await reserve(id);

    notEqual(second.key, first.key);
    equal(await bucket.exists(first.key), false, 'the abandoned object has no row pointing at it any more');
    equal(expiry.events.get(uploadExpiryIdentifier(id))?.event.key, second.key);

    // Once the slot has expired it is up for grabs again, whoever held it.
    const later = Date.now() + UPLOAD_TTL_MS + 1;
    const taken = await reserve(id, token, later);

    notEqual(taken.key, second.key);
    equal((await row(id)).proof_actor_hash, actorHash(token));
  });

  it('turns the landed bytes into a pending proof with its hash and history', async () => {
    const id = await charge();
    const key = await upload(id);
    const stored = await row(id);

    equal(stored.proof_state, 'pending');
    equal(stored.proof_file?.sha256, createHash('sha256').update(PDF).digest('hex'));
    equal(stored.proof_file?.size, PDF.length);
    equal(stored.proof_expires_at ?? null, null);
    ok(stored.proof_sent_at);

    const uploaded = (await listEvents(db, id, 'proof.uploaded'))[0];

    equal(uploaded?.actor_user_id, DEBTOR);
    deepEqual(uploaded?.payload, { name: 'proof.pdf', mime: 'application/pdf', size: 14 });

    // One proof at a time: the slot stays taken while the file is under review.
    const token = await publicActor(id);

    await rejects(() => startProofUpload(db, storage, expiry, id, actor, input), ApiError);
    await rejects(() => startProofUpload(db, storage, expiry, id, token, input), ApiError);

    const mine = (await getCharge(db, DEBTOR, id)).proof;
    const theirs = (await getCharge(db, OWNER, id)).proof;

    equal(mine?.state, 'pending');
    equal(mine?.sentByViewer, true);
    equal(theirs?.sentByViewer, false);
    deepEqual(theirs?.file, { name: 'proof.pdf', mime: 'application/pdf', size: 14 });
    equal((await getCharge(db, OWNER, id)).proofState, 'pending');

    // The bucket may deliver the same event twice: the attached file must survive the replay.
    equal(await receiveProofObject(db, storage, key), 'ignored');
    equal(await bucket.exists(key), true);
    equal((await row(id)).proof_state, 'pending');
    ok((await getTimeline(db, OWNER, {})).items.some((item) => item.kind === 'proof' && item.proof.chargeId === id));
  });

  it('releases the slot and drops the bytes when the file is invalid or lies about its size', async () => {
    const id = await charge();
    const { key } = await reserve(id);

    await bucket.write(key, Buffer.from('<html>bad</html>'));

    equal(await receiveProofObject(db, storage, key), 'invalid');

    const cleared = await row(id);

    equal(cleared.proof_state ?? null, null);
    equal(cleared.proof_file ?? null, null);
    equal(cleared.proof_actor_hash ?? null, null);
    equal(await bucket.exists(key), false);

    const invalid = (await listEvents(db, id, 'proof.invalid'))[0];

    equal(invalid?.actor_user_id, DEBTOR);
    equal(invalid?.payload['name'], 'proof.pdf');
    ok(invalid?.payload['reason']);

    // A valid PDF that is not the size the client declared is refused the same way.
    const oversized = await reserve(id);

    await bucket.write(oversized.key, Buffer.concat([PDF, Buffer.from(' and then some')]));

    equal(await receiveProofObject(db, storage, oversized.key), 'invalid');
    equal((await row(id)).proof_state ?? null, null);
    equal(await bucket.exists(oversized.key), false);
    equal((await listEvents(db, id, 'proof.invalid')).length, 2);

    // The slot is free again, so the same person may try once more.
    await upload(id);
  });

  it('ignores an unknown or stale key, drops its object, and keeps the slot on a storage outage', async () => {
    const id = await charge();
    const stray = `proofs/${id}/${crypto.randomUUID()}`;

    await bucket.write(stray, PDF);

    equal(await receiveProofObject(db, storage, stray), 'ignored');
    equal(await bucket.exists(stray), false);
    equal(await receiveProofObject(db, storage, 'not-a-proof-key'), 'ignored');
    equal(await receiveProofObject(db, storage, `proofs/${crypto.randomUUID()}/${crypto.randomUUID()}`), 'ignored');

    // A key the charge stopped waiting for is stale even though it once was its slot.
    const old = await reserve(id);
    const live = await reserve(id);

    await bucket.write(old.key, PDF);

    equal(await receiveProofObject(db, storage, old.key), 'ignored');
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
    await rejects(() => receiveProofObject(db, unavailable, live.key), /temporary storage outage/);
    equal((await row(id)).proof_state, 'uploading');
    equal(await receiveProofObject(db, storage, live.key), 'accepted');
  });

  it('expires only a live slot and never the file that already landed', async () => {
    const id = await charge();
    const { key } = await reserve(id);

    await bucket.write(key, Buffer.from('half'));

    equal(await expireProofUpload(db, storage, id, `proofs/${id}/${crypto.randomUUID()}`), false);
    equal((await row(id)).proof_state, 'uploading');
    equal(await expireProofUpload(db, storage, id, key), true);
    equal((await row(id)).proof_state ?? null, null);
    equal(await bucket.exists(key), false);
    equal(await expireProofUpload(db, storage, id, key), false, 'a retry finds nothing to do');

    // The schedule fires after the bytes were accepted: the pending proof and its object stay.
    const attached = await upload(id);

    equal(await expireProofUpload(db, storage, id, attached), false);
    equal((await row(id)).proof_state, 'pending');
    equal(await bucket.exists(attached), true);
  });

  it('lets only the sender withdraw a file under review', async () => {
    const id = await charge();
    const key = await upload(id);

    // A stranger never reaches the charge; the creditor reaches it but did not send the file.
    await rejects(() => withdrawProof(db, storage, id, { userId: OTHER }), HttpForbiddenError);
    await rejects(() => withdrawProof(db, storage, id, { userId: OWNER }), HttpNotFoundError);
    await withdrawProof(db, storage, id, actor);

    equal((await row(id)).proof_state ?? null, null);
    equal(await bucket.exists(key), false);
    equal((await listEvents(db, id, 'proof.withdrawn'))[0]?.actor_user_id, DEBTOR);
    await rejects(() => withdrawProof(db, storage, id, actor), HttpNotFoundError, 'nothing left to take back');

    // A reserved slot can be given up too; a reviewed file cannot.
    const reserved = await reserve(id);

    await withdrawProof(db, storage, id, actor);
    equal(await bucket.exists(reserved.key), false);
    await upload(id);
    await reviewProof(db, id, OWNER, { decision: 'accepted' });
    await rejects(() => withdrawProof(db, storage, id, actor), ApiError);
  });

  it('lets the public sender withdraw their own upload, and nobody else', async () => {
    const id = await charge();
    const token = await publicActor(id);

    await upload(id, token);

    // The signed-in debtor did not send this file, so it is not theirs to take back.
    await rejects(() => withdrawProof(db, storage, id, actor), HttpNotFoundError);
    await rejects(() => withdrawProof(db, storage, id, { token: 'forged.token', secret: SECRET }), HttpNotFoundError);

    await withdrawProof(db, storage, id, token);

    deepEqual(await publicProofState(db, token.token, SECRET), { state: null, reason: null, file: null });
    equal((await row(id)).proof_state ?? null, null);
    equal((await listEvents(db, id, 'proof.withdrawn'))[0]?.actor_user_id ?? null, null);
    ok(await startProofUpload(db, storage, expiry, id, token, input));
  });

  it('settles the charge when the creditor accepts and explains when they reject', async () => {
    const id = await charge();

    await rejects(() => reviewProof(db, id, OWNER, { decision: 'accepted' }), ApiError, 'nothing under review yet');
    await upload(id);
    await rejects(() => reviewProof(db, id, DEBTOR, { decision: 'accepted' }), HttpForbiddenError);
    await rejects(() => reviewProof(db, id, OTHER, { decision: 'accepted' }), HttpForbiddenError);
    await rejects(() => reviewProof(db, id, OWNER, { decision: 'maybe' as never }), ApiError);

    const results = await Promise.allSettled([
      reviewProof(db, id, OWNER, { decision: 'accepted' }),
      reviewProof(db, id, OWNER, { decision: 'accepted' })
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
    deepEqual((await listEvents(db, id, 'charge.paid'))[0]?.payload, { via: 'proof' });
    equal((await getCharge(db, OWNER, id)).proof?.state, 'accepted');

    // Rejecting keeps the charge open and leaves a reason the sender can read; the file may then be replaced.
    const rejectedId = await charge();
    const first = await upload(rejectedId);

    await reviewProof(db, rejectedId, OWNER, { decision: 'rejected', reason: '  Confira o valor  ' });

    const rejected = await row(rejectedId);

    equal(rejected.state, 'pending');
    equal(rejected.proof_state, 'rejected');
    equal(rejected.proof_reason, 'Confira o valor');
    equal((await getCharge(db, DEBTOR, rejectedId)).proof?.reason, 'Confira o valor');
    deepEqual((await listEvents(db, rejectedId, 'proof.rejected'))[0]?.payload, { name: 'proof.pdf', reason: 'Confira o valor' });
    await rejects(() => reviewProof(db, rejectedId, OWNER, { decision: 'accepted' }), ApiError);

    const replacement = await reserve(rejectedId);

    equal(await bucket.exists(first), false, 'the rejected file goes when its replacement is reserved');
    equal((await row(rejectedId)).proof_reason ?? null, null);
    await bucket.write(replacement.key, PDF);
    equal(await receiveProofObject(db, storage, replacement.key), 'accepted');
    equal((await reviewProof(db, rejectedId, OWNER, { decision: 'accepted' })).state, 'paid');
  });

  it('hands a download URL to the creditor for any file and to the debtor only for their own', async () => {
    const id = await charge();

    await reserve(id);
    await rejects(() => proofDownloadUrl(db, storage, id, OWNER), HttpNotFoundError, 'a reserved slot has no file yet');

    await upload(id);

    const link = await proofDownloadUrl(db, storage, id, OWNER);

    ok(link.url);
    equal(link.expiresIn, 60);
    ok(await proofDownloadUrl(db, storage, id, DEBTOR));
    await rejects(() => proofDownloadUrl(db, storage, id, OTHER), HttpForbiddenError);

    const anonymousId = await charge();

    await upload(anonymousId, await publicActor(anonymousId));

    ok(await proofDownloadUrl(db, storage, anonymousId, OWNER));
    await rejects(() => proofDownloadUrl(db, storage, anonymousId, DEBTOR), HttpNotFoundError);
  });

  it('keeps the public state private to the token that uploaded', async () => {
    const id = await charge();
    const token = await publicActor(id);

    await upload(id);

    deepEqual(await publicProofState(db, token.token, SECRET), { state: null, reason: null, file: null });
    equal((await getPublicCharge(db, token.token, SECRET)).uploadsEnabled, false);

    const ownId = await charge();
    const own = await publicActor(ownId);

    await reserve(ownId, own);
    equal((await publicProofState(db, own.token, SECRET)).state, 'uploading');

    await upload(ownId, own);

    deepEqual(await publicProofState(db, own.token, SECRET), {
      state: 'pending',
      reason: null,
      file: { name: 'proof.pdf', mime: 'application/pdf', size: 14 }
    });
    await reviewProof(db, ownId, OWNER, { decision: 'rejected', reason: 'Confira a data' });
    equal((await publicProofState(db, own.token, SECRET)).reason, 'Confira a data');
    await rejects(() => publicProofState(db, 'forged.token', SECRET), HttpNotFoundError);
  });

  it('leaves a pending proof alone on manual settlement or cancellation and reopens an accepted one', async () => {
    const id = await charge();

    await upload(id);
    await payCharge(db, OWNER, id);

    equal((await row(id)).proof_state, 'pending', 'a manual settlement does not answer the file');
    equal((await getCharge(db, OWNER, id)).proof?.state, 'pending');
    await rejects(() => reviewProof(db, id, OWNER, { decision: 'accepted' }), ApiError);
    await rejects(() => startProofUpload(db, storage, expiry, id, actor, input), ApiError);
    ok(await proofDownloadUrl(db, storage, id, OWNER));

    const reopened = await reopenCharge(db, OWNER, id);

    equal(reopened.state, 'pending');
    equal(reopened.paidAt, null);
    equal(reopened.proof?.state, 'pending');
    await reviewProof(db, id, OWNER, { decision: 'accepted' });

    const again = await reopenCharge(db, OWNER, id);

    equal(again.proofState, 'pending', 'an accepted file goes back under review');
    equal((await row(id)).proof_reviewed_at ?? null, null);
    ok((await eventTypes(id)).includes('charge.reopened'));
    await rejects(() => reopenCharge(db, OWNER, id), ApiError);
    equal((await reviewProof(db, id, OWNER, { decision: 'accepted' })).state, 'paid');

    const cancelledId = await charge();

    await upload(cancelledId);
    await cancelCharge(db, OWNER, cancelledId);

    equal((await row(cancelledId)).proof_state, 'pending');
    await rejects(() => startProofUpload(db, storage, expiry, cancelledId, actor, input), ApiError);
    await rejects(() => withdrawProof(db, storage, cancelledId, actor), ApiError);
    ok(await proofDownloadUrl(db, storage, cancelledId, OWNER));
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
    const { token } = await createOrRotatePublicLink(db, OWNER, id, SECRET);

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
