import { equal, ok, rejects, throws } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, it } from 'node:test';
import { eraseAccount } from '../../src/account/deletion';
import { lockAccountReferences } from '../../src/account/locking';
import {
  activateAppleCredential,
  bindAppleCredential,
  claimAppleActivation,
  decryptAppleToken,
  drainAppleRevocations,
  journalAppleCredential
} from '../../src/auth/apple-credentials';
import { commitOauthIdentity } from '../../src/auth/oauth-commit';
import { cleanupUsers, createUser, db } from '../fixtures/financial';

const userId = randomUUID();
const ids = [userId],
  journalIds: string[] = [],
  key = Buffer.alloc(32, 7).toString('base64'),
  clientId = 'dev.receivy.fixture';
const started = new Date().toISOString();
async function journal(subject: string, token = `refresh-${randomUUID()}`) {
  const id = await journalAppleCredential(db, key, clientId, token);
  journalIds.push(id);
  await bindAppleCredential(db, key, id, subject);
  return id;
}
async function activate(id: string, owner: string) {
  await db.transaction(async (tx) => {
    await lockAccountReferences(tx, 'write');
    await claimAppleActivation(tx, id);
    await activateAppleCredential(tx, id, owner);
  });
}
before(async () => {
  await createUser(db, { id: userId, email: `${userId}@example.com`, name: 'Apple legacy' });
  await db.auth_identities.insertOne({
    data: {
      id: randomUUID(),
      user: { id: userId },
      provider: 'apple',
      provider_user_id: 'apple-legacy-fixture',
      email: `${userId}@example.com`,
      email_verified: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  });
});
after(async () => {
  await db.apple_credentials.deleteMany({
    where: { OR: [{ id: { isIn: journalIds } }, { client_id: 'legacy_unknown', created_at: { gte: started } }] }
  });
  const grants = await db.oauth_grants.findMany({ select: { id: true }, where: { user_id: { isIn: ids } } });
  if (grants.records.length) await db.oauth_grants.deleteMany({ where: { id: { isIn: grants.records.map((row) => row.id) } } });
  await db.auth_identities.deleteMany({ where: { user_id: { isIn: ids } } });
  await cleanupUsers(db, ids);
});
it('local erasure does not falsely certify Apple revocation when a legacy credential is missing', async () => {
  const result = await eraseAccount(db, userId, 'EXCLUIR');
  equal(result.deleted, true);
  equal((result as { providerRevocation?: string }).providerRevocation, 'manual_action_required');
});

it('encrypts credentials with row/client binding and protects the bounded staging window', async () => {
  const id = await journal('staging-subject', 'secret-apple-refresh');
  const row = await db.apple_credentials.findOne({ select: { id: true, client_id: true, ciphertext: true }, where: { id } });
  ok(row);
  ok(!JSON.stringify(row).includes('secret-apple-refresh'));
  equal(decryptAppleToken(key, row), 'secret-apple-refresh');
  throws(() => decryptAppleToken(key, { ...row, id: randomUUID() }));
  let calls = 0;
  await drainAppleRevocations(db, key, async () => {
    calls++;
    return 'revoked';
  });
  equal(calls, 0);
  await drainAppleRevocations(
    db,
    key,
    async () => {
      calls++;
      return 'revoked';
    },
    () => Date.now() + 11 * 60_000
  );
  equal(calls, 1);
  await rejects(() =>
    db.transaction(async (tx) => {
      await lockAccountReferences(tx, 'write');
      await claimAppleActivation(tx, id);
    })
  );
  equal((await db.apple_credentials.findOne({ select: { ciphertext: true, state: true }, where: { id } }))?.ciphertext, null);
});

it('leaves a rollback journal retryable without a partial local identity or grant', async () => {
  const subject = randomUUID(),
    id = await journal(subject),
    email = `${subject}@example.com`;
  await rejects(() =>
    commitOauthIdentity(db, {
      provider: 'apple',
      identity: { subject, email, emailAuthoritative: true, appleCredentialId: id },
      clientChallenge: 'a'.repeat(43),
      grantHash: 'g'.repeat(200),
      expiresAt: new Date(Date.now() + 60_000)
    })
  );
  equal(await db.users.count({ where: { email } }), 0);
  equal((await db.apple_credentials.findOne({ select: { state: true }, where: { id } }))?.state, 'pending');
});

it('detaches on deletion and blocks relogin until pending/leased revocations finish without holding locks over I/O', async () => {
  const owner = randomUUID();
  ids.push(owner);
  await createUser(db, { id: owner, name: 'Apple', email: `${owner}@example.com` });
  const subject = randomUUID(),
    first = await journal(subject);
  await activate(first, owner);
  equal((await eraseAccount(db, owner, 'EXCLUIR')).providerRevocation, 'pending');
  equal((await db.apple_credentials.findOne({ select: { user_id: true }, where: { id: first } }))?.user_id, null);
  const second = await journal(subject);
  await rejects(() => activate(second, owner));
  let during = false;
  await drainAppleRevocations(
    db,
    key,
    async () => {
      // Would deadlock if the worker retained its shared account barrier across provider I/O.
      await db.transaction(async (tx) => {
        await lockAccountReferences(tx, 'erase');
      });
      if (!during) {
        during = true;
        await rejects(() => activate(second, owner));
      }
      return 'revoked';
    },
    () => Date.now() + 11 * 60_000
  );
  ok(during);
  const newOwner = randomUUID();
  ids.push(newOwner);
  await createUser(db, { id: newOwner, name: 'New account', email: `${newOwner}@example.com` });
  const third = await journal(subject);
  await activate(third, newOwner);
  equal((await db.apple_credentials.findOne({ select: { state: true }, where: { id: third } }))?.state, 'active');
});

it('preserves ciphertext on key-loss/provider failure and retries only after the durable deadline', async () => {
  const id = await journal(randomUUID()),
    future = Date.now() + 12 * 60_000;
  await drainAppleRevocations(
    db,
    'disabled',
    async () => {
      throw new Error('must not call provider');
    },
    () => future
  );
  let row = await db.apple_credentials.findOne({ select: { state: true, ciphertext: true, available_at: true }, where: { id } });
  ok(row?.ciphertext);
  equal(row?.state, 'blocked');
  await drainAppleRevocations(
    db,
    key,
    async () => 'transient',
    () => Date.parse(row!.available_at)
  );
  row = await db.apple_credentials.findOne({ select: { state: true, ciphertext: true, available_at: true }, where: { id } });
  equal(row?.state, 'pending');
  ok(row?.ciphertext);
  await drainAppleRevocations(
    db,
    key,
    async () => 'revoked',
    () => Date.parse(row!.available_at)
  );
  equal((await db.apple_credentials.findOne({ select: { state: true, ciphertext: true }, where: { id } }))?.state, 'revoked');
});
