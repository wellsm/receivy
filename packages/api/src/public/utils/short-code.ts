import { randomInt } from 'node:crypto';

/** Base58: letters and digits without the ones people misread (0, O, I, l). */
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export const SHORT_CODE_LENGTH = 9;

const SHAPE = new RegExp(`^[${ALPHABET}]{${SHORT_CODE_LENGTH}}$`);

/** 58^9 ≈ 7.4 × 10^15 codes: guessing a live one over HTTP is out of reach, and the unique index catches the rest. */
export function newShortCode(): string {
  let code = '';

  for (let index = 0; index < SHORT_CODE_LENGTH; index++) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }

  return code;
}

/** Whether `value` could be a short code at all: anything else is a 404 without a read. */
export function isShortCode(value: string): boolean {
  return SHAPE.test(value);
}
