import { randomInt } from 'node:crypto';

/** Base58: letters and digits without the ones people misread (0, O, I, l). */
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export const SHORT_CODE_LENGTH = 9;

/**
 * One per account, for `/o/<code>`: 58^6 ≈ 3.8 × 10^10 codes against a few thousand accounts, and a lucky
 * guess only opens the opt-out confirmation, which still asks for the click and can be undone.
 */
export const OPT_OUT_CODE_LENGTH = 6;

/** 58^9 ≈ 7.4 × 10^15 codes: guessing a live one over HTTP is out of reach, and the unique index catches the rest. */
export function newShortCode(length = SHORT_CODE_LENGTH): string {
  let code = '';

  for (let index = 0; index < length; index++) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }

  return code;
}

/** Whether `value` could be a short code at all: anything else is a 404 without a read. */
export function isShortCode(value: string, length = SHORT_CODE_LENGTH): boolean {
  if (value.length !== length) {
    return false;
  }

  return [...value].every((char) => ALPHABET.includes(char));
}
