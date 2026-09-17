import { deepEqual, equal, notEqual, ok, rejects } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Service } from '@ez4/common';
import { HttpForbiddenError, HttpUnauthorizedError } from '@ez4/gateway';
import { BucketTester } from '@ez4/local-storage/test';
import { DevicePlatform, PixKeyType, ProofKind, ProofMime } from '@receivy/common';
import { ChargeRepository } from '../../src/charges/repositories/charge';
import { StoredProofState } from '../../src/charges/schemas/charge';
import { currentProof } from '../../src/proofs/repositories/proof-row';
import type { SessionAuthorizerProvider } from '../../src/common/authorizers/session';
import { sessionAuthorizer } from '../../src/common/authorizers/session';
import { ContactRepository } from '../../src/contacts/repositories/contact';
import { NotificationRepository } from '../../src/notifications/repositories/notification';
import { PaymentMethodRepository } from '../../src/payment-methods/repositories/payment-method';
import { ProofRepository } from '../../src/proofs/repositories/proof';
import { PublicLinkRepository } from '../../src/public/repositories/public-link';
import { deleteHandler } from '../../src/users/endpoints/delete-account';
import type { UserProvider } from '../../src/users/provider';
import { AccountRepository } from '../../src/users/repositories/account';
import { AuthRepository } from '../../src/users/repositories/auth';
import { AvatarRepository } from '../../src/users/repositories/avatar';
import { SessionRepository } from '../../src/users/repositories/sessions';
import { eraseAccount } from '../../src/users/services/deletion';
import { issueAccessToken } from '../../src/users/services/session';
import { cleanupUsers, createOnceCharge, createUser, db } from '../fixtures/financial';

const owner = '61000000-0000-4000-8000-000000000001';
const debtor = '61000000-0000-4000-8000-000000000002';
const secret = 'account-tests-only-secret';
const context = { db, variables: { AUTH_JWT_SECRET: secret } } as Service.Context<SessionAuthorizerProvider>;
const repository = AuthRepository.create(db);
const ids = [owner, debtor];
const bucket = BucketTester.getClientMock('ProofFiles', { keys: {} });
const deleteContext = { ...context, proofFiles: bucket } as unknown as Service.Context<UserProvider>;
async function session(userId: string) {
  const value = await repository.issueSession(userId, 'Test installation');
  return { ...value, userId, access: issueAccessToken({ ...value, userId, secret }) };
}
async function authorize(access: string) {
  return sessionAuthorizer({ headers: { authorization: `Bearer ${access}` } }, context);
}
/** A file already attached to the charge, sent by `sender` or by the public link when null. */
async function attachProof(
  chargeId: string,
  key: string,
  sender: string | null,
  state: StoredProofState.Pending | StoredProofState.Accepted = StoredProofState.Accepted
) {
  const now = new Date().toISOString();
  await db.proofs.deleteMany({ where: { charge_id: chargeId } });
  await db.proofs.insertOne({
    data: {
      id: crypto.randomUUID(),
      charge: { id: chargeId },
      state,
      kind: ProofKind.File,
      file: { key, name: 'fixture.pdf', mime: ProofMime.Pdf, size: 16, sha256: '0'.repeat(64) },
      ...(sender ? { sender: { id: sender } } : {}),
      actor_hash: sender
        ? ProofRepository.actorHash({ userId: sender })
        : ProofRepository.actorHash({ token: 'public-fixture', secret }),
      sent_at: now,
      created_at: now,
      updated_at: now
    }
  });
}
async function proofColumns(chargeId: string) {
  const row = await currentProof(db, chargeId);
  return { state: row?.state ?? null, key: row?.file?.key ?? null, sender: row?.sender_user_id ?? null };
}

