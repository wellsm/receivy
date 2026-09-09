import { equal, ok, rejects } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, it } from 'node:test';
import { beginNativeApple, exchangeNativeApple } from '../../src/auth/apple-native';
import { hashOauthValue } from '../../src/auth/oauth';
import type { OauthProviderClient } from '../../src/auth/oauth-flow';
import { createAuthRepository } from '../../src/repositories/auth-repository';
import { cleanupUsers, db } from '../fixtures/financial';

const verifier = 'a'.repeat(43),
  secret = 'native-apple-fixture-only-secret';
const users: string[] = [],
  states: string[] = [];
after(async () => {
  await db.oauth_attempts.deleteMany({ where: { state_hash: { isIn: states } } });
  const families = await db.session_families.findMany({ select: { id: true }, where: { user_id: { isIn: users } } });
  if (families.records.length)
    await db.refresh_tokens.deleteMany({ where: { family_id: { isIn: families.records.map((row) => row.id) } } });
  await db.session_families.deleteMany({ where: { user_id: { isIn: users } } });
  await db.auth_identities.deleteMany({ where: { user_id: { isIn: users } } });
  await cleanupUsers(db, users);
});
it('binds native challenge/verifier/state, exchanges once concurrently, and commits identity and session together', async () => {
  const challenge = await beginNativeApple(db, hashOauthValue(verifier));
  states.push(hashOauthValue(challenge.state));
  const subject = randomUUID(),
    email = `${subject}@example.com`;
  let calls = 0;
  const client: OauthProviderClient = {
    authorizationUrl: () => 'unused',
    verifyAuthorizationCode: async (input) => {
      calls++;
      equal(input.nonce, challenge.nonce);
      equal(input.code, 'native-code');
      return { subject, email, emailAuthoritative: true };
    }
  };
  await rejects(() =>
    exchangeNativeApple(db, { state: challenge.state, codeVerifier: 'wrong'.repeat(10), authorizationCode: 'native-code' }, client, secret)
  );
  equal(calls, 0);
  const results = await Promise.allSettled(
    [1, 2].map(() =>
      exchangeNativeApple(db, { state: challenge.state, codeVerifier: verifier, authorizationCode: 'native-code' }, client, secret)
    )
  );
  equal(results.filter((row) => row.status === 'fulfilled').length, 1);
  equal(calls, 1);
  const winner = results.find((row) => row.status === 'fulfilled');
  ok(winner?.status === 'fulfilled');
  users.push(winner.value.user.id);
  equal(await db.session_families.count({ where: { user_id: winner.value.user.id } }), 1);
  equal(await db.auth_identities.count({ where: { user_id: winner.value.user.id, provider: 'apple', provider_user_id: subject } }), 1);
  await rejects(() =>
    exchangeNativeApple(db, { state: challenge.state, codeVerifier: verifier, authorizationCode: 'native-code' }, client, secret)
  );
  equal(calls, 1);
});
it('rejects browser/native challenge substitution before provider I/O', async () => {
  const state = randomUUID();
  states.push(hashOauthValue(state));
  await createAuthRepository(db).createAttempt({
    provider: 'apple',
    clientChallenge: hashOauthValue(verifier),
    stateHash: hashOauthValue(state),
    destination: 'receivy://auth/callback',
    nonce: 'web-nonce',
    codeVerifier: verifier,
    expiresAt: new Date(Date.now() + 60_000)
  });
  const client: OauthProviderClient = {
    authorizationUrl: () => 'unused',
    verifyAuthorizationCode: async () => {
      throw new Error('must not call provider');
    }
  };
  await rejects(() => exchangeNativeApple(db, { state, codeVerifier: verifier, authorizationCode: 'web-code' }, client, secret));
  equal(
    (await db.oauth_attempts.findOne({ select: { consumed_at: true }, where: { provider: 'apple', state_hash: hashOauthValue(state) } }))
      ?.consumed_at,
    null
  );
});
