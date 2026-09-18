import { HttpBadRequestError } from '@ez4/gateway';

export type ProfileInput = { name: string; phone?: string | null; locale: 'pt-BR'; timezone: string; country: 'BR' };

export type Profile = { name: string; phone?: string; locale: 'pt-BR'; timezone: string; country: 'BR' };

/** Optional at onboarding; an invalid value refuses the whole profile instead of being silently dropped. */
export function normalizePhone(value: string | null | undefined): string | undefined | false {
  const raw = (value ?? '').trim();

  if (!raw) {
    return undefined;
  }

  if (!/^[+\d\s().-]+$/.test(raw) || raw.length > 40) {
    return false;
  }

  const digits = raw.replace(/\D/g, '');

  if (raw.startsWith('+')) {
    return /^\+[1-9]\d{7,14}$/.test(`+${digits}`) ? `+${digits}` : false;
  }

  return /^[1-9]\d{9,10}$/.test(digits) ? `+55${digits}` : false;
}

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
