import { createHash } from 'node:crypto';
import { PaymentProvider, PixKeyType } from '@receivy/common';
import { describe, expect, it, vi } from 'vitest';
import { TooManyRequestsError } from '../../common/errors';
import type { DbClient } from '../../database';
import { IntegrationCredentialKind } from '../../integrations/schemas/integration';
import type { CheckoutClients } from '../../vendors/checkout/types';
import { PagSeguroTokenInvalidError, PaymentCredentialKeyMissingError } from '../errors';
import { archive, save } from './payment-method';

const KEY_B64 = Buffer.alloc(32, 7).toString('base64');
const OWNER_ID = 'owner-1';

type Row = Record<string, unknown>;

/** One payment method row and one integration row, tracked in-memory; `findOne` ignores `where` since each test keeps a single row. */
function createDb(existingMethod?: Row, existingIntegration?: Row, options: { siblingLive?: boolean; quotaAttempts?: number } = {}) {
  let methodRow: Row | null = existingMethod ? { ...existingMethod } : null;
  let integrationRow: Row | null = existingIntegration ? { ...existingIntegration } : null;
  const methodInserts: Row[] = [];
  const methodUpdates: Row[] = [];
  const integrationInserts: Row[] = [];
  const integrationUpdates: Row[] = [];

  const db = {
    transaction: async (fn: (tx: DbClient) => Promise<unknown>) => fn(db),
    rawQuery: vi.fn(async () => [{ attempts: options.quotaAttempts ?? 1 }]),
    users: { findOne: vi.fn(async () => ({ id: OWNER_ID })) },
    payment_methods: {
      findOne: vi.fn(async ({ select }: { select: Record<string, unknown> }) => {
        if (!methodRow) {
          return null;
        }

        if ('integration_id' in select && Object.keys(select).length === 1) {
          return { integration_id: methodRow['integration_id'] ?? null };
        }

        return methodRow;
      }),
      // `otherLiveByIntegration` is the only caller that filters by `integration_id`; every other `findMany` (`hasLive`) answers "no siblings".
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => ({
        records: 'integration_id' in where && options.siblingLive ? [{ id: 'sibling' }] : []
      })),
      insertOne: vi.fn(async ({ data }: { data: Row }) => {
        methodInserts.push(data);

        methodRow = {
          id: data['id'],
          contact_id: (data['contact'] as Row | undefined)?.['id'] ?? null,
          provider: data['provider'],
          kind: data['kind'] ?? null,
          value: data['value'],
          label: data['label'],
          integration_id: (data['integration'] as Row | undefined)?.['id'] ?? null,
          is_default: data['is_default'],
          archived_at: null,
          created_at: data['created_at']
        };

        return methodRow;
      }),
      updateOne: vi.fn(async ({ data }: { data: Row }) => {
        methodUpdates.push(data);

        if (methodRow) {
          Object.assign(methodRow, data);
        }

        return { id: methodRow?.['id'] };
      })
    },
    integrations: {
      findOne: vi.fn(async () => integrationRow),
      insertOne: vi.fn(async ({ data }: { data: Row }) => {
        integrationInserts.push(data);
        integrationRow = { ...data, owner_id: (data['owner'] as Row)['id'] };

        return integrationRow;
      }),
      updateOne: vi.fn(async ({ data }: { data: Row }) => {
        integrationUpdates.push(data);

        if (integrationRow) {
          Object.assign(integrationRow, data);
        }

        return { id: integrationRow?.['id'] };
      })
    }
  } as unknown as DbClient;

  return { db, methodInserts, methodUpdates, integrationInserts, integrationUpdates };
}

function clientsWith(verifyCredential: ReturnType<typeof vi.fn>): CheckoutClients {
  const client = { createLink: vi.fn(), checkPayment: vi.fn(), inactivate: vi.fn(), verifyCredential };

  return { [PaymentProvider.InfinitePay]: client, [PaymentProvider.PagSeguro]: client } as unknown as CheckoutClients;
}

