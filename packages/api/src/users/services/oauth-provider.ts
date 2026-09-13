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

function hasStrings<T extends readonly string[]>(value: unknown, keys: T): value is JsonObject & Record<T[number], string> {
  return isRecord(value) && keys.every((key) => typeof value[key] === 'string' && value[key] !== '');
}

export function decodeOauthProviderConfig(encoded: string): OauthProviderConfig {
  if (!encoded || encoded === 'disabled') {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!isRecord(parsed)) {
      return {};
    }

    return {
      ...(hasStrings(parsed.google, ['callbackUri', 'clientId', 'clientSecret'] as const) ? { google: parsed.google } : {}),
      ...(hasStrings(parsed.apple, ['callbackUri', 'clientId', 'keyId', 'privateKeyBase64', 'teamId'] as const)
        ? {
            apple: {
              ...parsed.apple,
              nativeClientId:
                typeof parsed.apple.nativeClientId === 'string' && parsed.apple.nativeClientId.length <= 320
                  ? parsed.apple.nativeClientId
                  : undefined
            }
          }
        : {})
    };
  } catch {
    return {};
  }
}

export function appleConfigurationAvailable(config: AppleConfig | undefined): boolean {
  if (!config) return false;
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

export type OauthProviderToggles = { google: boolean; apple: boolean };

/** Reads an `OAUTH_<PROVIDER>_ENABLED` flag; anything but `true` keeps the provider off. */
export function oauthProviderEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true';
}

/** Drops providers that are configured but switched off, so every caller sees them as unavailable. */
export function enabledOauthProviders(config: OauthProviderConfig, toggles: OauthProviderToggles): OauthProviderConfig {
  return {
    ...(toggles.google && config.google ? { google: config.google } : {}),
    ...(toggles.apple && config.apple ? { apple: config.apple } : {})
  };
}

export function oauthProviderConfigFrom(variables: {
  OAUTH_PROVIDERS_CONFIG_B64: string;
  OAUTH_GOOGLE_ENABLED: string;
  OAUTH_APPLE_ENABLED: string;
}): OauthProviderConfig {
  return enabledOauthProviders(decodeOauthProviderConfig(variables.OAUTH_PROVIDERS_CONFIG_B64), {
    google: oauthProviderEnabled(variables.OAUTH_GOOGLE_ENABLED),
    apple: oauthProviderEnabled(variables.OAUTH_APPLE_ENABLED)
  });
}
