import { deepEqual, equal, notEqual, ok, rejects } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Service } from '@ez4/common';
import { HttpForbiddenError, HttpUnauthorizedError } from '@ez4/gateway';
import { QueueTester } from '@ez4/local-queue/test';
import { BucketTester } from '@ez4/local-storage/test';
import { deleteHandler } from '../../src/account/endpoints';
import { eraseAccount, revokeSession, updateProfile } from '../../src/account/repository';
import { issueAccessToken } from '../../src/auth/session';
import { sessionAuthorizer } from '../../src/authorizers/session';
import { getCharge, recordManualPayment } from '../../src/charges/repository';
import { registerDevice } from '../../src/notifications/repository';
import { savePaymentMethod } from '../../src/payment-methods/repository';
import { savePerson } from '../../src/people/repository';
import type { StorageQueue } from '../../src/proofs/queue';
import type { ApiProvider } from '../../src/provider';
import { createOrRotatePublicLink, getPublicCharge } from '../../src/public/repository';
import { createAuthRepository } from '../../src/repositories/auth-repository';
import { cleanupUsers, createOnceCharge, createUser, db } from '../fixtures/financial';

const owner = '61000000-0000-4000-8000-000000000001';
const debtor = '61000000-0000-4000-8000-000000000002';
const secret = 'account-tests-only-secret';
const context = { db, variables: { AUTH_JWT_SECRET: secret } } as Service.Context<ApiProvider>;
const repository = createAuthRepository(db);
const ids = [owner, debtor];
const bucket = BucketTester.getClientMock('ProofFiles', { keys: {} });
QueueTester.setClientMock<StorageQueue>('StorageQueue');
const storageQueue = QueueTester.getClientMock<StorageQueue>('StorageQueue');
const deleteContext = { ...context, storageQueue } as Service.Context<ApiProvider>;
async function session(userId: string) {
  const value = await repository.issueSession(userId, 'Test installation');
  return { ...value, userId, access: issueAccessToken({ ...value, userId, secret }) };
}
async function authorize(access: string) {
  return sessionAuthorizer({ headers: { authorization: `Bearer ${access}` } }, context);
}

