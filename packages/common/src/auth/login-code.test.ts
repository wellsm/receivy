import { describe, expect, it } from 'vitest';
import { formatRemaining, LOGIN_CODE_TTL_MS, maskEmail, RESEND_COOLDOWN_MS } from './login-code';

describe('maskEmail', () => {
  it('keeps the first three characters of the local part and the domain', () => {
    expect(maskEmail('lucas@email.com')).toBe('luc***@email.com');
    expect(maskEmail('ana@example.com')).toBe('ana***@example.com');
  });

  it('never reveals a short local part', () => {
    expect(maskEmail('jo@example.com')).toBe('j***@example.com');
    expect(maskEmail('a@example.com')).toBe('a***@example.com');
  });

  it('returns the input untouched when it is not an e-mail', () => {
    expect(maskEmail('not-an-email')).toBe('not-an-email');
  });
});

describe('formatRemaining', () => {
  it('formats milliseconds as mm:ss, rounding up partial seconds', () => {
    expect(formatRemaining(LOGIN_CODE_TTL_MS)).toBe('10:00');
    expect(formatRemaining(4 * 60_000 + 57_000)).toBe('04:57');
    expect(formatRemaining(1_500)).toBe('00:02');
    expect(formatRemaining(0)).toBe('00:00');
    expect(formatRemaining(-5_000)).toBe('00:00');
  });

  it('exposes the server windows used by the code screens', () => {
    expect(LOGIN_CODE_TTL_MS).toBe(10 * 60_000);
    expect(RESEND_COOLDOWN_MS).toBe(60_000);
  });
});
