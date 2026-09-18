import type { Client } from '@ez4/storage';
import { describe, expect, it, vi } from 'vitest';
import { bucketProofStorage } from './bucket-storage';

describe('bucketProofStorage', () => {
  it('treats deleting an absent object as success', async () => {
    const existing = new Set(['proofs/a']);
    const bucket = {
      exists: vi.fn(async (key: string) => existing.has(key)),
      delete: vi.fn(async (key: string) => {
        existing.delete(key);
      })
    } as unknown as Client;
    const storage = bucketProofStorage(bucket);

    await storage.delete('proofs/a');
    await storage.delete('proofs/a');

    expect(bucket.delete).toHaveBeenCalledTimes(1);
  });
});
