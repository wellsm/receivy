import type { AuthUser } from '@receivy/common';
import { describe, expect, it, vi } from 'vitest';
import { hashOauthValue } from './oauth';
import { beginOauth, completeOauth, exchangeOauthGrant, OauthFlowError, type OauthFlowRepository } from './oauth-flow';

const user: AuthUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'person@example.com',
  name: 'Person',
  phone: null,
  avatarUrl: null,
  status: 'active',
  locale: 'pt-BR',
  timezone: 'America/Sao_Paulo',
  country: 'BR',
  currency: 'BRL'
};

function createRepo(): OauthFlowRepository {
  return {
    consumeAttempt: vi.fn(),
    consumeGrant: vi.fn(),
    createAttempt: vi.fn(),
    createGrant: vi.fn(),
    issueSession: vi.fn(),
    resolveUser: vi.fn()
  };
}

describe('OAuth flow', () => {
  it('rejects a consumed or unknown state before contacting the provider', async () => {
    const repo = createRepo();
    vi.mocked(repo.consumeAttempt).mockResolvedValue(null);
    const providerClient = { authorizationUrl: vi.fn(), verifyAuthorizationCode: vi.fn() };
    await expect(
      completeOauth(
        { code: 'provider-code', provider: 'google', state: 'replayed' },
        {
          providerClient,
          repo
        }
      )
    ).rejects.toEqual(new OauthFlowError('INVALID_STATE'));
    expect(providerClient.verifyAuthorizationCode).not.toHaveBeenCalled();
    expect(repo.createGrant).not.toHaveBeenCalled();
  });

  it('returns cancellation only to the destination of a consumed valid state', async () => {
    const repo = createRepo();
    vi.mocked(repo.consumeAttempt).mockResolvedValue({
      codeVerifier: 'v',
      clientChallenge: 'c',
      nonce: 'n',
      destination: 'receivy://auth/callback'
    });
    const providerClient = { authorizationUrl: vi.fn(), verifyAuthorizationCode: vi.fn() };
    expect(
      await completeOauth(
        { error: 'access_denied', provider: 'apple', state: 'valid' },
        {
          providerClient,
          repo
        }
      )
    ).toEqual({ destination: 'receivy://auth/callback', grant: null });
    expect(providerClient.verifyAuthorizationCode).not.toHaveBeenCalled();
  });
  it('refuses a disabled provider without creating state', async () => {
    const repo = createRepo();

    await expect(
      beginOauth(
        {
          clientChallenge: 'a'.repeat(43),
          destination: 'https://app.receivy.example/auth/callback',
          provider: 'google'
        },
        {
          allowList: ['https://app.receivy.example/auth/callback'],
          providerClient: null,
          repo
        }
      )
    ).rejects.toEqual(new OauthFlowError('PROVIDER_DISABLED'));
    expect(repo.createAttempt).not.toHaveBeenCalled();
  });

  it('persists only a hash of opaque state and returns a provider URL', async () => {
    const repo = createRepo();
    const createValues = vi.fn().mockReturnValue({
      codeChallenge: 'challenge',
      codeVerifier: 'verifier',
      nonce: 'nonce',
      state: 'state'
    });
    const providerClient = {
      authorizationUrl: vi.fn().mockReturnValue('https://accounts.example/authorize'),
      verifyAuthorizationCode: vi.fn()
    };

    await expect(
      beginOauth(
        {
          clientChallenge: 'a'.repeat(43),
          destination: 'https://app.receivy.example/auth/callback',
          provider: 'google'
        },
        {
          allowList: ['https://app.receivy.example/auth/callback'],
          createValues,
          now: () => new Date('2026-09-04T12:00:00.000Z'),
          providerClient,
          repo
        }
      )
    ).resolves.toEqual({ authorizationUrl: 'https://accounts.example/authorize' });
    expect(repo.createAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        codeVerifier: 'verifier',
        nonce: 'nonce',
        stateHash: expect.not.stringContaining('state')
      })
    );
  });

  it('returns only a short one-time Receivy grant after provider verification', async () => {
    const repo = createRepo();
    vi.mocked(repo.consumeAttempt).mockResolvedValue({
      clientChallenge: 'a'.repeat(43),
      codeVerifier: 'verifier',
      destination: 'receivy://auth/callback',
      nonce: 'nonce'
    });
    vi.mocked(repo.resolveUser).mockResolvedValue(user);
    const providerClient = {
      authorizationUrl: vi.fn(),
      verifyAuthorizationCode: vi.fn().mockResolvedValue({
        email: user.email,
        name: user.name ?? undefined,
        subject: 'provider-id'
      })
    };

    const result = await completeOauth(
      { code: 'provider-code', provider: 'google', state: 'state' },
      {
        generateGrant: () => 'receivy-grant',
        providerClient,
        repo
      }
    );

    expect(result).toEqual({ destination: 'receivy://auth/callback', grant: 'receivy-grant' });
    expect(repo.createGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        grantHash: expect.not.stringContaining('receivy-grant'),
        userId: user.id
      })
    );
  });

  it('exchanges a grant once and issues the normal Receivy session', async () => {
    const repo = createRepo();
    vi.mocked(repo.consumeGrant).mockResolvedValue(user);
    vi.mocked(repo.issueSession).mockResolvedValue({
      familyId: '22222222-2222-4222-8222-222222222222',
      refreshToken: 'refresh-token'
    });

    const session = await exchangeOauthGrant(
      { code: 'receivy-grant', codeVerifier: 'v'.repeat(43), deviceName: 'iPhone' },
      {
        accessTokenSecret: 'test-only-secret-at-least-32-characters',
        repo
      }
    );

    expect(session.user).toEqual(user);
    expect(repo.consumeGrant).toHaveBeenCalledWith(hashOauthValue('receivy-grant'), hashOauthValue('v'.repeat(43)));
    expect(session.refreshToken).toBe('refresh-token');
    expect(session.accessToken.split('.')).toHaveLength(3);
    await expect(
      exchangeOauthGrant(
        { code: 'bad', codeVerifier: 'v'.repeat(43) },
        {
          accessTokenSecret: 'test-only-secret-at-least-32-characters',
          repo: { ...repo, consumeGrant: vi.fn().mockResolvedValue(null) }
        }
      )
    ).rejects.toEqual(new OauthFlowError('INVALID_GRANT'));
  });
});
