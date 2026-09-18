export type AccessTokenConfig = {
  accessTokenSecret: string;
  accessTokenTtlSeconds: number;
};

type AccessTokenVariables = {
  AUTH_JWT_SECRET: string;
  AUTH_ACCESS_TOKEN_TTL_SECONDS: string;
};

/** What every login flow signs access tokens with: the secret and the lifetime the stage configured. */
export function accessTokenConfig({ AUTH_JWT_SECRET, AUTH_ACCESS_TOKEN_TTL_SECONDS }: AccessTokenVariables): AccessTokenConfig {
  const accessTokenTtlSeconds = Number(AUTH_ACCESS_TOKEN_TTL_SECONDS);

  if (!AUTH_ACCESS_TOKEN_TTL_SECONDS || !Number.isInteger(accessTokenTtlSeconds) || accessTokenTtlSeconds <= 0) {
    throw new Error('AUTH_ACCESS_TOKEN_TTL_SECONDS must be a positive whole number of seconds.');
  }

  return { accessTokenSecret: AUTH_JWT_SECRET, accessTokenTtlSeconds };
}
