import { HttpBadRequestError } from '@ez4/gateway';
import { normalizePhone } from '@receivy/common';

export type ProfileInput = { name: string; phone?: string | null; locale: 'pt-BR'; timezone: string; country: 'BR' };

export type Profile = { name: string; phone?: string; locale: 'pt-BR'; timezone: string; country: 'BR' };

/** The profile as it is stored: trimmed name, E.164 phone, and a timezone Intl knows. */
export function normalizeProfile(input: ProfileInput): Profile {
  const phone = normalizePhone(input.phone);

  if (phone === false) {
    throw new HttpBadRequestError('Perfil inválido.');
  }

  const invalid =
    typeof input.name !== 'string' ||
    !input.name.trim() ||
    input.name.trim().length > 120 ||
    input.locale !== 'pt-BR' ||
    input.country !== 'BR' ||
    typeof input.timezone !== 'string' ||
    input.timezone.length > 64;

  if (invalid) {
    throw new HttpBadRequestError('Perfil inválido.');
  }

  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: input.timezone });
  } catch {
    throw new HttpBadRequestError('Fuso horário inválido.');
  }

  return { name: input.name.trim(), phone, locale: input.locale, timezone: input.timezone, country: input.country };
}
