import { createPrivateKey, sign } from 'node:crypto';
import { buildAuthorizationUrl, OauthProvider } from './oauth';
import type { OauthAttemptValues, OauthProviderClient } from './oauth-flow';
import { type OidcIdentity, SupportedAlgorithm, verifyOidcIdToken } from './oidc';

type GoogleConfig = {
  callbackUri: string;
  clientId: string;
  clientSecret: string;
};

export type AppleConfig = {
  callbackUri: string;
  clientId: string;
  keyId: string;
  privateKeyBase64: string;
  teamId: string;
  nativeClientId?: string;
};

export type OauthProviderConfig = {
  apple?: AppleConfig;
  google?: GoogleConfig;
};

type JsonObject = Record<string, unknown>;

function isRecord(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function appleConfigurationAvailable(config: AppleConfig | undefined): boolean {
  if (!config) {
    return false;
  }

  try {
    const key = createPrivateKey(Buffer.from(config.privateKeyBase64, 'base64').toString('utf8'));

    return key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1';
  } catch {
    return false;
  }
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function createAppleClientSecret(config: AppleConfig, nowSeconds: number): string {
  const header = encode({ alg: 'ES256', kid: config.keyId, typ: 'JWT' });
  const payload = encode({
    iss: config.teamId,
    iat: nowSeconds,
    exp: nowSeconds + 5 * 60,
    aud: 'https://appleid.apple.com',
    sub: config.clientId
  });
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`), {
    key: createPrivateKey(Buffer.from(config.privateKeyBase64, 'base64').toString('utf8')),
    dsaEncoding: 'ieee-p1363'
  });

  return `${header}.${payload}.${signature.toString('base64url')}`;
}

async function readJson(response: Response): Promise<JsonObject> {
  if (!response.ok) {
    throw new Error('OAuth provider request failed');
  }

  const value: unknown = await response.json();

  if (!isRecord(value)) {
    throw new Error('OAuth provider response is invalid');
  }

  return value;
}

function appleName(profile: string | undefined): string | undefined {
  if (!profile) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(profile);

    if (!isRecord(parsed) || !isRecord(parsed.name)) {
      return undefined;
    }

    const first = typeof parsed.name.firstName === 'string' ? parsed.name.firstName.trim() : '';
    const last = typeof parsed.name.lastName === 'string' ? parsed.name.lastName.trim() : '';

    return [first, last].filter(Boolean).join(' ').slice(0, 120) || undefined;
  } catch {
    return undefined;
  }
}

export function createOauthProviderClient(
  provider: OauthProvider,
  config: OauthProviderConfig,
  request: typeof fetch = fetch,
  native = false
): OauthProviderClient | null {
  const selected =
    native && provider === OauthProvider.Apple && config.apple?.nativeClientId
      ? { ...config.apple, clientId: config.apple.nativeClientId }
      : config[provider];

  if (!selected) {
    return null;
  }
  if (provider === OauthProvider.Apple && (!appleConfigurationAvailable(config.apple) || (native && !config.apple?.nativeClientId))) {
    return null;
  }

  return {
    authorizationUrl(values: OauthAttemptValues): string {
      return buildAuthorizationUrl(provider, {
        ...values,
        clientId: selected.clientId,
        redirectUri: selected.callbackUri
      });
    },

    async verifyAuthorizationCode(input): Promise<OidcIdentity> {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const tokenUrl = provider === OauthProvider.Google ? 'https://oauth2.googleapis.com/token' : 'https://appleid.apple.com/auth/token';
      const secret = 'clientSecret' in selected ? selected.clientSecret : createAppleClientSecret(selected, nowSeconds);
      const tokenResponse = await readJson(
        await request(tokenUrl, {
          signal: AbortSignal.timeout(10000),
          redirect: 'error',
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: selected.clientId,
            client_secret: secret,
            code: input.code,
            ...(provider === OauthProvider.Google ? { code_verifier: input.codeVerifier } : {}),
            grant_type: 'authorization_code',
            ...(!native ? { redirect_uri: selected.callbackUri } : {})
          })
        })
      );

      // Only the id_token is consumed; the provider refresh token is deliberately never stored.
      if (typeof tokenResponse.id_token !== 'string') {
        throw new Error('OAuth identity token is missing');
      }

      const jwksUrl =
        provider === OauthProvider.Google ? 'https://www.googleapis.com/oauth2/v3/certs' : 'https://appleid.apple.com/auth/keys';
      const jwks = await readJson(
        await request(jwksUrl, {
          signal: AbortSignal.timeout(10000),
          redirect: 'error'
        })
      );

      if (!Array.isArray(jwks.keys)) {
        throw new Error('OAuth provider keys are invalid');
      }

      const identity = verifyOidcIdToken({
        algorithms: provider === OauthProvider.Google ? [SupportedAlgorithm.Rs256] : [SupportedAlgorithm.Rs256, SupportedAlgorithm.Es256],
        audience: selected.clientId,
        issuers: provider === OauthProvider.Google ? ['accounts.google.com', 'https://accounts.google.com'] : ['https://appleid.apple.com'],
        jwks: { keys: jwks.keys },
        nonce: input.nonce,
        nowSeconds,
        token: tokenResponse.id_token
      });
      const profileName = provider === OauthProvider.Apple ? appleName(input.profile) : undefined;

      return {
        ...identity,
        ...(profileName && !identity.name ? { name: profileName } : {})
      };
    }
  };
}

export type OauthProviderVariables = {
  PUBLIC_WEB_ORIGIN: string;
  GOOGLE_SIGNIN_ENABLED: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  APPLE_SIGNIN_ENABLED: string;
  APPLE_CLIENT_ID: string;
  APPLE_NATIVE_CLIENT_ID: string;
  APPLE_TEAM_ID: string;
  APPLE_KEY_ID: string;
  APPLE_PRIVATE_KEY_B64: string;
};

/** Reads a `<PROVIDER>_SIGNIN_ENABLED` flag; anything but `true` keeps the provider off. */
export function oauthProviderEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true';
}

/** An unset key arrives as `disabled` (its EZ4 default); only a real value counts as configured. */
function credential(value: string | undefined): string | undefined {
  const trimmed = value?.trim();

  return trimmed && trimmed !== 'disabled' ? trimmed : undefined;
}

/** Providers never call the API directly: their callback lands on the web, which bridges it (docs/oauth-setup.md). */
function callbackUri(webOrigin: string, provider: OauthProvider): string {
  return `${webOrigin.trim().replace(/\/+$/, '')}/api/auth/${provider}/callback`;
}

function googleConfig(variables: OauthProviderVariables): GoogleConfig | undefined {
  const clientId = credential(variables.GOOGLE_CLIENT_ID);
  const clientSecret = credential(variables.GOOGLE_CLIENT_SECRET);

  if (!oauthProviderEnabled(variables.GOOGLE_SIGNIN_ENABLED) || !clientId || !clientSecret) {
    return undefined;
  }

  return { clientId, clientSecret, callbackUri: callbackUri(variables.PUBLIC_WEB_ORIGIN, OauthProvider.Google) };
}

function appleConfig(variables: OauthProviderVariables): AppleConfig | undefined {
  const clientId = credential(variables.APPLE_CLIENT_ID);
  const teamId = credential(variables.APPLE_TEAM_ID);
  const keyId = credential(variables.APPLE_KEY_ID);
  const privateKeyBase64 = credential(variables.APPLE_PRIVATE_KEY_B64);

  if (!oauthProviderEnabled(variables.APPLE_SIGNIN_ENABLED) || !clientId || !teamId || !keyId || !privateKeyBase64) {
    return undefined;
  }

  return {
    clientId,
    teamId,
    keyId,
    privateKeyBase64,
    callbackUri: callbackUri(variables.PUBLIC_WEB_ORIGIN, OauthProvider.Apple),
    nativeClientId: credential(variables.APPLE_NATIVE_CLIENT_ID)
  };
}

/** Each provider is on only when its flag is `true` and every required key is set; otherwise its button stays hidden. */
export function oauthProviderConfigFrom(variables: OauthProviderVariables): OauthProviderConfig {
  const google = googleConfig(variables);
  const apple = appleConfig(variables);

  return {
    ...(google ? { google } : {}),
    ...(apple ? { apple } : {})
  };
}
