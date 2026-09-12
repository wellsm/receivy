import { HttpBadRequestError, HttpUnauthorizedError } from '@ez4/gateway';
import { recordEvent } from '../../common/repositories/events';
import type { DbClient } from '../../database';
import { findAuthUserById } from './auth';

const sqlNull = null as unknown as undefined;

/** Optional at onboarding; an invalid value refuses the whole profile instead of being silently dropped. */
function normalizePhone(value: string | null | undefined): string | undefined | false {
  const raw = (value ?? '').trim();
  if (!raw) return undefined;
  if (!/^[+\d\s().-]+$/.test(raw) || raw.length > 40) return false;
  const digits = raw.replace(/\D/g, '');
  if (raw.startsWith('+')) return /^\+[1-9]\d{7,14}$/.test(`+${digits}`) ? `+${digits}` : false;
  return /^[1-9]\d{9,10}$/.test(digits) ? `+55${digits}` : false;
}

export { eraseAccount } from '../services/deletion';
export { revokeSession } from './sessions';

export async function updateProfile(
  db: DbClient,
  userId: string,
  input: { name: string; phone?: string | null; locale: 'pt-BR'; timezone: string; country: 'BR' }
) {
  const phone = normalizePhone(input.phone);
  if (
    typeof input.name !== 'string' ||
    !input.name.trim() ||
    input.name.trim().length > 120 ||
    phone === false ||
    input.locale !== 'pt-BR' ||
    input.country !== 'BR' ||
    typeof input.timezone !== 'string' ||
    input.timezone.length > 64
  )
    throw new HttpBadRequestError('Perfil inválido.');
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: input.timezone });
  } catch {
    throw new HttpBadRequestError('Fuso horário inválido.');
  }
  return db.transaction(async (tx) => {
    if (!(await tx.users.findOne({ select: { id: true }, where: { id: userId, deleted_at: { isNull: true } }, lock: true })))
      throw new HttpUnauthorizedError();
    const now = new Date().toISOString();
    await tx.users.updateOne({
      where: { id: userId },
      // Onboarding is what turns a pending account (own login or someone's contact) into an active one.
      data: {
        name: input.name.trim(),
        phone: phone ?? sqlNull,
        status: 'active',
        locale: input.locale,
        timezone: input.timezone,
        country: input.country,
        updated_at: now
      }
    });
    await recordEvent(tx, { type: 'account.profile_updated', eventableType: 'account', eventableId: userId, actorId: userId, at: now });
    return (await findAuthUserById(tx, userId))!;
  });
}
