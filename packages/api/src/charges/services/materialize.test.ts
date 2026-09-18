import { HttpNotFoundError } from '@ez4/gateway';
import { PaymentProvider, PixKeyType } from '@receivy/common';
import { describe, expect, it, vi } from 'vitest';
import type { DbClient } from '../../database';
import { paymentSnapshot } from './materialize';

function dbWith(rows: { id: string; contact_id?: string; is_default: boolean; pix_key: string }[]): DbClient {
  const match = (where: Record<string, unknown>) =>
    rows.filter((row) => {
      if (where.id && where.id !== row.id) {
        return false;
      }

      const scope = where.contact_id as string | { isNull: true } | undefined;

      if (scope && typeof scope === 'object') {
        return row.contact_id === undefined;
      }
      if (typeof scope === 'string') {
        return row.contact_id === scope;
      }

      return true;
    });

  return {
    payment_methods: {
      findOne: vi.fn(async ({ where }) => match(where)[0] && { provider: PaymentProvider.Pix, kind: PixKeyType.Email, value: match(where)[0]!.pix_key, label: 'Pix' }),
      findMany: vi.fn(async ({ where }) => ({
        records: match(where)
          .filter((row) => row.is_default)
          .map((row) => ({ provider: PaymentProvider.Pix, kind: PixKeyType.Email, value: row.pix_key, label: 'Pix' }))
      }))
    }
  } as unknown as DbClient;
}

describe('paymentSnapshot', () => {
  const owner = 'owner';
  const padaria = 'contact-padaria';
  const mercado = 'contact-mercado';
  const db = dbWith([
    { id: 'mine', is_default: true, pix_key: 'dona@example.com' },
    { id: 'theirs', contact_id: padaria, is_default: true, pix_key: 'padaria@example.com' },
    { id: 'others', contact_id: mercado, is_default: true, pix_key: 'mercado@example.com' }
  ]);

  it('falls back to the owner default when nobody receives on their behalf', async () => {
    expect((await paymentSnapshot(db, owner))?.value).toBe('dona@example.com');
  });

  it('falls back to the receiving contact default on a conta a pagar', async () => {
    expect((await paymentSnapshot(db, owner, undefined, padaria))?.value).toBe('padaria@example.com');
  });

  it('keeps an explicit method id above the default of the same scope', async () => {
    expect((await paymentSnapshot(db, owner, 'theirs', padaria))?.value).toBe('padaria@example.com');
    expect((await paymentSnapshot(db, owner, 'mine'))?.value).toBe('dona@example.com');
  });

  it('refuses an explicit contact key on a conta a receber', async () => {
    await expect(paymentSnapshot(db, owner, 'theirs')).rejects.toThrow(HttpNotFoundError);
  });

  // A conta a pagar keeps paying through whatever key it points at: the legacy pointers the bloco 9
  // backfill leaves out of scope on purpose are counted for the owner, never broken.
  it('takes any key of the owner on a conta a pagar', async () => {
    expect((await paymentSnapshot(db, owner, 'mine', padaria))?.value).toBe('dona@example.com');
    expect((await paymentSnapshot(db, owner, 'others', padaria))?.value).toBe('mercado@example.com');
  });
});
