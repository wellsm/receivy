import { describe, expect, it, vi } from 'vitest';
import { refreshSession, revokeSession, SessionFlowError, type SessionRepository } from './refresh-session';

function repository(overrides: Partial<SessionRepository> = {}): SessionRepository {
  return {
    rotateRefreshToken: vi.fn().mockResolvedValue({
      kind: 'rotated',
      userId: '00000000-0000-4000-8000-000000000001',
      familyId: '00000000-0000-4000-8000-000000000002',
      refreshToken: 'next-refresh-token'
    }),
    revokeFamilyByRefreshToken: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

describe('refresh session', () => {
  it('rotates refresh tokens within the same family', async () => {
    const repo = repository();

    const result = await refreshSession({ refreshToken: 'current-refresh-token' }, { accessTokenSecret: 'jwt-secret', repo });

    expect(repo.rotateRefreshToken).toHaveBeenCalledWith('current-refresh-token');
    expect(result.refreshToken).toBe('next-refresh-token');
    expect(result.expiresIn).toBe(900);
  });

  it('returns the same generic unauthorized result for missing, expired and replayed tokens', async () => {
    for (const kind of ['invalid', 'expired', 'replayed'] as const) {
      const repo = repository({
        rotateRefreshToken: vi.fn().mockResolvedValue({ kind })
      });

      await expect(refreshSession({ refreshToken: 'unsafe' }, { accessTokenSecret: 'jwt-secret', repo })).rejects.toEqual(
        new SessionFlowError('INVALID_SESSION')
      );
    }
  });

  it('separates a token consumed moments ago from a real replay', async () => {
    const repo = repository({
      rotateRefreshToken: vi.fn().mockResolvedValue({ kind: 'stale' })
    });

    await expect(refreshSession({ refreshToken: 'lost-the-race' }, { accessTokenSecret: 'jwt-secret', repo })).rejects.toEqual(
      new SessionFlowError('STALE_SESSION')
    );
  });

  it('allows logout after access expiry and does not reveal unknown tokens', async () => {
    const repo = repository();

    await expect(revokeSession({ refreshToken: 'refresh-token' }, { repo })).resolves.toBeUndefined();
    expect(repo.revokeFamilyByRefreshToken).toHaveBeenCalledWith('refresh-token');
  });
});
