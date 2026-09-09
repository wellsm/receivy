import { deepEqual, equal, ok, rejects } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { BucketTester } from '@ez4/local-storage/test';
import { savePerson } from '../../src/people/repository';
import { reconcileProofStorage } from '../../src/proofs/cleanup';
import { deleteProofObject, type StorageMessage } from '../../src/proofs/queue';
import { createUploadIntent, finalizeProof } from '../../src/proofs/repository';
import type { ReconciliableProofStorage } from '../../src/proofs/storage';
import { cleanupUsers, createOnceCharge, createUser, db } from '../fixtures/financial';

const OWNER = 'd1111111-1111-4111-8111-111111111111';

const HOUR = 3600_000;

const upload = { filename: 'proof.pdf', mime: 'application/pdf' as const, size: 14 };

const bucket = BucketTester.getClientMock('ProofFiles', { keys: {} });

let listing: { key: string; modifiedAt: string }[] = [];
let pageSize = 100;

const storage: ReconciliableProofStorage = {
  uploadUrl: (key, mime) => bucket.getWriteUrl(key, { contentType: mime, expiresIn: 300 }),
  read: (key) => bucket.read(key),
  write: (key, bytes, mime) => bucket.write(key, bytes, { contentType: mime }),
  downloadUrl: (key) => bucket.getReadUrl(key, { expiresIn: 60 }),

  // S3 and the local adapter both report success for an object that is already gone.
  delete: async (key) => {
    if (await bucket.exists(key)) {
      await bucket.delete(key);
    }
  },

  list: async (cursor) => {
    const start = cursor ? Number(cursor) : 0;
    const objects = listing.slice(start, start + pageSize);
    const next = start + objects.length;

    return { objects, cursor: next < listing.length ? String(next) : null };
  }
};

const sent: StorageMessage[] = [];

const send = async (message: StorageMessage) => {
  sent.push(message);
};

const request = (message: StorageMessage, attempt = 1) => ({ message, attempt, maxAttempts: 5 });

function reset() {
  sent.length = 0;
  listing = [];
  pageSize = 100;
}

/** Other suites share the database, so only this charge's messages are asserted. */
function queued(chargeId: string) {
  return sent.filter((message) => message.chargeId === chargeId);
}

let personId: string;
let counter = 0;

async function charge() {
  const created = await createOnceCharge(db, OWNER, `cleanup-${++counter}`, { personId, amountCents: 100, dueDate: '2027-01-01' });

  return created.chargeId;
}

async function storedProof(chargeId: string) {
  const intent = await createUploadIntent(db, storage, chargeId, { userId: OWNER }, upload);

  await bucket.write(new URL(intent.uploadUrl).pathname.slice(1), Buffer.from('%PDF-1.7\nproof'));

  const proof = await finalizeProof(db, storage, chargeId, { userId: OWNER }, intent.id);
  const row = await db.payment_proofs.findOne({ select: { object_key: true }, where: { id: proof.id } });

  ok(row);

  return row.object_key;
}

