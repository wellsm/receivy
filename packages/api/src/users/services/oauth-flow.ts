import { randomBytes } from 'node:crypto';
import type { AuthSessionResponse, AuthUser } from '@receivy/common';
import { createOauthAttempt, hashOauthValue, isAllowedOauthRedirect, type OauthProvider } from './oauth';
import type { OidcIdentity } from './oidc';
import { issueAccessToken } from './session';

const ATTEMPT_TTL_MS = 10 * 60 * 1000;
const GRANT_TTL_MS = 2 * 60 * 1000;
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

export type OauthAttemptValues = ReturnType<typeof createOauthAttempt>;
export type OauthGrantCommit = {
  identity: OidcIdentity;
  provider: OauthProvider;
  clientChallenge: string;
  grantHash: string;
  expiresAt: Date;
};

export interface OauthProviderClient {
  authorizationUrl(input: OauthAttemptValues): string;
  verifyAuthorizationCode(input: { code: string; codeVerifier: string; nonce: string; profile?: string }): Promise<OidcIdentity>;
}

export interface OauthFlowRepository {
  createAttempt(input: {
    clientChallenge: string;
    codeVerifier: string;
    destination: string;
    expiresAt: Date;
    nonce: string;
    provider: OauthProvider;
    stateHash: string;
  }): Promise<void>;
  consumeAttempt(input: { provider: OauthProvider; stateHash: string }): Promise<{
    clientChallenge: string;
    codeVerifier: string;
    destination: string;
    nonce: string;
  } | null>;
  resolveUser(input: { identity: OidcIdentity; provider: OauthProvider }): Promise<AuthUser>;
  createGrant(input: { clientChallenge: string; expiresAt: Date; grantHash: string; userId: string }): Promise<void>;
  consumeGrant(grantHash: string, clientChallenge: string): Promise<AuthUser | null>;
  issueSession(
    userId: string,
    deviceName?: string
  ): Promise<{
    familyId: string;
    refreshToken: string;
  }>;
}

export const enum ErrorCode {
  EmailLoginRequired = 'EMAIL_LOGIN_REQUIRED',
  InvalidGrant = 'INVALID_GRANT',
  InvalidRedirect = 'INVALID_REDIRECT',
  InvalidState = 'INVALID_STATE',
  ProviderDisabled = 'PROVIDER_DISABLED'
}

export class OauthFlowError extends Error {
  constructor(readonly code: ErrorCode) {
    super('OAuth request could not be completed');
    this.name = 'OauthFlowError';
  }
}

export async function beginOauth(
  input: { clientChallenge: string; destination: string; provider: OauthProvider },
  dependencies: {
    allowList: readonly string[];
    createValues?: () => OauthAttemptValues;
    now?: () => Date;
    providerClient: OauthProviderClient | null;
    repo: OauthFlowRepository;
  }
): Promise<{ authorizationUrl: string }> {
  if (!dependencies.providerClient) {
    throw new OauthFlowError(ErrorCode.ProviderDisabled);
  }
  if (input.destination.startsWith('native:') || !isAllowedOauthRedirect(input.destination, dependencies.allowList)) {
    throw new OauthFlowError(ErrorCode.InvalidRedirect);
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(input.clientChallenge)) {
    throw new OauthFlowError(ErrorCode.InvalidState);
  }

  const values = (dependencies.createValues ?? createOauthAttempt)();
  const now = (dependencies.now ?? (() => new Date()))();
  await dependencies.repo.createAttempt({
    clientChallenge: input.clientChallenge,
    provider: input.provider,
    destination: input.destination,
    stateHash: hashOauthValue(values.state),
    codeVerifier: values.codeVerifier,
    nonce: values.nonce,
    expiresAt: new Date(now.getTime() + ATTEMPT_TTL_MS)
  });

  return {
    authorizationUrl: dependencies.providerClient.authorizationUrl(values)
  };
}

export async function completeOauth(
  input: { code?: string; error?: string; profile?: string; provider: OauthProvider; state: string },
  dependencies: {
    generateGrant?: () => string;
    now?: () => Date;
    providerClient: OauthProviderClient;
    repo: OauthFlowRepository;
    commitGrant?: (input: OauthGrantCommit) => Promise<void>;
  }
): Promise<{ destination: string; grant: string | null }> {
  const attempt = await dependencies.repo.consumeAttempt({
    provider: input.provider,
    stateHash: hashOauthValue(input.state)
  });
  if (!attempt || attempt.destination.startsWith('native:')) {
    throw new OauthFlowError(ErrorCode.InvalidState);
  }

  const failure = { destination: attempt.destination, grant: null };
  if (!input.code || input.error) return failure;
  let identity: OidcIdentity;
  try {
    identity = await dependencies.providerClient.verifyAuthorizationCode({
      code: input.code,
      codeVerifier: attempt.codeVerifier,
      nonce: attempt.nonce,
      profile: input.profile
    });
  } catch {
    return failure;
  }
  const grant = (dependencies.generateGrant ?? (() => randomBytes(32).toString('base64url')))();
  const now = (dependencies.now ?? (() => new Date()))();
  if (dependencies.commitGrant) {
    try {
      await dependencies.commitGrant({
        identity,
        provider: input.provider,
        clientChallenge: attempt.clientChallenge,
        grantHash: hashOauthValue(grant),
        expiresAt: new Date(now.getTime() + GRANT_TTL_MS)
      });
    } catch (error) {
      if (error instanceof OauthFlowError) return failure;
      throw error;
    }
    return { destination: attempt.destination, grant };
  }
  let user: AuthUser;
  try {
    user = await dependencies.repo.resolveUser({ provider: input.provider, identity });
  } catch (error) {
    if (error instanceof OauthFlowError) return failure;
    throw error;
  }
  await dependencies.repo.createGrant({
    clientChallenge: attempt.clientChallenge,
    grantHash: hashOauthValue(grant),
    userId: user.id,
    expiresAt: new Date(now.getTime() + GRANT_TTL_MS)
  });

  return { destination: attempt.destination, grant };
}

export async function exchangeOauthGrant(
  input: { code: string; codeVerifier: string; deviceName?: string },
  dependencies: {
    accessTokenSecret: string;
    repo: OauthFlowRepository;
  }
): Promise<AuthSessionResponse> {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(input.codeVerifier)) {
    throw new OauthFlowError(ErrorCode.InvalidGrant);
  }
  const user = await dependencies.repo.consumeGrant(hashOauthValue(input.code), hashOauthValue(input.codeVerifier));
  if (!user) {
    throw new OauthFlowError(ErrorCode.InvalidGrant);
  }

  const session = await dependencies.repo.issueSession(user.id, input.deviceName);
  return {
    accessToken: issueAccessToken({
      familyId: session.familyId,
      secret: dependencies.accessTokenSecret,
      userId: user.id
    }),
    refreshToken: session.refreshToken,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    user
  };
}
