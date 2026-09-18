import type { Service } from '@ez4/common';
import { HttpUnauthorizedError } from '@ez4/gateway';
import { describe, expect, it, vi } from 'vitest';
import type { DbClient } from '../../database';
import { StaleSessionError } from '../errors';
import type { UserProvider } from '../provider';
import { SessionFlowError } from '../services/refresh-session';
import { refreshHandler } from './refresh';

vi.mock('../repositories/auth', () => ({
  AuthRepository: { create: () => ({}) }
}));

vi.mock('../services/refresh-session', async () => {
  const actual = await vi.importActual<typeof import('../services/refresh-session')>('../services/refresh-session');

  return { ...actual, refreshSession: vi.fn() };
});

const context = { db: {} as DbClient, variables: { AUTH_JWT_SECRET: 'jwt-secret', AUTH_ACCESS_TOKEN_TTL_SECONDS: '900' } } as Service.Context<UserProvider>;
const request = { body: { refreshToken: 'current-refresh-token' } };

describe('refreshHandler', () => {
  it('answers a token consumed moments ago with a retryable conflict', async () => {
    const { refreshSession } = await import('../services/refresh-session');

    vi.mocked(refreshSession).mockRejectedValue(new SessionFlowError('STALE_SESSION'));

    await expect(refreshHandler(request, context)).rejects.toBeInstanceOf(StaleSessionError);
  });

  it('answers an invalid session with unauthorized', async () => {
    const { refreshSession } = await import('../services/refresh-session');

    vi.mocked(refreshSession).mockRejectedValue(new SessionFlowError('INVALID_SESSION'));

    await expect(refreshHandler(request, context)).rejects.toBeInstanceOf(HttpUnauthorizedError);
  });
});