describe('proof storage cleanup through the queue', () => {
  before(async () => {
    const [row] = await db.rawQuery('SELECT current_database() AS name');

    equal(row?.['name'], 'receivy_tests');

    await createUser(db, { id: OWNER, email: 'cleanup-owner@example.com', name: 'Cleanup' });

    personId = (await savePerson(db, OWNER, { name: 'Cleanup debtor' })).id;
  });

  after(async () => {
    await cleanupUsers(db, [OWNER]);
  });

  it('expires stale intents and queues their temporary object after the transaction commits', async () => {
    reset();

    const chargeId = await charge();
    const intent = await createUploadIntent(db, storage, chargeId, { userId: OWNER }, upload);
    const row = await db.upload_intents.findOne({ select: { object_key: true }, where: { id: intent.id } });

    ok(row);

    await reconcileProofStorage(db, storage, send, () => Date.now() + 25 * HOUR);

    equal((await db.upload_intents.findOne({ select: { state: true }, where: { id: intent.id } }))?.state, 'expired');
    deepEqual(queued(chargeId), [{ objectKey: row.object_key, chargeId, purpose: 'temporary' }]);
  });

  it('queues objects older than the grace period and keeps recent ones', async () => {
    reset();

    const chargeId = await charge();
    const now = Date.now();
    const aged = `proofs/${chargeId}/${crypto.randomUUID()}`;
    const recent = `proofs/${chargeId}/${crypto.randomUUID()}`;

    listing = [
      { key: aged, modifiedAt: new Date(now - 25 * HOUR).toISOString() },
      { key: recent, modifiedAt: new Date(now - HOUR).toISOString() }
    ];

    const result = await reconcileProofStorage(db, storage, send, () => now);

    equal(result.scanned, 2);
    deepEqual(queued(chargeId), [{ objectKey: aged, chargeId, purpose: 'orphan' }]);
  });

  it('never queues an object a stored proof still references', async () => {
    reset();

    const chargeId = await charge();
    const objectKey = await storedProof(chargeId);
    const now = Date.now();

    listing = [{ key: objectKey, modifiedAt: new Date(now - 25 * HOUR).toISOString() }];

    await reconcileProofStorage(db, storage, send, () => now);

    deepEqual(queued(chargeId), []);
  });

  it('scans every listing page within the run budget', async () => {
    reset();

    const chargeId = await charge();
    const now = Date.now();
    const first = `proofs/${chargeId}/${crypto.randomUUID()}`;
    const second = `proofs/${chargeId}/${crypto.randomUUID()}`;

    pageSize = 1;
    listing = [
      { key: first, modifiedAt: new Date(now - 25 * HOUR).toISOString() },
      { key: second, modifiedAt: new Date(now - 25 * HOUR).toISOString() }
    ];

    const result = await reconcileProofStorage(db, storage, send, () => now);

    equal(result.scanned, 2);
    deepEqual(
      queued(chargeId).map((message) => message.objectKey),
      [first, second]
    );
  });

  it('refuses to delete a referenced object and rejects an unroutable key', async () => {
    const chargeId = await charge();
    const objectKey = await storedProof(chargeId);

    equal(await deleteProofObject(db, storage, request({ objectKey, chargeId, purpose: 'account' })), 'skipped');
    equal(await bucket.exists(objectKey), true);
    equal(await deleteProofObject(db, storage, request({ objectKey: 'invalid-legacy-key', chargeId, purpose: 'account' })), 'rejected');
  });

  it('deletes an unreferenced object, tolerates a missing one and survives a removed charge', async () => {
    const chargeId = await charge();
    const present = `proofs/${chargeId}/${crypto.randomUUID()}`;
    const absent = `proofs/${chargeId}/${crypto.randomUUID()}`;
    const orphanCharge = crypto.randomUUID();

    await bucket.write(present, Buffer.from('orphan'));

    equal(await deleteProofObject(db, storage, request({ objectKey: present, chargeId, purpose: 'orphan' })), 'deleted');
    equal(await bucket.exists(present), false);
    equal(await deleteProofObject(db, storage, request({ objectKey: absent, chargeId, purpose: 'account' })), 'deleted');
    equal(
      await deleteProofObject(db, storage, request({ objectKey: `proofs/${orphanCharge}/${crypto.randomUUID()}`, purpose: 'account' })),
      'deleted'
    );
  });

  it('throws when the storage delete fails so the queue can retry it', async () => {
    const chargeId = await charge();
    const objectKey = `proofs/${chargeId}/${crypto.randomUUID()}`;

    const offline = {
      ...storage,
      delete: async () => {
        throw new Error('storage offline');
      }
    };

    await rejects(() => deleteProofObject(db, offline, request({ objectKey, chargeId, purpose: 'orphan' }, 5)), /storage offline/);
  });
});
