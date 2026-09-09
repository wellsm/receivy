import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { createOauthProviderClient, decodeOauthProviderConfig } from './oauth-provider';

describe('OAuth provider configuration', () => {
  it.each(['google', 'apple', 'nativeApple'] as const)('exchanges and verifies a signed %s fixture', async (mode) => {
    const provider = mode === 'google' ? 'google' : 'apple',
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
    expect(createOauthProviderClient('apple', { apple }, request)).not.toBeNull();
    expect(createOauthProviderClient('apple', { apple }, request, true)).toBeNull();
    expect(createOauthProviderClient('apple', { apple: { ...apple, nativeClientId: 'native' } }, request, true)).not.toBeNull();
    expect(createOauthProviderClient('apple', { apple: { ...apple, privateKeyBase64: 'not-a-key' } }, request)).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });
  it('keeps all providers disabled when credentials are absent', () => {
    expect(decodeOauthProviderConfig('disabled')).toEqual({});
    expect(decodeOauthProviderConfig('')).toEqual({});
  });

  it('accepts a base64url configuration only when required fields are present', () => {
    const encoded = Buffer.from(
      JSON.stringify({
        google: {
          callbackUri: 'https://api.receivy.example/auth/google/callback',
          clientId: 'google-client',
          clientSecret: 'google-secret'
        }
      })
    ).toString('base64url');

    expect(decodeOauthProviderConfig(encoded)).toEqual({
      google: {
        callbackUri: 'https://api.receivy.example/auth/google/callback',
        clientId: 'google-client',
        clientSecret: 'google-secret'
      }
    });
    expect(decodeOauthProviderConfig(Buffer.from('{}').toString('base64url'))).toEqual({});
    expect(decodeOauthProviderConfig('not-base64-json')).toEqual({});
  });
});
