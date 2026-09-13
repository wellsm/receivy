import { type AuthUser, UserStatus } from '@receivy/common';
import { describe, expect, it, vi } from 'vitest';
import { AuthFlowError, type AuthRepository, confirmEmailCode, type EmailTransport, requestEmailCode } from './email-login';

const user: AuthUser = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'ana@example.com',
  name: null,
  phone: null,
  avatar: null,
  status: UserStatus.Active,
  locale: 'pt-BR',
  timezone: 'America/Sao_Paulo',
  country: 'BR',
  currency: 'BRL'
};

function repository(overrides: Partial<AuthRepository> = {}): AuthRepository {
  return {
    replaceLoginCode: vi.fn().mockResolvedValue({ accepted: true }),
    consumeLoginCode: vi.fn().mockResolvedValue({ kind: 'valid' }),
    findOrCreateUserByEmail: vi.fn().mockResolvedValue(user),
    issueSession: vi.fn().mockResolvedValue({
      familyId: '00000000-0000-4000-8000-000000000002',
      refreshToken: 'refresh-token'
    }),
    ...overrides
  };
}

describe('passwordless email login', () => {
  it('does not reveal delivery failure in the public code-request outcome', async () => {
    await expect(
      requestEmailCode(
        { email: 'undeliverable@example.com' },
        {
          codeHashKey: 'test-key',
          repo: repository(),
          transport: {
            sendLoginCode: async () => {
              throw new Error('undeliverable address');
            }
          }
        }
      )
    ).resolves.toBeUndefined();
  });
  it('normalizes the address, replaces older codes and delivers only accepted codes', async () => {
    const repo = repository();
    const transport: EmailTransport = { sendLoginCode: vi.fn().mockResolvedValue(undefined) };

    await requestEmailCode({ email: ' Ana@Example.COM ' }, { codeHashKey: 'hash-key', repo, transport, generateCode: () => '123456' });

    expect(repo.replaceLoginCode).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'ana@example.com',
        code: '123456',
        codeHashKey: 'hash-key'
      })
    );
    expect(transport.sendLoginCode).toHaveBeenCalledWith({
      email: 'ana@example.com',
      code: '123456'
    });
  });

  it('keeps the public response indistinguishable when cooldown rejects a request', async () => {
    const repo = repository({
      replaceLoginCode: vi.fn().mockResolvedValue({ accepted: false })
    });
    const transport: EmailTransport = { sendLoginCode: vi.fn() };

    await expect(
      requestEmailCode({ email: 'ana@example.com' }, { codeHashKey: 'hash-key', repo, transport, generateCode: () => '123456' })
    ).resolves.toBeUndefined();
    expect(transport.sendLoginCode).not.toHaveBeenCalled();
  });

  it('creates the user and one refresh family only after consuming the code', async () => {
    const repo = repository();

    const result = await confirmEmailCode(
      { email: 'ANA@example.com', code: '123456', deviceName: 'iPhone' },
      { accessTokenSecret: 'jwt-secret', codeHashKey: 'hash-key', repo }
    );

    expect(repo.consumeLoginCode).toHaveBeenCalledWith({
      email: 'ana@example.com',
      code: '123456',
      codeHashKey: 'hash-key'
    });
    expect(repo.findOrCreateUserByEmail).toHaveBeenCalledWith('ana@example.com');
    expect(repo.issueSession).toHaveBeenCalledWith(user.id, 'iPhone');
    expect(result.user).toEqual(user);
    expect(result.refreshToken).toBe('refresh-token');
    expect(result.expiresIn).toBe(900);
  });

  it('uses one generic error for invalid, expired and exhausted codes', async () => {
    for (const kind of ['invalid', 'expired', 'exhausted'] as const) {
      const repo = repository({
        consumeLoginCode: vi.fn().mockResolvedValue({ kind })
      });

      await expect(
        confirmEmailCode({ email: 'ana@example.com', code: '000000' }, { accessTokenSecret: 'jwt-secret', codeHashKey: 'hash-key', repo })
      ).rejects.toEqual(new AuthFlowError('INVALID_CODE'));
      expect(repo.findOrCreateUserByEmail).not.toHaveBeenCalled();
    }
  });
});
