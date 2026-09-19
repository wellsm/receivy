import { describe, expect, it } from 'vitest';
import { assertCredentialKeyConfigured, open, seal } from './secret-box';

const key = Buffer.alloc(32, 7).toString('base64');
const other = Buffer.alloc(32, 9).toString('base64');

describe('secret-box', () => {
  it('round-trips and never repeats a ciphertext', () => {
    const a = seal('tok_123', key);
    const b = seal('tok_123', key);

    expect(a).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(a).not.toBe(b);
    expect(open(a, key)).toBe('tok_123');
  });

  it('refuses another key, a tampered value and garbage', () => {
    const sealed = seal('tok_123', key);

    expect(() => open(sealed, other)).toThrow('Sealed value is not readable');
    expect(() => open(`${sealed.slice(0, -2)}xx`, key)).toThrow('Sealed value is not readable');
    expect(() => open('nope', key)).toThrow('Sealed value is not readable');
  });

  it('requires a configured 32-byte key', () => {
    expect(() => assertCredentialKeyConfigured('')).toThrow('Payment credential key is not configured');
    expect(() => assertCredentialKeyConfigured('disabled')).toThrow('Payment credential key is not configured');
    expect(() => assertCredentialKeyConfigured(Buffer.alloc(16).toString('base64'))).toThrow('Payment credential key is not configured');
    expect(assertCredentialKeyConfigured(key)).toBe(key);
  });
});
