import { describe, expect, it } from 'vitest';
import { normalizePhone } from './phone';

describe('normalizePhone', () => {
  it('normalizes a Brazilian mobile to E.164 and keeps an international one', () => {
    expect(normalizePhone('(11) 99999-8888')).toBe('+5511999998888');
    expect(normalizePhone('+1 415 555 0100')).toBe('+14155550100');
  });

  it('is undefined when empty and false when malformed', () => {
    expect(normalizePhone('')).toBeUndefined();
    expect(normalizePhone('abc')).toBe(false);
  });
});
