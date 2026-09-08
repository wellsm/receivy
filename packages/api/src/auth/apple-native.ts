import { HttpUnauthorizedError } from '@ez4/gateway';
import type { AuthSessionResponse } from '@receivy/common';
import { lockAccountReferences } from '../account/locking';
import type { DbClient } from '../database';
import { createAuthRepository } from '../repositories/auth-repository';
import { activateAppleCredential, claimAppleActivation } from './apple-credentials';
import { createOauthAttempt, hashOauthValue } from './oauth';
import type { OauthProviderClient } from './oauth-flow';
import { issueAccessToken } from './session';

const DESTINATION = 'native:apple';
export async function beginNativeApple(db: DbClient, clientChallenge: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(clientChallenge)) throw new HttpUnauthorizedError();
  const values = createOauthAttempt();
  await createAuthRepository(db).createAttempt({
    clientChallenge,
    stateHash: hashOauthValue(values.state),
    nonce: values.nonce,
    codeVerifier: values.codeVerifier,
    provider: 'apple',
    destination: DESTINATION,
    expiresAt: new Date(Date.now() + 10 * 60_000)
  });
  return { state: values.state, nonce: values.nonce };
}
export async function exchangeNativeApple(
  db: DbClient,
  input: { state: string; authorizationCode: string; codeVerifier: string; profile?: string; deviceName?: string },
  client: OauthProviderClient,
  secret: string
): Promise<AuthSessionResponse> {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(input.codeVerifier)) throw new HttpUnauthorizedError();
  const attempt = await db.transaction(async (tx) => {
    const row = await createAuthRepository(tx).consumeAttempt({ provider: 'apple', stateHash: hashOauthValue(input.state) });
    if (!row || row.destination !== DESTINATION || row.clientChallenge !== hashOauthValue(input.codeVerifier))
      throw new HttpUnauthorizedError();
    return row;
  });
  // Provider code exchange is deliberately outside the account/row locks.
  const identity = await client.verifyAuthorizationCode({
    code: input.authorizationCode,
    codeVerifier: attempt.codeVerifier,
    nonce: attempt.nonce,
    profile: input.profile
  });
  return db.transaction(async (tx) => {
    await lockAccountReferences(tx, 'write');
    if (!identity.appleCredentialId) throw new HttpUnauthorizedError();
    await claimAppleActivation(tx, identity.appleCredentialId);
    const repo = createAuthRepository(tx),
      user = await repo.resolveUser({ provider: 'apple', identity });
    const session = await repo.issueSession(user.id, input.deviceName);
    await activateAppleCredential(tx, identity.appleCredentialId, user.id);
    return {
      accessToken: issueAccessToken({ familyId: session.familyId, secret, userId: user.id }),
      refreshToken: session.refreshToken,
      expiresIn: 900,
      user
    };
  });
}
