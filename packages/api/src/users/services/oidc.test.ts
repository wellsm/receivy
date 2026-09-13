import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { SupportedAlgorithm, verifyOidcIdToken } from './oidc';

const nowSeconds = 1_788_545_600;

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function createFixture(overrides: Record<string, unknown> = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const header = encode({ alg: 'RS256', kid: 'fixture-key', typ: 'JWT' });
  const payload = encode({
    aud: 'google-client',
    email: 'Person@Example.COM',
    email_verified: true,
    exp: nowSeconds + 300,
    iat: nowSeconds - 10,
    iss: 'https://accounts.google.com',
    name: 'Person',
    nonce: 'expected-nonce',
    picture: 'https://example.com/avatar.png',
    sub: 'provider-user-id',
    ...overrides
  });
  const signature = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey);
  const jwk = publicKey.export({ format: 'jwk' });

  return {
    jwks: { keys: [{ ...jwk, alg: 'RS256', kid: 'fixture-key', use: 'sig' }] },
    token: `${header}.${payload}.${signature.toString('base64url')}`
  };
}

describe('OIDC identity-token verification', () => {
  it('verifies signature and every identity-bound claim', () => {
    const fixture = createFixture();

    expect(
      verifyOidcIdToken({
        algorithms: [SupportedAlgorithm.Rs256],
        audience: 'google-client',
        issuers: ['accounts.google.com', 'https://accounts.google.com'],
        jwks: fixture.jwks,
        nonce: 'expected-nonce',
        nowSeconds,
        token: fixture.token
      })
    ).toEqual({
      email: 'person@example.com',
      emailAuthoritative: false,
      name: 'Person',
      picture: 'https://example.com/avatar.png',
      subject: 'provider-user-id'
    });
  });

  it.each([
    ['wrong audience', { aud: 'attacker-client' }],
    ['wrong issuer', { iss: 'https://attacker.example' }],
    ['expired token', { exp: nowSeconds }],
    ['wrong nonce', { nonce: 'attacker-nonce' }],
    ['unverified email', { email_verified: false }],
    ['multiple audiences without authorized party', { aud: ['google-client', 'other'] }],
    ['wrong authorized party', { azp: 'other' }],
    ['future validity', { nbf: nowSeconds + 120 }],
    ['invalid email', { email: 'not-an-email' }]
  ])('rejects %s', (_label, overrides) => {
    const fixture = createFixture(overrides);

    expect(() =>
      verifyOidcIdToken({
        algorithms: [SupportedAlgorithm.Rs256],
        audience: 'google-client',
        issuers: ['https://accounts.google.com'],
        jwks: fixture.jwks,
        nonce: 'expected-nonce',
        nowSeconds,
        token: fixture.token
      })
    ).toThrow('Invalid identity token');
  });

  it('rejects a token signed by a key that is not in the provider JWKS', () => {
    const fixture = createFixture();
    const other = createFixture();

    expect(() =>
      verifyOidcIdToken({
        algorithms: [SupportedAlgorithm.Rs256],
        audience: 'google-client',
        issuers: ['https://accounts.google.com'],
        jwks: other.jwks,
        nonce: 'expected-nonce',
        nowSeconds,
        token: fixture.token
      })
    ).toThrow('Invalid identity token');
  });
});
