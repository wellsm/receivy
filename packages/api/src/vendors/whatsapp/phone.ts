const BRAZIL = '55';

/**
 * The number as Meta and Evolution want it: digits only, country code first, no plus sign.
 * A Brazilian number typed without the country code (10 or 11 digits) gets `55`; anything
 * that does not end up between 10 and 15 digits is not a phone.
 */
export function toWhatsappNumber(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');

  if (!digits) {
    return null;
  }

  const local = phone.trim().startsWith('+') ? digits : digits.length === 10 || digits.length === 11 ? `${BRAZIL}${digits}` : digits;

  if (local.length < 10 || local.length > 15) {
    return null;
  }

  return local;
}

/**
 * One Brazilian mobile has two spellings on WhatsApp: accounts older than the ninth digit keep an id
 * without it (`55 11 8888-7777`), newer ones carry it (`55 11 9 8888-7777`). Matching a phone against
 * group participants accepts either.
 */
export function whatsappNumberVariants(number: string): string[] {
  if (!number.startsWith(BRAZIL)) {
    return [number];
  }

  if (number.length === 13 && number[4] === '9') {
    return [number, `${number.slice(0, 4)}${number.slice(5)}`];
  }

  if (number.length === 12 && /[6-9]/.test(number[4] ?? '')) {
    return [number, `${number.slice(0, 4)}9${number.slice(4)}`];
  }

  return [number];
}
