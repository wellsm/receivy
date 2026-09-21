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