describe('account lifecycle on dedicated PostgreSQL', () => {
  before(async () => {
    const [database] = await db.rawQuery('SELECT current_database() AS name');
    equal(database?.['name'], 'receivy_tests');
    await createUser(db, { id: owner, email: 'account-owner@example.com', name: 'Account Owner' });
    await savePaymentMethod(db, owner, { pixKeyType: 'email', pixKey: 'account-owner@example.com' });
    await createUser(db, { id: debtor, email: 'account-debtor@example.com', name: 'Account Debtor' });
  });
  after(async () => {
    const families = await db.session_families.findMany({ select: { id: true }, where: { user_id: { isIn: ids } } });
    if (families.records.length) await db.refresh_tokens.deleteMany({ where: { family_id: { isIn: families.records.map((x) => x.id) } } });
    await db.session_families.deleteMany({ where: { user_id: { isIn: ids } } });
    await db.auth_identities.deleteMany({ where: { user_id: { isIn: ids } } });
    await cleanupUsers(db, ids);
  });
  it('rejects issued access after remote revocation and forbids foreign or missing families', async () => {
    const current = await session(owner);
    equal((await authorize(current.access)).identity.userId, owner);
    await rejects(() => revokeSession(db, debtor, current.familyId), HttpForbiddenError);
    await revokeSession(db, owner, current.familyId);
    await rejects(() => authorize(current.access), HttpUnauthorizedError);
    await rejects(() => authorize(issueAccessToken({ familyId: current.familyId, userId: debtor, secret })), HttpUnauthorizedError);
    await rejects(() => authorize(issueAccessToken({ familyId: crypto.randomUUID(), userId: owner, secret })), HttpUnauthorizedError);
  });
  it('logout and refresh replay remove only corresponding push registrations plus unlinked legacy tokens', async () => {
    const first = await session(owner);
    const second = await session(owner);
    const a = await registerDevice(
      db,
      owner,
      { token: 'ExpoPushToken[account_a]', installationId: 'account-a', platform: 'ios' },
      first.familyId
    );
    const b = await registerDevice(
      db,
      owner,
      { token: 'ExpoPushToken[account_b]', installationId: 'account-b', platform: 'android' },
      second.familyId
    );
    const legacy = await registerDevice(db, owner, {
      token: 'ExpoPushToken[account_legacy]',
      installationId: 'account-legacy',
      platform: 'ios'
    });
    await repository.revokeFamilyByRefreshToken(first.refreshToken);
    await rejects(() => authorize(first.access), HttpUnauthorizedError);
    equal((await db.device_tokens.findOne({ select: { active: true }, where: { id: a.id } }))?.active, false);
    equal((await db.device_tokens.findOne({ select: { active: true }, where: { id: b.id } }))?.active, true);
    equal((await db.device_tokens.findOne({ select: { active: true }, where: { id: legacy.id } }))?.active, false);
    equal((await repository.rotateRefreshToken(second.refreshToken)).kind, 'rotated');
    const raced = await Promise.allSettled([
      repository.rotateRefreshToken(second.refreshToken),
      registerDevice(db, owner, { token: 'ExpoPushToken[account_race]', installationId: 'account-race', platform: 'ios' }, second.familyId)
    ]);
    ok(raced[0].status === 'fulfilled');
    equal(raced[0].value.kind, 'replayed');
    equal(await db.device_tokens.count({ where: { user_id: owner, session_family_id: second.familyId, active: true } }), 0);
    await rejects(() => authorize(second.access), HttpUnauthorizedError);
    equal((await db.device_tokens.findOne({ select: { active: true }, where: { id: b.id } }))?.active, false);
  });
  it('erases the account and still reports a legacy proof key the consumer will refuse', async () => {
    const id = crypto.randomUUID();
    ids.push(id);
    await createUser(db, { id, email: 'rollback-account@example.com', name: 'Rollback fixture' });
    const person = await savePerson(db, owner, { name: 'Rollback fixture', email: 'rollback-account@example.com' });
    const { chargeId: rollbackChargeId } = await createOnceCharge(db, owner, 'account-rollback', {
      personId: person.id,
      amountCents: 50,
      dueDate: '2026-10-01'
    });
    const proofId = crypto.randomUUID();
    const auth = await session(id);
    await db.payment_proofs.insertOne({
      data: {
        id: proofId,
        charge: { id: rollbackChargeId },
        sender_user: { id },
        object_key: 'invalid-legacy-key',
        original_name: 'fixture.pdf',
        mime: 'application/pdf',
        size: 1,
        sha256: '0'.repeat(64),
        state: 'pending',
        created_at: new Date().toISOString()
      }
    });
    // An unroutable key can no longer make an account undeletable: the consumer rejects it.
    const { storageMessages } = await eraseAccount(db, id, 'EXCLUIR');
    deepEqual(storageMessages, [{ objectKey: 'invalid-legacy-key', chargeId: rollbackChargeId, purpose: 'account' }]);
    await rejects(() => authorize(auth.access), HttpUnauthorizedError);
    equal((await getCharge(db, owner, rollbackChargeId)).recipient.email, null);
    equal(await db.payment_proofs.count({ where: { id: proofId } }), 0);
  });
  it('validates profile', async () => {
    await updateProfile(db, owner, { name: '  Ana  ', locale: 'pt-BR', timezone: 'America/Manaus', country: 'BR' });
    equal((await db.users.findOne({ select: { name: true }, where: { id: owner } }))?.name, 'Ana');
    await rejects(() => updateProfile(db, owner, { name: ' ', locale: 'pt-BR', timezone: 'bad/zone', country: 'BR' }));
  });
  it("atomically erases identity, preserves other account's payment fact and closes re-registration history access", async () => {
    const person = await savePerson(db, owner, { name: 'Account Debtor', email: 'account-debtor@example.com' });
    const { chargeId } = await createOnceCharge(db, owner, 'account-history', {
      personId: person.id,
      amountCents: 1234,
      dueDate: '2026-10-01'
    });
    const publicLink = await createOrRotatePublicLink(db, owner, chargeId, secret);
    await recordManualPayment(db, owner, chargeId, { method: 'pix' });
    const ownedProofId = crypto.randomUUID();
    const anonymousId = crypto.randomUUID();
    const ownKey = `proofs/${chargeId}/${ownedProofId}`;
    const anonymousKey = `proofs/${chargeId}/${anonymousId}`;
    for (const [id, key, sender] of [
      [ownedProofId, ownKey, debtor],
      [anonymousId, anonymousKey, null]
    ] as const) {
      await bucket.write(key, Buffer.from('%PDF-1.7\nfixture'));
      await db.payment_proofs.insertOne({
        data: {
          id,
          charge: { id: chargeId },
          ...(sender ? { sender_user: { id: sender } } : {}),
          object_key: key,
          original_name: 'fixture.pdf',
          mime: 'application/pdf',
          size: 16,
          sha256: '0'.repeat(64),
          state: 'accepted',
          created_at: new Date().toISOString()
        }
      });
    }
    await db.payments.updateOne({ where: { charge_id: chargeId }, data: { proof: { id: ownedProofId } } });
    const current = await session(debtor);
    equal((await getCharge(db, debtor, chargeId)).direction, 'payable');
    const concurrent = await Promise.all([eraseAccount(db, debtor, 'EXCLUIR'), eraseAccount(db, debtor, 'EXCLUIR')]);
    deepEqual(
      concurrent.map((result) => result.deleted),
      [true, true]
    );
    // Exactly one erasure performs the work (no Apple identity => not_required); the loser observes an already-deleted row.
    deepEqual(concurrent.map((result) => result.providerRevocation).sort(), ['not_required', 'unknown']);
    deepEqual(await eraseAccount(db, debtor, 'EXCLUIR'), { deleted: true, providerRevocation: 'unknown', storageMessages: [] });
    await rejects(() => authorize(current.access), HttpUnauthorizedError);
    const injectedFamily = crypto.randomUUID();
    await db.session_families.insertOne({
      data: { id: injectedFamily, user: { id: debtor }, created_at: new Date().toISOString(), last_seen_at: new Date().toISOString() }
    });
    await rejects(
      () => authorize(issueAccessToken({ familyId: injectedFamily, userId: debtor, secret })),
      HttpUnauthorizedError,
      'deleted user is denied even when an old family was not marked revoked'
    );
    await rejects(() => repository.issueSession(debtor), /Account unavailable/);
    equal((await repository.rotateRefreshToken(current.refreshToken)).kind, 'invalid');
    const row = await getCharge(db, owner, chargeId);
    equal(row.state, 'paid');
    equal(row.payment?.amount.amountCents, 1234);
    equal(row.recipient.email, null);
    equal(row.recipient.name, 'Conta excluída');
    await rejects(() => getPublicCharge(db, publicLink.token, secret));
    equal(await db.payment_proofs.count({ where: { id: ownedProofId } }), 0);
    equal(await db.payment_proofs.count({ where: { id: anonymousId } }), 1);
    equal((await db.payments.findOne({ select: { proof_id: true }, where: { charge_id: chargeId } }))?.proof_id, null);
    // Only the erasure that did the work reports files, and only the ones it owned.
    deepEqual(
      concurrent.flatMap((result) => result.storageMessages),
      [{ objectKey: ownKey, chargeId, purpose: 'account' }]
    );
    ok(await bucket.read(anonymousKey), 'unattributed counterparty file preserved');
    const replacement = await repository.findOrCreateUserByEmail('account-debtor@example.com');
    ids.push(replacement.id);
    notEqual(replacement.id, debtor);
    await rejects(() => getCharge(db, replacement.id, chargeId), HttpForbiddenError);
    await rejects(
      () => savePerson(db, debtor, { name: 'Stale request' }),
      HttpUnauthorizedError,
      'a pre-authorized request cannot recreate contacts after erasure'
    );
    await rejects(() => savePaymentMethod(db, debtor, { pixKeyType: 'email', pixKey: 'stale@example.com' }), HttpUnauthorizedError);
  });
  it('sends every erased file to the storage queue after the transaction commits', async () => {
    const id = crypto.randomUUID();
    ids.push(id);
    await createUser(db, { id, email: 'queued-account@example.com', name: 'Queued fixture' });
    const person = await savePerson(db, owner, { name: 'Queued fixture', email: 'queued-account@example.com' });
    const { chargeId } = await createOnceCharge(db, owner, 'account-queued', {
      personId: person.id,
      amountCents: 70,
      dueDate: '2026-10-01'
    });
    const proofId = crypto.randomUUID();
    const objectKey = `proofs/${chargeId}/${proofId}`;
    await bucket.write(objectKey, Buffer.from('%PDF-1.7\nfixture'));
    await db.payment_proofs.insertOne({
      data: {
        id: proofId,
        charge: { id: chargeId },
        sender_user: { id },
        object_key: objectKey,
        original_name: 'fixture.pdf',
        mime: 'application/pdf',
        size: 16,
        sha256: '0'.repeat(64),
        state: 'accepted',
        created_at: new Date().toISOString()
      }
    });
    storageQueue.sendMessage.mock.resetCalls();
    const request = { identity: { userId: id }, body: { confirmation: 'EXCLUIR' } } as Parameters<typeof deleteHandler>[0];
    const response = await deleteHandler(request, deleteContext);
    deepEqual(response.body, { deleted: true, providerRevocation: 'not_required' });
    deepEqual(
      storageQueue.sendMessage.mock.calls.map((call) => call.arguments[0]),
      [{ objectKey, chargeId, purpose: 'account' }]
    );
    equal(await db.payment_proofs.count({ where: { id: proofId } }), 0);
  });
});
