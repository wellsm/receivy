import { describe, expect, it } from 'vitest';
import { isShortCode, newShortCode, OPT_OUT_CODE_LENGTH, SHORT_CODE_LENGTH } from './short-code';

describe('short codes', () => {
  it('draws 9 base58 characters, never the misread ones', () => {
    const codes = Array.from({ length: 500 }, () => newShortCode());

    for (const code of codes) {
      expect(code).toHaveLength(SHORT_CODE_LENGTH);
      expect(code).not.toMatch(/[0OIl]/);
      expect(isShortCode(code)).toBe(true);
    }

    expect(new Set(codes).size).toBe(codes.length);
  });

  it('refuses anything that is not a short code before any read', () => {
    expect(isShortCode('')).toBe(false);
    expect(isShortCode('K7m2xQ9a')).toBe(false);
    expect(isShortCode('K7m2xQ9aBc')).toBe(false);
    expect(isShortCode('K7m2xQ9a0')).toBe(false);
    expect(isShortCode('K7m2xQ9a/')).toBe(false);
  });

  it('draws and checks the 6-character opt-out code on its own length', () => {
    const code = newShortCode(OPT_OUT_CODE_LENGTH);

    expect(code).toHaveLength(6);
    expect(isShortCode(code, OPT_OUT_CODE_LENGTH)).toBe(true);
    expect(isShortCode(code)).toBe(false);
    expect(isShortCode('K7m2x0', OPT_OUT_CODE_LENGTH)).toBe(false);
  });
});