describe('account lifecycle on dedicated PostgreSQL', () => {
  before(async () => {
    const [database] = await db.rawQuery('SELECT current_database() AS name');
    equal(database?.['name'], 'receivy_tests');
    await createUser(db, { id: owner, email: 'account-owner@example.com', name: 'Account Owner' });
    await PaymentMethodRepository.save(db, owner, { pixKeyType: PixKeyType.Email, pixKey: 'account-owner@example.com' });
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
    await rejects(() => SessionRepository.revoke(db, debtor, current.familyId), HttpForbiddenError);
    await SessionRepository.revoke(db, owner, current.familyId);
    await rejects(() => authorize(current.access), HttpUnauthorizedError);
    await rejects(() => authorize(issueAccessToken({ familyId: current.familyId, userId: debtor, secret })), HttpUnauthorizedError);
    await rejects(() => authorize(issueAccessToken({ familyId: crypto.randomUUID(), userId: owner, secret })), HttpUnauthorizedError);
  });
  it('logout and refresh replay remove only corresponding push registrations plus unlinked legacy tokens', async () => {
    const first = await session(owner);
    const second = await session(owner);
    const a = await NotificationRepository.registerDevice(
      db,
      owner,
      { token: 'ExpoPushToken[account_a]', installationId: 'account-a', platform: DevicePlatform.Ios },
      first.familyId
    );
    const b = await NotificationRepository.registerDevice(
      db,
      owner,
      { token: 'ExpoPushToken[account_b]', installationId: 'account-b', platform: DevicePlatform.Android },
      second.familyId
    );
    const legacy = await NotificationRepository.registerDevice(db, owner, {
      token: 'ExpoPushToken[account_legacy]',
      installationId: 'account-legacy',
      platform: DevicePlatform.Ios
    });
    await repository.revokeFamilyByRefreshToken(first.refreshToken);
    await rejects(() => authorize(first.access), HttpUnauthorizedError);
    equal((await db.device_tokens.findOne({ select: { active: true }, where: { id: a.id } }))?.active, false);
    equal((await db.device_tokens.findOne({ select: { active: true }, where: { id: b.id } }))?.active, true);
    equal((await db.device_tokens.findOne({ select: { active: true }, where: { id: legacy.id } }))?.active, false);
    equal((await repository.rotateRefreshToken(second.refreshToken)).kind, 'rotated');
    const raced = await Promise.allSettled([
      repository.rotateRefreshToken(second.refreshToken),
      NotificationRepository.registerDevice(
        db,
        owner,
        { token: 'ExpoPushToken[account_race]', installationId: 'account-race', platform: DevicePlatform.Ios },
        second.familyId
      )
    ]);
    ok(raced[0].status === 'fulfilled');
    equal(raced[0].value.kind, 'replayed');
    equal(await db.device_tokens.count({ where: { user_id: owner, session_family_id: second.familyId, active: true } }), 0);
    await rejects(() => authorize(second.access), HttpUnauthorizedError);
    equal((await db.device_tokens.findOne({ select: { active: true }, where: { id: b.id } }))?.active, false);
  });
  it('erases the account and reports even a legacy proof key the bucket will not know', async () => {
    const id = crypto.randomUUID();
    ids.push(id);
    await createUser(db, { id, email: 'rollback-account@example.com', name: 'Rollback fixture' });
    const person = await ContactRepository.save(db, owner, { name: 'Rollback fixture', email: 'rollback-account@example.com' });
    const { chargeId: rollbackChargeId } = await createOnceCharge(db, owner, 'account-rollback', {
      userId: person.userId,
      amountCents: 50,
      dueDate: '2026-10-01'
    });
    const auth = await session(id);
    await attachProof(rollbackChargeId, 'invalid-legacy-key', id, StoredProofState.Pending);
    // An unroutable key can no longer make an account undeletable: the caller drops it best-effort.
    const { objectKeys } = await eraseAccount(db, id, 'EXCLUIR');
    deepEqual(objectKeys, [AvatarRepository.key(id), AvatarRepository.stagingKey(id), 'invalid-legacy-key']);
    await rejects(() => authorize(auth.access), HttpUnauthorizedError);
    equal((await ChargeRepository.get(db, owner, rollbackChargeId)).recipient.email, null);
    deepEqual(await proofColumns(rollbackChargeId), { state: null, key: null, sender: null });
  });
  it('validates profile', async () => {
    await AccountRepository.updateProfile(db, owner, { name: '  Ana  ', locale: 'pt-BR', timezone: 'America/Manaus', country: 'BR' });
    equal((await db.users.findOne({ select: { name: true }, where: { id: owner } }))?.name, 'Ana');
    await rejects(() => AccountRepository.updateProfile(db, owner, { name: ' ', locale: 'pt-BR', timezone: 'bad/zone', country: 'BR' }));
  });
  it("atomically erases identity, preserves other account's payment fact and closes re-registration history access", async () => {
    const person = await ContactRepository.save(db, owner, { name: 'Account Debtor', email: 'account-debtor@example.com' });
    const { chargeId } = await createOnceCharge(db, owner, 'account-history', {
      userId: person.userId,
      amountCents: 1234,
      dueDate: '2026-10-01'
    });
    const { chargeId: anonymousChargeId } = await createOnceCharge(db, owner, 'account-anonymous', {
      userId: person.userId,
      amountCents: 70,
      dueDate: '2026-10-02'
    });
    const publicLink = await PublicLinkRepository.createOrRotate(db, owner, chargeId, secret);
    await ChargeRepository.pay(db, owner, chargeId);
    const ownKey = `proofs/${chargeId}/${crypto.randomUUID()}`;
    const anonymousKey = `proofs/${anonymousChargeId}/${crypto.randomUUID()}`;
    await bucket.write(ownKey, Buffer.from('%PDF-1.7\nfixture'));
    await bucket.write(anonymousKey, Buffer.from('%PDF-1.7\nfixture'));
    await attachProof(chargeId, ownKey, debtor);
    await attachProof(anonymousChargeId, anonymousKey, null, StoredProofState.Pending);
    const current = await session(debtor);
    equal((await ChargeRepository.get(db, debtor, chargeId)).direction, 'payable');
    const concurrent = await Promise.all([eraseAccount(db, debtor, 'EXCLUIR'), eraseAccount(db, debtor, 'EXCLUIR')]);
    deepEqual(
      concurrent.map((result) => result.deleted),
      [true, true]
    );
    // Exactly one erasure performs the work; the loser observes an already-deleted row and reports no new files.
    equal(concurrent.filter((result) => result.objectKeys.length > 0).length, 1);
    deepEqual(await eraseAccount(db, debtor, 'EXCLUIR'), { deleted: true, objectKeys: [] });
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
    const row = await ChargeRepository.get(db, owner, chargeId);
    equal(row.state, 'paid');
    ok(row.paidAt, 'the settlement survives the payer');
    equal(row.amount.amountCents, 1234);
    equal(row.recipient.email, null);
    equal(row.recipient.name, 'Conta excluída');
    equal(row.proof, null, 'the file the erased person sent goes with them');
    // The link belongs to the creditor's charge, not to the payer: it keeps answering, with nothing of theirs on it.
    equal((await PublicLinkRepository.getCharge(db, publicLink.token, secret)).state, 'paid');
    deepEqual(await proofColumns(chargeId), { state: null, key: null, sender: null });
    deepEqual(await proofColumns(anonymousChargeId), { state: 'pending', key: anonymousKey, sender: null });
    // Only the erasure that did the work reports files, and only the ones it owned.
    deepEqual(
      concurrent.flatMap((result) => result.objectKeys),
      [AvatarRepository.key(debtor), AvatarRepository.stagingKey(debtor), ownKey]
    );
    ok(await bucket.read(anonymousKey), 'unattributed counterparty file preserved');
    const replacement = await repository.findOrCreateUserByEmail('account-debtor@example.com');
    ids.push(replacement.id);
    notEqual(replacement.id, debtor);
    await rejects(() => ChargeRepository.get(db, replacement.id, chargeId), HttpForbiddenError);
    await rejects(
      () => ContactRepository.save(db, debtor, { name: 'Stale request', email: 'stale-contact@example.com' }),
      HttpUnauthorizedError,
      'a pre-authorized request cannot recreate contacts after erasure'
    );
    await rejects(
      () => PaymentMethodRepository.save(db, debtor, { pixKeyType: PixKeyType.Email, pixKey: 'stale@example.com' }),
      HttpUnauthorizedError
    );
  });
  it('drops every erased file from the bucket after the transaction commits', async () => {
    const id = crypto.randomUUID();
    ids.push(id);
    await createUser(db, { id, email: 'queued-account@example.com', name: 'Queued fixture' });
    const person = await ContactRepository.save(db, owner, { name: 'Queued fixture', email: 'queued-account@example.com' });
    const { chargeId } = await createOnceCharge(db, owner, 'account-queued', {
      userId: person.userId,
      amountCents: 70,
      dueDate: '2026-10-01'
    });
    const objectKey = `proofs/${chargeId}/${crypto.randomUUID()}`;
    await bucket.write(objectKey, Buffer.from('%PDF-1.7\nfixture'));
    await attachProof(chargeId, objectKey, id);
    const request = { identity: { userId: id }, body: { confirmation: 'EXCLUIR' } } as Parameters<typeof deleteHandler>[0];
    const response = await deleteHandler(request, deleteContext);
    deepEqual(response.body, { deleted: true });
    equal(await bucket.exists(objectKey), false);
    deepEqual(await proofColumns(chargeId), { state: null, key: null, sender: null });
  });
});
