import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { OauthProvider } from './oauth';

import { createOauthProviderClient, type OauthProviderVariables, oauthProviderConfigFrom, oauthProviderEnabled } from './oauth-provider';

describe('OAuth provider configuration', () => {
  it.each(['google', 'apple', 'nativeApple'] as const)('exchanges and verifies a signed %s fixture', async (mode) => {
    const provider = mode === 'google' ? OauthProvider.Google : OauthProvider.Apple,
      native = mode === 'nativeApple';
    const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const appleKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const header = encode({ alg: 'RS256', kid: 'fixture' });
    const now = Math.floor(Date.now() / 1000);
    const payload = encode({
      iss: provider === 'google' ? 'https://accounts.google.com' : 'https://appleid.apple.com',
      aud: native ? 'native-client' : 'client',
      sub: 'person',
      email: 'person@gmail.com',
      email_verified: provider === 'google' ? true : 'true',
      nonce: 'nonce',
      iat: now,
      exp: now + 300
    });
    const signature = sign('sha256', Buffer.from(`${header}.${payload}`), keys.privateKey).toString('base64url');
    let tokenBody: URLSearchParams | undefined;
    const request: typeof fetch = async (_url, init) => {
      if (init?.method === 'POST') {
        tokenBody = init.body as URLSearchParams;

        return Response.json({ id_token: `${header}.${payload}.${signature}`, refresh_token: 'refresh-fixture' });
      }

      return Response.json({ keys: [{ ...keys.publicKey.export({ format: 'jwk' }), kid: 'fixture', alg: 'RS256', use: 'sig' }] });
    };
    const client = createOauthProviderClient(
      provider,
      {
        google: { clientId: 'client', clientSecret: 'secret', callbackUri: 'https://api.example/google' },
        apple: {
          clientId: 'client',
          nativeClientId: 'native-client',
          callbackUri: 'https://api.example/apple',
          keyId: 'key',
          teamId: 'team',
          privateKeyBase64: Buffer.from(appleKey.privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64')
        }
      },
      request,
      native
    );
    const identity = await client!.verifyAuthorizationCode({
      code: 'authorization-code',
      codeVerifier: 'verifier',
      nonce: 'nonce',
      profile: JSON.stringify({ name: { firstName: 'Ana', lastName: 'Silva' } })
    });

    expect(identity).toMatchObject({ subject: 'person', email: 'person@gmail.com', emailAuthoritative: true });
    expect(tokenBody?.get('code')).toBe('authorization-code');
    expect(tokenBody?.get('code_verifier')).toBe(provider === 'google' ? 'verifier' : null);

    if (provider === 'apple') {
      // The provider refresh token is never retained anywhere in the identity.
      expect(JSON.stringify(identity)).not.toContain('refresh-fixture');
      expect(tokenBody?.get('redirect_uri')).toBe(native ? null : 'https://api.example/apple');
      expect(identity.name).toBe('Ana Silva');
      expect(tokenBody?.get('client_secret')?.split('.')).toHaveLength(3);
    }
  });
  it('enables the Apple client from configuration alone and keeps native gated on its own client id', () => {
    const key = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const apple = {
      clientId: 'client',
      callbackUri: 'https://api.example/apple',
      keyId: 'key',
      teamId: 'team',
      privateKeyBase64: Buffer.from(key.privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64')
    };
    const request = vi.fn<typeof fetch>();

    expect(createOauthProviderClient(OauthProvider.Apple, { apple }, request)).not.toBeNull();
    expect(createOauthProviderClient(OauthProvider.Apple, { apple }, request, true)).toBeNull();
    expect(createOauthProviderClient(OauthProvider.Apple, { apple: { ...apple, nativeClientId: 'native' } }, request, true)).not.toBeNull();
    expect(createOauthProviderClient(OauthProvider.Apple, { apple: { ...apple, privateKeyBase64: 'not-a-key' } }, request)).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });
});

describe('oauthProviderConfigFrom', () => {
  const unset: OauthProviderVariables = {
    PUBLIC_WEB_ORIGIN: 'https://receivy.example/',
    GOOGLE_SIGNIN_ENABLED: 'false',
    GOOGLE_CLIENT_ID: 'disabled',
    GOOGLE_CLIENT_SECRET: 'disabled',
    APPLE_SIGNIN_ENABLED: 'false',
    APPLE_CLIENT_ID: 'disabled',
    APPLE_NATIVE_CLIENT_ID: 'disabled',
    APPLE_TEAM_ID: 'disabled',
    APPLE_KEY_ID: 'disabled',
    APPLE_PRIVATE_KEY_B64: 'disabled'
  };
  const googleKeys = { GOOGLE_CLIENT_ID: 'google-client', GOOGLE_CLIENT_SECRET: 'google-secret' };
  const appleKeys = { APPLE_CLIENT_ID: 'services-id', APPLE_TEAM_ID: 'team', APPLE_KEY_ID: 'key', APPLE_PRIVATE_KEY_B64: 'p8-base64' };

  it('keeps every provider off by default', () => {
    expect(oauthProviderConfigFrom(unset)).toEqual({});
  });

  it('builds Google from its own keys with the callback on the web origin', () => {
    expect(oauthProviderConfigFrom({ ...unset, ...googleKeys, GOOGLE_SIGNIN_ENABLED: 'true' })).toEqual({
      google: { clientId: 'google-client', clientSecret: 'google-secret', callbackUri: 'https://receivy.example/api/auth/google/callback' }
    });
  });

  it('leaves a provider off when its flag is not true or any required key is missing', () => {
    expect(oauthProviderConfigFrom({ ...unset, ...googleKeys })).toEqual({});
    expect(oauthProviderConfigFrom({ ...unset, ...googleKeys, GOOGLE_SIGNIN_ENABLED: 'true', GOOGLE_CLIENT_SECRET: 'disabled' })).toEqual(
      {}
    );
    expect(oauthProviderConfigFrom({ ...unset, ...appleKeys, APPLE_SIGNIN_ENABLED: 'true', APPLE_KEY_ID: '' })).toEqual({});
  });

  it('switches Google and Apple independently, the native client id being optional', () => {
    const both = oauthProviderConfigFrom({
      ...unset,
      ...googleKeys,
      ...appleKeys,
      GOOGLE_SIGNIN_ENABLED: 'false',
      APPLE_SIGNIN_ENABLED: 'true'
    });

    expect(both.google).toBeUndefined();
    expect(both.apple).toEqual({
      clientId: 'services-id',
      teamId: 'team',
      keyId: 'key',
      privateKeyBase64: 'p8-base64',
      callbackUri: 'https://receivy.example/api/auth/apple/callback',
      nativeClientId: undefined
    });
    expect(
      oauthProviderConfigFrom({ ...unset, ...appleKeys, APPLE_SIGNIN_ENABLED: 'true', APPLE_NATIVE_CLIENT_ID: 'bundle' }).apple
        ?.nativeClientId
    ).toBe('bundle');
  });

  it('reads the flags as strict booleans with everything off by default', () => {
    expect(oauthProviderEnabled('true')).toBe(true);
    expect(oauthProviderEnabled(' TRUE ')).toBe(true);
    expect(oauthProviderEnabled('false')).toBe(false);
    expect(oauthProviderEnabled('1')).toBe(false);
    expect(oauthProviderEnabled(undefined)).toBe(false);
  });
});
