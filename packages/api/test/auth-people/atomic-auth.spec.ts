import { equal, ok, rejects } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, describe, it } from 'node:test';
import { authStore } from '../../src/users/services/auth-store';
import { AuthFlowError } from '../../src/users/services/email-login';
import { hashOauthValue } from '../../src/users/services/oauth';
import { confirmEmailAtomically, exchangeOauthAtomically } from '../../src/users/utils/atomic';
import { cleanupUsers, db } from '../fixtures/financial';

const email = `atomic-${randomUUID()}@example.com`;
const codeHashKey = 'atomic-test-code-secret-only';
const accessTokenSecret = 'atomic-test-session-secret-only';
const config = { codeHashKey, accessTokenSecret };
const repo = authStore(db);
const ids: string[] = [];

describe('atomic authentication on PostgreSQL', () => {
  after(async () => {
    const users = await db.users.findMany({ select: { id: true }, where: { email } });

    ids.push(...users.records.map((x) => x.id));

    const families = await db.session_families.findMany({ select: { id: true }, where: { user_id: { isIn: ids } } });

    if (families.records.length) {
      await db.refresh_tokens.deleteMany({ where: { family_id: { isIn: families.records.map((x) => x.id) } } });
    }

    await db.session_families.deleteMany({ where: { user_id: { isIn: ids } } });
    await db.auth_identities.deleteMany({ where: { user_id: { isIn: ids } } });
    await db.oauth_grants.deleteMany({ where: { user_id: { isIn: ids } } });
    await db.login_codes.deleteMany({ where: { email } });
    await cleanupUsers(db, ids);
  });
  it('rolls back code consumption, new user and linkage if session persistence fails', async () => {
    await repo.replaceLoginCode({ email, code: '123456', codeHashKey });
    await rejects(() => confirmEmailAtomically(db, { email, code: '123456', deviceName: 'x'.repeat(121) }, config));

    equal((await db.login_codes.findOne({ select: { consumed_at: true }, where: { email } }))?.consumed_at, null);
    equal(await db.users.count({ where: { email } }), 0);

    const outcomes = await Promise.allSettled([1, 2].map(() => confirmEmailAtomically(db, { email, code: '123456' }, config)));

    equal(outcomes.filter((x) => x.status === 'fulfilled').length, 1);
    equal(outcomes.filter((x) => x.status === 'rejected' && x.reason instanceof AuthFlowError).length, 1);

    const result = outcomes.find((x) => x.status === 'fulfilled');

    ok(result?.status === 'fulfilled');
    ids.push(result.value.user.id);
    equal(await db.session_families.count({ where: { user_id: result.value.user.id } }), 1);
  });
  it('commits failed OTP attempt counters despite returning a generic failure', async () => {
    await db.login_codes.updateOne({
      where: { email },
      data: { consumed_at: null as unknown as undefined, attempts: 0, expires_at: new Date(Date.now() + 600000).toISOString() }
    });

    for (let index = 0; index < 5; index++) {
      await rejects(() => confirmEmailAtomically(db, { email, code: '000000' }, config), AuthFlowError);
    }

    equal((await db.login_codes.findOne({ select: { attempts: true }, where: { email } }))?.attempts, 5);

    await rejects(() => confirmEmailAtomically(db, { email, code: '123456' }, config), AuthFlowError);
  });
  it('rolls back grant consumption on session failure and serializes concurrent successful exchange', async () => {
    const code = randomUUID();
    const codeVerifier = 'v'.repeat(43);
    const userId = (await repo.findOrCreateUserByEmail(email)).id;

    ids.push(userId);

    await repo.createGrant({
      userId,
      grantHash: hashOauthValue(code),
      clientChallenge: hashOauthValue(codeVerifier),
      expiresAt: new Date(Date.now() + 120000)
    });
    await rejects(() => exchangeOauthAtomically(db, { code, codeVerifier, deviceName: 'x'.repeat(121) }, config));

    equal(
      (await db.oauth_grants.findOne({ select: { consumed_at: true }, where: { grant_hash: hashOauthValue(code) } }))?.consumed_at,
      null
    );

    const before = await db.session_families.count({ where: { user_id: userId } });
    const outcomes = await Promise.allSettled([1, 2].map(() => exchangeOauthAtomically(db, { code, codeVerifier }, config)));

    equal(outcomes.filter((x) => x.status === 'fulfilled').length, 1);
    equal(await db.session_families.count({ where: { user_id: userId } }), before + 1);
  });
});
