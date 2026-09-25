import { describe, expect, it } from 'vitest';
import { toWhatsappNumber } from './phone';

describe('toWhatsappNumber', () => {
  it('strips the mask and adds the Brazilian country code when missing', () => {
    expect(toWhatsappNumber('+55 11 99999-9999')).toBe('5511999999999');
    expect(toWhatsappNumber('(11) 99999-9999')).toBe('5511999999999');
    expect(toWhatsappNumber('11 3333-4444')).toBe('551133334444');
    expect(toWhatsappNumber('5511999999999')).toBe('5511999999999');
  });

  it('refuses what is not a phone after normalising', () => {
    expect(toWhatsappNumber('')).toBeNull();
    expect(toWhatsappNumber('999')).toBeNull();
    expect(toWhatsappNumber('+1 415 555 0100')).toBe('14155550100');
    expect(toWhatsappNumber('5511999999999999')).toBeNull();
  });
});
