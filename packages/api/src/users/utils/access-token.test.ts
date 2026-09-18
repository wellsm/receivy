import { describe, expect, it } from 'vitest';
import { accessTokenConfig } from './access-token';

const AUTH_JWT_SECRET = 'test-only-jwt-secret-with-at-least-32-bytes';

describe('access token config', () => {
  it('reads the secret and the lifetime in seconds from the variables', () => {
    expect(accessTokenConfig({ AUTH_JWT_SECRET, AUTH_ACCESS_TOKEN_TTL_SECONDS: '604800' })).toEqual({
      accessTokenSecret: AUTH_JWT_SECRET,
      accessTokenTtlSeconds: 604_800
    });
  });

  it('refuses a lifetime that is not a positive whole number of seconds', () => {
    for (const value of ['', 'abc', '0', '-900', '1.5']) {
      expect(() => accessTokenConfig({ AUTH_JWT_SECRET, AUTH_ACCESS_TOKEN_TTL_SECONDS: value })).toThrow(/AUTH_ACCESS_TOKEN_TTL_SECONDS/);
    }
  });
});
