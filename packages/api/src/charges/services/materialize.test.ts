import { PixKeyType } from '@receivy/common';
import { describe, expect, it, vi } from 'vitest';
import type { DbClient } from '../../database';
import { pixSnapshot } from './materialize';

function dbWith(rows: { id: string; contact_id?: string; is_default: boolean; pix_key: string }[]): DbClient {
  const match = (where: Record<string, unknown>) =>
    rows.filter((row) => {
      if (where.id && where.id !== row.id) return false;
      const scope = where.contact_id as string | { isNull: true } | undefined;
      if (scope && typeof scope === 'object') return row.contact_id === undefined;
      if (typeof scope === 'string') return row.contact_id === scope;
      return true;
    });
  return {
    payment_methods: {
      findOne: vi.fn(async ({ where }) => match(where)[0] && { pix_key_type: PixKeyType.Email, pix_key: match(where)[0]!.pix_key, label: 'Pix' }),
      findMany: vi.fn(async ({ where }) => ({ records: match(where).filter((row) => row.is_default).map((row) => ({ pix_key_type: PixKeyType.Email, pix_key: row.pix_key, label: 'Pix' })) }))
    }
  } as unknown as DbClient;
}

describe('pixSnapshot', () => {
  const owner = 'owner';
  const padaria = 'contact-padaria';
  const db = dbWith([
    { id: 'mine', is_default: true, pix_key: 'dona@example.com' },
    { id: 'theirs', contact_id: padaria, is_default: true, pix_key: 'padaria@example.com' }
  ]);

  it('falls back to the owner default when nobody receives on their behalf', async () => {
    expect((await pixSnapshot(db, owner))?.key).toBe('dona@example.com');
  });

  it('falls back to the receiving contact default on a conta a pagar', async () => {
    expect((await pixSnapshot(db, owner, undefined, padaria))?.key).toBe('padaria@example.com');
  });

  it('keeps an explicit method id above every default', async () => {
    expect((await pixSnapshot(db, owner, 'theirs'))?.key).toBe('padaria@example.com');
  });
});
