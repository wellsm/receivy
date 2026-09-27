import { describe, expect, it } from 'vitest';
import { toWhatsappNumber, whatsappNumberVariants } from './phone';

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

describe('whatsappNumberVariants', () => {
  it('spells a Brazilian mobile with and without the ninth digit', () => {
    expect(whatsappNumberVariants('5511988887777')).toEqual(['5511988887777', '551188887777']);
    expect(whatsappNumberVariants('551188887777')).toEqual(['551188887777', '5511988887777']);
  });

  it('leaves landlines and foreign numbers alone', () => {
    expect(whatsappNumberVariants('551133334444')).toEqual(['551133334444']);
    expect(whatsappNumberVariants('14155550100')).toEqual(['14155550100']);
  });
});