describe('PaymentMethodService PagBank', () => {
  it('refuses to create a PagBank method without a token', async () => {
    const { db } = createDb();
    const verifyCredential = vi.fn();
    const clients = clientsWith(verifyCredential);
    const variables = { PAYMENT_CREDENTIAL_KEY_B64: KEY_B64 };

    await expect(save(db, clients, variables, OWNER_ID, { provider: PaymentProvider.PagSeguro, label: 'Loja' })).rejects.toThrow('Informe o token do PagBank.');
    expect(verifyCredential).not.toHaveBeenCalled();
  });

  it('treats a whitespace-only token as absent', async () => {
    const { db } = createDb();
    const verifyCredential = vi.fn();
    const clients = clientsWith(verifyCredential);
    const variables = { PAYMENT_CREDENTIAL_KEY_B64: KEY_B64 };

    await expect(save(db, clients, variables, OWNER_ID, { provider: PaymentProvider.PagSeguro, token: '   ', label: 'Loja' })).rejects.toThrow('Informe o token do PagBank.');
    expect(verifyCredential).not.toHaveBeenCalled();
  });

  it('refuses an invalid token with 422 and never writes', async () => {
    const { db, methodInserts, integrationInserts } = createDb();
    const verifyCredential = vi.fn(async () => ({ status: 'invalid' as const }));
    const clients = clientsWith(verifyCredential);
    const variables = { PAYMENT_CREDENTIAL_KEY_B64: KEY_B64 };

    await expect(save(db, clients, variables, OWNER_ID, { provider: PaymentProvider.PagSeguro, token: 'bad-token', label: 'Loja' })).rejects.toBeInstanceOf(PagSeguroTokenInvalidError);

    expect(methodInserts).toHaveLength(0);
    expect(integrationInserts).toHaveLength(0);
  });

  it('answers 503 when the credential key is not configured', async () => {
    const { db } = createDb();
    const verifyCredential = vi.fn();
    const clients = clientsWith(verifyCredential);
    const variables = { PAYMENT_CREDENTIAL_KEY_B64: 'disabled' };

    await expect(save(db, clients, variables, OWNER_ID, { provider: PaymentProvider.PagSeguro, token: 'tok', label: 'Loja' })).rejects.toBeInstanceOf(PaymentCredentialKeyMissingError);
    expect(verifyCredential).not.toHaveBeenCalled();
  });

  it('seals the token, upserts the integration and links the method', async () => {
    const { db, methodInserts, integrationInserts } = createDb();
    const verifyCredential = vi.fn(async () => ({ status: 'valid' as const }));
    const clients = clientsWith(verifyCredential);
    const variables = { PAYMENT_CREDENTIAL_KEY_B64: KEY_B64 };

    const method = await save(db, clients, variables, OWNER_ID, { provider: PaymentProvider.PagSeguro, token: 'real-secret-token', label: 'Minha Loja' });

    expect(verifyCredential).toHaveBeenCalledWith('real-secret-token');

    const quotaId = createHash('sha256').update(`pagseguro-verify:${OWNER_ID}`).digest('hex');

    expect(db.rawQuery).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ id: quotaId }));

    expect(integrationInserts).toHaveLength(1);

    const credentials = integrationInserts[0]?.['credentials'] as Row;

    expect(credentials['ciphertext']).toMatch(/^v1\./);
    expect(credentials['ciphertext']).not.toBe('real-secret-token');

    expect(methodInserts).toHaveLength(1);

    const integrationRef = methodInserts[0]?.['integration'] as Row;

    expect(integrationRef['id']).toBeTruthy();
    expect(method.provider).toBe(PaymentProvider.PagSeguro);
    expect(method.kind).toBeNull();
    expect(method.value).toBe('Minha Loja');
    expect(method.label).toBe('Minha Loja');
  });

  it('trims the token before verifying and sealing it', async () => {
    const { db } = createDb();
    const verifyCredential = vi.fn(async () => ({ status: 'valid' as const }));
    const clients = clientsWith(verifyCredential);
    const variables = { PAYMENT_CREDENTIAL_KEY_B64: KEY_B64 };

    await save(db, clients, variables, OWNER_ID, { provider: PaymentProvider.PagSeguro, token: '  real-secret-token\n', label: 'Minha Loja' });

    expect(verifyCredential).toHaveBeenCalledWith('real-secret-token');
  });

  it('keeps the stored credential when editing without a token', async () => {
    const existingMethod = {
      id: 'pm1',
      contact_id: null,
      provider: PaymentProvider.PagSeguro,
      kind: null,
      value: 'PagBank',
      label: 'PagBank',
      is_default: true,
      archived_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
      integration_id: 'int1'
    };
    const existingIntegration = {
      id: 'int1',
      owner_id: OWNER_ID,
      provider: PaymentProvider.PagSeguro,
      credentials: { kind: IntegrationCredentialKind.Token, ciphertext: 'v1.a.b.c' },
      label: 'PagBank',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z'
    };
    const { db, methodUpdates, integrationInserts, integrationUpdates } = createDb(existingMethod, existingIntegration);
    const verifyCredential = vi.fn();
    const clients = clientsWith(verifyCredential);
    const variables = { PAYMENT_CREDENTIAL_KEY_B64: KEY_B64 };

    const method = await save(db, clients, variables, OWNER_ID, { provider: PaymentProvider.PagSeguro, label: 'Nova Loja' }, 'pm1');

    expect(verifyCredential).not.toHaveBeenCalled();
    expect(integrationInserts).toHaveLength(0);
    expect(integrationUpdates).toHaveLength(0);
    expect(method.label).toBe('Nova Loja');
    expect(methodUpdates.at(-1)).toMatchObject({ label: 'Nova Loja', integration_id: 'int1' });
  });

  it('revokes the integration when the method is archived and no sibling shares it', async () => {
    const existingMethod = {
      id: 'pm1',
      contact_id: null,
      provider: PaymentProvider.PagSeguro,
      kind: null,
      value: 'PagBank',
      label: 'PagBank',
      is_default: false,
      archived_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
      integration_id: 'int1'
    };
    const { db, integrationUpdates } = createDb(existingMethod, { id: 'int1' });

    await archive(db, OWNER_ID, 'pm1');

    expect(integrationUpdates).toHaveLength(1);
    expect(integrationUpdates[0]).toMatchObject({ revoked_at: expect.any(String) });
  });

  it('enforces the PagBank verify quota at 10 attempts per owner', async () => {
    const allowed = createDb(undefined, undefined, { quotaAttempts: 10 });
    const verifyCredential = vi.fn(async () => ({ status: 'valid' as const }));
    const variables = { PAYMENT_CREDENTIAL_KEY_B64: KEY_B64 };

    await expect(save(allowed.db, clientsWith(verifyCredential), variables, OWNER_ID, { provider: PaymentProvider.PagSeguro, token: 'tok', label: 'Loja' })).resolves.toBeDefined();

    const blocked = createDb(undefined, undefined, { quotaAttempts: 11 });

    await expect(save(blocked.db, clientsWith(vi.fn()), variables, OWNER_ID, { provider: PaymentProvider.PagSeguro, token: 'tok', label: 'Loja' })).rejects.toBeInstanceOf(TooManyRequestsError);
  });

  it('refuses to flip a Pix method into PagBank without a token', async () => {
    const existingMethod = {
      id: 'pm1',
      contact_id: null,
      provider: PaymentProvider.Pix,
      kind: 'email',
      value: 'ana@example.com',
      label: 'Pix',
      is_default: true,
      archived_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
      integration_id: null
    };
    const { db } = createDb(existingMethod);
    const verifyCredential = vi.fn();
    const clients = clientsWith(verifyCredential);
    const variables = { PAYMENT_CREDENTIAL_KEY_B64: KEY_B64 };

    await expect(save(db, clients, variables, OWNER_ID, { provider: PaymentProvider.PagSeguro, label: 'Loja' }, 'pm1')).rejects.toThrow('Informe o token do PagBank.');
    expect(verifyCredential).not.toHaveBeenCalled();
  });

  it('clears and revokes the integration when a PagBank method flips to Pix with no sibling', async () => {
    const existingMethod = {
      id: 'pm1',
      contact_id: null,
      provider: PaymentProvider.PagSeguro,
      kind: null,
      value: 'PagBank',
      label: 'PagBank',
      is_default: true,
      archived_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
      integration_id: 'int1'
    };
    const { db, methodUpdates, integrationUpdates } = createDb(existingMethod, { id: 'int1' }, { siblingLive: false });
    const clients = clientsWith(vi.fn());
    const variables = { PAYMENT_CREDENTIAL_KEY_B64: KEY_B64 };

    const method = await save(db, clients, variables, OWNER_ID, { provider: PaymentProvider.Pix, kind: PixKeyType.Email, value: 'ana@example.com' }, 'pm1');

    expect(method.provider).toBe(PaymentProvider.Pix);
    expect(methodUpdates.at(-1)).toMatchObject({ integration_id: null });
    expect(integrationUpdates).toHaveLength(1);
    expect(integrationUpdates[0]).toMatchObject({ revoked_at: expect.any(String) });
  });

  it('clears but does not revoke the integration when a PagBank method flips to Pix and a sibling still uses it', async () => {
    const existingMethod = {
      id: 'pm1',
      contact_id: null,
      provider: PaymentProvider.PagSeguro,
      kind: null,
      value: 'PagBank',
      label: 'PagBank',
      is_default: true,
      archived_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
      integration_id: 'int1'
    };
    const { db, methodUpdates, integrationUpdates } = createDb(existingMethod, { id: 'int1' }, { siblingLive: true });
    const clients = clientsWith(vi.fn());
    const variables = { PAYMENT_CREDENTIAL_KEY_B64: KEY_B64 };

    await save(db, clients, variables, OWNER_ID, { provider: PaymentProvider.Pix, kind: PixKeyType.Email, value: 'ana@example.com' }, 'pm1');

    expect(methodUpdates.at(-1)).toMatchObject({ integration_id: null });
    expect(integrationUpdates).toHaveLength(0);
  });

  it('does not revoke the integration on archive when a sibling PagBank method still uses it', async () => {
    const existingMethod = {
      id: 'pm1',
      contact_id: null,
      provider: PaymentProvider.PagSeguro,
      kind: null,
      value: 'PagBank',
      label: 'PagBank',
      is_default: false,
      archived_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
      integration_id: 'int1'
    };
    const { db, integrationUpdates } = createDb(existingMethod, { id: 'int1' }, { siblingLive: true });

    await archive(db, OWNER_ID, 'pm1');

    expect(integrationUpdates).toHaveLength(0);
  });
});
