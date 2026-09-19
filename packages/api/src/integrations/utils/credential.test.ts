import { PaymentProvider } from '@receivy/common';
import { describe, expect, it, vi } from 'vitest';
import type { DbClient } from '../../database';
import { seal } from '../../common/services/secret-box';
import { IntegrationCredentialKind } from '../schemas/integration';
import { credentialOf } from './credential';

const key = Buffer.alloc(32, 7).toString('base64');
const other = Buffer.alloc(32, 9).toString('base64');

function dbWith(integration: Record<string, unknown> | null) {
  return { integrations: { findOne: vi.fn(async () => integration) } } as unknown as DbClient;
}

describe('credentialOf', () => {
  it('decrypts the secret of a live integration', async () => {
    const db = dbWith({ id: 'i1', owner_id: 'o1', provider: PaymentProvider.PagSeguro, credentials: { kind: IntegrationCredentialKind.Token, ciphertext: seal('tok_123', key) }, label: 'PagBank', created_at: 'x', updated_at: 'x' });

    expect(await credentialOf(db, key, 'i1')).toEqual({ status: 'ok', secret: 'tok_123' });
  });

  it('reports missing when there is no such integration', async () => {
    const db = dbWith(null);

    expect(await credentialOf(db, key, 'i1')).toEqual({ status: 'missing' });
  });

  it('reports revoked when the integration was revoked', async () => {
    const db = dbWith({
      id: 'i1',
      owner_id: 'o1',
      provider: PaymentProvider.PagSeguro,
      credentials: { kind: IntegrationCredentialKind.Token, ciphertext: seal('tok_123', key) },
      label: 'PagBank',
      revoked_at: '2026-01-01T00:00:00.000Z',
      created_at: 'x',
      updated_at: 'x'
    });

    expect(await credentialOf(db, key, 'i1')).toEqual({ status: 'revoked' });
  });

  it('reports unreadable when the key cannot decrypt the ciphertext', async () => {
    const db = dbWith({ id: 'i1', owner_id: 'o1', provider: PaymentProvider.PagSeguro, credentials: { kind: IntegrationCredentialKind.Token, ciphertext: seal('tok_123', key) }, label: 'PagBank', created_at: 'x', updated_at: 'x' });

    expect(await credentialOf(db, other, 'i1')).toEqual({ status: 'unreadable' });
  });
});
