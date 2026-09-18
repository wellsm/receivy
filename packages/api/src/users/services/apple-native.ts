import { HttpUnauthorizedError } from '@ez4/gateway';
import type { AuthSessionResponse } from '@receivy/common';
import type { DbClient } from '../../database';
import { authStore } from '../services/auth-store';
import { createOauthAttempt, hashOauthValue, OauthProvider } from './oauth';
import type { OauthProviderClient } from './oauth-flow';
import { DEFAULT_ACCESS_TOKEN_TTL_SECONDS, issueAccessToken } from './session';

const DESTINATION = 'native:apple';

export async function beginNativeApple(db: DbClient, clientChallenge: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(clientChallenge)) {
    throw new HttpUnauthorizedError();
  }

  const values = createOauthAttempt();

  await authStore(db).createAttempt({
    clientChallenge,
    stateHash: hashOauthValue(values.state),
    nonce: values.nonce,
    codeVerifier: values.codeVerifier,
    provider: OauthProvider.Apple,
    destination: DESTINATION,
    expiresAt: new Date(Date.now() + 10 * 60_000)
  });

  return { state: values.state, nonce: values.nonce };
}
export async function exchangeNativeApple(
  db: DbClient,
  input: { state: string; authorizationCode: string; codeVerifier: string; profile?: string; deviceName?: string },
  client: OauthProviderClient,
  secret: string,
  ttlSeconds = DEFAULT_ACCESS_TOKEN_TTL_SECONDS
): Promise<AuthSessionResponse> {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(input.codeVerifier)) {
    throw new HttpUnauthorizedError();
  }

  const attempt = await db.transaction(async (tx) => {
    const row = await authStore(tx).consumeAttempt({ provider: OauthProvider.Apple, stateHash: hashOauthValue(input.state) });

    if (!row || row.destination !== DESTINATION || row.clientChallenge !== hashOauthValue(input.codeVerifier)) {
      throw new HttpUnauthorizedError();
    }

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
    const repo = authStore(tx),
      user = await repo.resolveUser({ provider: OauthProvider.Apple, identity });
    const session = await repo.issueSession(user.id, input.deviceName);

    return {
      accessToken: issueAccessToken({ familyId: session.familyId, secret, ttlSeconds, userId: user.id }),
      refreshToken: session.refreshToken,
      expiresIn: ttlSeconds,
      user
    };
  });
}
