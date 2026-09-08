import { equal, ok, rejects } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { BucketTester } from '@ez4/local-storage/test';
import { savePerson } from '../../src/people/repository';
import { drainStorageDeletions, enqueueStorageDeletion, reconcileProofStorage } from '../../src/proofs/cleanup';
import { createUploadIntent, finalizeProof } from '../../src/proofs/repository';
import type { ReconciliableProofStorage } from '../../src/proofs/storage';
import { cleanupUsers, createOnceCharge, createUser, db } from '../fixtures/financial';

const OWNER = 'd1111111-1111-4111-8111-111111111111';
const bucket = BucketTester.getClientMock('ProofFiles', { keys: {} });
const objects: { key: string; modifiedAt: string }[] = [];
let clock = Date.now();
const storage: ReconciliableProofStorage = {
  uploadUrl: (key, mime) => bucket.getWriteUrl(key, { contentType: mime, expiresIn: 300 }),
  read: (key) => bucket.read(key),
  write: (key, bytes, mime) => bucket.write(key, bytes, { contentType: mime }),
  delete: (key) => bucket.delete(key),
  downloadUrl: (key) => bucket.getReadUrl(key, { expiresIn: 60 }),
  list: async () => ({ objects, cursor: null })
};
let id: string;
describe('durable proof storage cleanup', () => {
  before(async () => {
    const [row] = await db.rawQuery('SELECT current_database() AS name');
    equal(row?.['name'], 'receivy_tests');
    await createUser(db, {
      id: OWNER,
      email: 'cleanup-owner@example.com',
      name: 'Cleanup'
    });
    const person = await savePerson(db, OWNER, { name: 'Cleanup debtor' });
    id = (await createOnceCharge(db, OWNER, 'cleanup-expense', { personId: person.id, amountCents: 100, dueDate: '2027-01-01' })).chargeId;
  });
  after(async () => {
    await db.storage_deletions.deleteMany({ where: { charge_id: id } });
    await db.storage_cleanup_cursors.deleteMany({});
    await cleanupUsers(db, [OWNER]);
  });
  it('deletes only old unreferenced objects, retries storage failures, and preserves pending/final proofs', async () => {
    const old = `proofs/${id}/${crypto.randomUUID()}`;
    const fresh = `proofs/${id}/${crypto.randomUUID()}`;
    await bucket.write(old, Buffer.from('orphan'));
    await bucket.write(fresh, Buffer.from('fresh'));
    objects.push(
      { key: old, modifiedAt: new Date(clock - 25 * 3600_000).toISOString() },
      { key: fresh, modifiedAt: new Date(clock).toISOString() }
    );
    const intent = await createUploadIntent(
      db,
      storage,
      id,
      { userId: OWNER },
      { filename: 'proof.pdf', mime: 'application/pdf', size: 14 }
    );
    await reconcileProofStorage(db, storage, () => clock);
    equal(await db.storage_deletions.count({ where: { charge_id: id } }), 0);
    await bucket.write(new URL(intent.uploadUrl).pathname.slice(1), Buffer.from('%PDF-1.7\nproof'));
    const proof = await finalizeProof(db, storage, id, { userId: OWNER }, intent.id);
    const final = await db.payment_proofs.findOne({
      select: { object_key: true },
      where: { id: proof.id }
    });
    ok(final);
    objects.push({
      key: final.object_key,
      modifiedAt: new Date(clock - 25 * 3600_000).toISOString()
    });
    await reconcileProofStorage(db, storage, () => clock);
    await drainStorageDeletions(
      db,
      {
        ...storage,
        delete: async () => {
          throw new Error('storage offline');
        }
      },
      () => clock
    );
    equal(
      (
        await db.storage_deletions.findOne({
          select: { state: true, attempts: true },
          where: { object_key: old }
        })
      )?.attempts,
      1
    );
    clock += 61_000;
    await Promise.all([drainStorageDeletions(db, storage, () => clock), drainStorageDeletions(db, storage, () => clock)]);
    equal(
      (
        await db.storage_deletions.findOne({
          select: { state: true },
          where: { object_key: old }
        })
      )?.state,
      'deleted'
    );
    await rejects(() => bucket.read(old));
    equal((await bucket.read(fresh)).toString(), 'fresh');
    equal((await bucket.read(final.object_key)).length, 14);
  });
  it('refuses account deletion jobs while a proof is referenced and keeps retry journal durable', async () => {
    const proof = (
      await db.payment_proofs.findMany({
        select: { object_key: true },
        where: { charge_id: id }
      })
    ).records[0]!;
    await db.transaction((tx) => enqueueStorageDeletion(tx, { key: proof.object_key, chargeId: id, purpose: 'account' }, clock));
    await drainStorageDeletions(db, storage, () => clock);
    equal(
      (
        await db.storage_deletions.findOne({
          select: { state: true },
          where: { object_key: proof.object_key }
        })
      )?.state,
      'blocked'
    );
    equal((await bucket.read(proof.object_key)).length, 14);
  });
  it('drains durable account deletion after the charge row has already been removed', async () => {
    const missingCharge = crypto.randomUUID();
    const key = `proofs/${missingCharge}/${crypto.randomUUID()}`;
    await bucket.write(key, Buffer.from('account file'));
    await db.transaction((tx) => enqueueStorageDeletion(tx, { key, chargeId: missingCharge, purpose: 'account' }, clock));
    await drainStorageDeletions(db, storage, () => clock);
    equal(
      (
        await db.storage_deletions.findOne({
          select: { state: true },
          where: { object_key: key }
        })
      )?.state,
      'deleted'
    );
    await rejects(() => bucket.read(key));
    await db.storage_deletions.deleteMany({
      where: { charge_id: missingCharge }
    });
  });
  it('never treats a failed listing as successful reconciliation or advances its durable cursor', async () => {
    const beforeCursor = await db.storage_cleanup_cursors.findOne({
      select: { cursor: true, updated_at: true },
      where: { id: 'proof-objects' }
    });
    await rejects(
      () =>
        reconcileProofStorage(
          db,
          {
            ...storage,
            list: async () => {
              throw new Error('listing unavailable');
            }
          },
          () => clock + 1000
        ),
      /listing unavailable/
    );
    equal(
      (
        await db.storage_cleanup_cursors.findOne({
          select: { updated_at: true },
          where: { id: 'proof-objects' }
        })
      )?.updated_at,
      beforeCursor?.updated_at
    );
  });
});
