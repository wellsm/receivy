import { HttpBadRequestError, HttpUnauthorizedError } from '@ez4/gateway';
import type { DbClient } from '../database';
import { findAuthUserById } from '../repositories/auth-repository';

export { eraseAccount } from './deletion';
export { revokeSession } from './sessions';

export async function updateProfile(
  db: DbClient,
  userId: string,
  input: { name: string; locale: 'pt-BR'; timezone: string; country: 'BR' }
) {
  if (
    typeof input.name !== 'string' ||
    !input.name.trim() ||
    input.name.trim().length > 120 ||
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
      data: { name: input.name.trim(), locale: input.locale, timezone: input.timezone, country: input.country, updated_at: now }
    });
    await tx.activity_events.insertOne({
      data: {
        id: crypto.randomUUID(),
        actor_user: { id: userId },
        subject_user: { id: userId },
        type: 'account.profile_updated',
        aggregate_type: 'account',
        aggregate_id: userId,
        payload: '{}',
        created_at: now
      }
    });
    return (await findAuthUserById(tx, userId))!;
  });
}
