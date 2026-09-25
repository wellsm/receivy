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
