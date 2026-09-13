import type { Service } from '@ez4/common';
import { describe, expect, it, vi } from 'vitest';
import type { Client } from '@ez4/storage';
import type { DbClient } from '../../database';
import type { UserProvider } from '../provider';
import { googleCallbackHandler } from './google-callback';

vi.mock('../services/oauth-flow', async () => {
  const actual = await vi.importActual<typeof import('../services/oauth-flow')>(
    '../services/oauth-flow'
  );
  return {
    ...actual,
    completeOauth: vi.fn(async (input, dependencies) => {
      await dependencies.commitGrant({
        identity: { provider: 'google', id: 'u1', picture: 'https://lh3.test/p.jpg' },
        provider: input.provider,
        clientChallenge: 'challenge',
        grantHash: 'hash',
        expiresAt: new Date()
      });
      return { destination: 'https://app.test/', grant: 'g' };
    })
  };
});

vi.mock('../services/oauth-commit', () => ({
  commitOauthIdentity: vi.fn(async () => 'u1')
}));

vi.mock('../services/provider-picture', () => ({
  adoptProviderPicture: vi.fn(async () => true)
}));

vi.mock('../utils/oauth', () => ({
  oauthDependencies: () => ({ client: {} }),
  appendOauthGrant: (destination: string) => destination + '?grant=g'
}));

describe('googleCallbackHandler', () => {
  it('calls adoptProviderPicture with picture from the identity', async () => {
    const { adoptProviderPicture } = await import('../services/provider-picture');
    const db = { transaction: vi.fn() } as unknown as DbClient;
    const proofFiles = { write: vi.fn() } as unknown as Client;
    const context = {
      db,
      variables: { GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'cs' },
      proofFiles
    } as unknown as Service.Context<UserProvider>;
    const request = {
      query: { code: 'code', state: 'state' }
    } as unknown as Parameters<typeof googleCallbackHandler>[0];

    const response = await googleCallbackHandler(request, context);

    expect(response.status).toBe(302);
    expect(adoptProviderPicture).toHaveBeenCalledWith({
      db,
      bucket: proofFiles,
      userId: 'u1',
      picture: 'https://lh3.test/p.jpg'
    });
  });
});
