import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { buildAuthorizationUrl, createOauthAttempt, isAllowedOauthRedirect, OauthProvider } from './oauth';

describe('OAuth authorization requests', () => {
  it('creates independent state, nonce and RFC 7636 PKCE values', () => {
    const randomBytes = vi
      .fn()
      .mockReturnValueOnce(Buffer.alloc(32, 1))
      .mockReturnValueOnce(Buffer.alloc(32, 2))
      .mockReturnValueOnce(Buffer.alloc(32, 3));

    const attempt = createOauthAttempt(randomBytes);

    expect(randomBytes).toHaveBeenCalledTimes(3);
    expect(attempt.state).toHaveLength(43);
    expect(attempt.nonce).toHaveLength(43);
    expect(attempt.codeVerifier).toHaveLength(43);
    expect(attempt.codeChallenge).toBe(createHash('sha256').update(attempt.codeVerifier).digest('base64url'));
    expect(new Set([attempt.state, attempt.nonce, attempt.codeVerifier]).size).toBe(3);
  });

  it('uses exact redirect allow-list matching', () => {
    const allowed = ['https://app.receivy.example/auth/callback', 'receivy://auth/callback'];

    expect(isAllowedOauthRedirect(allowed[0]!, allowed)).toBe(true);
    expect(isAllowedOauthRedirect('https://app.receivy.example.evil/auth/callback', allowed)).toBe(false);
    expect(isAllowedOauthRedirect('javascript:alert(1)', allowed)).toBe(false);
  });

  it('builds provider URLs with state, nonce and S256 PKCE', () => {
    const common = {
      clientId: 'client-id',
      codeChallenge: 'challenge',
      nonce: 'nonce',
      redirectUri: 'https://api.receivy.example/auth/google/callback',
      state: 'state'
    };
    const google = new URL(buildAuthorizationUrl(OauthProvider.Google, common));
    const apple = new URL(
      buildAuthorizationUrl(OauthProvider.Apple, {
        ...common,
        redirectUri: 'https://api.receivy.example/auth/apple/callback'
      })
    );

    expect(google.origin + google.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(google.searchParams.get('response_type')).toBe('code');
    expect(google.searchParams.get('code_challenge_method')).toBe('S256');
    expect(google.searchParams.get('scope')).toBe('openid email profile');
    expect(apple.origin + apple.pathname).toBe('https://appleid.apple.com/auth/authorize');
    expect(apple.searchParams.get('response_mode')).toBe('form_post');
    expect(apple.searchParams.get('scope')).toBe('name email');
  });
});
