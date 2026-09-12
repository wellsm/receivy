import { describe, expect, it } from 'vitest';
import { readBounded, validateProof } from './validation';

describe('proof bytes', () => {
  it('validates actual magic and SHA-256, not filename or claimed MIME', () => {
    const bytes = Buffer.from('%PDF-1.7\nproof');
    expect(validateProof(bytes, 'application/pdf').size).toBe(14);
    expect(validateProof(bytes, 'application/pdf').sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(() => validateProof(bytes, 'image/png')).toThrow();
    expect(() => validateProof(Buffer.from('<script>evil</script>'), 'application/pdf')).toThrow();
    expect(() => validateProof(Buffer.alloc(10 * 1024 * 1024 + 1), 'image/jpeg')).toThrow();
  });
  it('cancels oversized streams before buffering the entire object', async () => {
    let closed = false;
    async function* source() {
      try {
        yield Buffer.alloc(8);
        yield Buffer.alloc(8);
        throw new Error('must not read more');
      } finally {
        closed = true;
      }
    }
    await expect(readBounded(source(), 10)).rejects.toThrow('10 MB');
    expect(closed).toBe(true);
    expect(
      await readBounded(
        (async function* () {
          yield Buffer.from('abc');
        })()
      )
    ).toEqual(Buffer.from('abc'));
  });
});
