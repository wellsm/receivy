import { createHash, randomBytes as nodeRandomBytes } from 'node:crypto';

export const enum OauthProvider {
  Apple = 'apple',
  Google = 'google'
}

type RandomBytes = (size: number) => Buffer;

type AuthorizationUrlInput = {
  clientId: string;
  codeChallenge: string;
  nonce: string;
  redirectUri: string;
  state: string;
};

export function createOauthAttempt(randomBytes: RandomBytes = nodeRandomBytes): {
  codeChallenge: string;
  codeVerifier: string;
  nonce: string;
  state: string;
} {
  const state = randomBytes(32).toString('base64url');
  const nonce = randomBytes(32).toString('base64url');
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

  return { codeChallenge, codeVerifier, nonce, state };
}

export function hashOauthValue(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

export function isAllowedOauthRedirect(redirectUri: string, allowList: readonly string[]): boolean {
  return allowList.includes(redirectUri);
}

export function buildAuthorizationUrl(provider: OauthProvider, input: AuthorizationUrlInput): string {
  const url = new URL(
    provider === OauthProvider.Google ? 'https://accounts.google.com/o/oauth2/v2/auth' : 'https://appleid.apple.com/auth/authorize'
  );

  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', input.state);
  url.searchParams.set('nonce', input.nonce);

  if (provider === OauthProvider.Google) {
    url.searchParams.set('code_challenge', input.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('scope', 'openid email profile');
  } else {
    url.searchParams.set('scope', 'name email');
    url.searchParams.set('response_mode', 'form_post');
  }

  return url.toString();
}
