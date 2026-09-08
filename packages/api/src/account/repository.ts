import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpBadRequestError, HttpUnauthorizedError } from '@ez4/gateway';
import type { SessionIdentity } from '../authorizers/session';
import { CHARGE_SELECT, chargeDto } from '../charges/repository';
import type { DbClient } from '../database';
import { findAuthUserById } from '../repositories/auth-repository';
import { assertActiveSession } from './sessions';

export { eraseAccount } from './deletion';
export { listSessions, revokeSession } from './sessions';

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
function signature(identity: SessionIdentity, expires: number, nonce: string, secret: string) {
  return createHmac('sha256', secret)
    .update(`receivy-account-export:v1:${identity.userId}:${identity.familyId}:${expires}:${nonce}`)
    .digest();
}
export async function createExportTicket(db: DbClient, identity: SessionIdentity, secret: string, now = Math.floor(Date.now() / 1000)) {
  await assertActiveSession(db, identity);
  const expires = now + 300;
  const nonce = crypto.randomUUID();
  return {
    token: `${expires}.${nonce}.${signature(identity, expires, nonce, secret).toString('base64url')}`,
    expiresAt: new Date(expires * 1000).toISOString()
  };
}
export async function downloadExport(
  db: DbClient,
  identity: SessionIdentity,
  token: string,
  secret: string,
  now = Math.floor(Date.now() / 1000)
) {
  const [expiration, nonce, signed, extra] = token.split('.');
  const expires = Number(expiration);
  if (extra || !nonce || !signed || !Number.isSafeInteger(expires) || expires <= now || expires > now + 300)
    throw new HttpUnauthorizedError();
  const expected = signature(identity, expires, nonce, secret);
  const actual = Buffer.from(signed, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new HttpUnauthorizedError();
  return db.transaction(async (tx) => {
    // User lock prevents a half-erased snapshot and recheck blocks revoked export tickets.
    await tx.users.findOne({ select: { id: true }, where: { id: identity.userId }, lock: true });
    await assertActiveSession(tx, identity);
    const userId = identity.userId;
    const profile = await findAuthUserById(tx, userId);
    const verified = await tx.users.findOne({ select: { verified_email: true }, where: { id: userId } });
    const people = await tx.people.findMany({ select: { id: true, name: true, archived_at: true }, where: { owner_id: userId } });
    const personIds = people.records.map((x) => x.id);
    const contacts = personIds.length
      ? (
          await tx.person_contacts.findMany({
            select: { person_id: true, type: true, value: true },
            where: { person_id: { isIn: personIds } }
          })
        ).records
      : [];
    const methods = await tx.payment_methods.findMany({
      select: { id: true, pix_key: true, pix_key_type: true, label: true, is_default: true, archived_at: true },
      where: { owner_id: userId }
    });
    const charges = await tx.charges.findMany({
      select: CHARGE_SELECT,
      where: {
        OR: [
          { creditor_id: userId },
          { recipient_user_id: userId },
          ...(verified?.verified_email ? [{ recipient_email_snapshot: verified.verified_email }] : [])
        ]
      }
    });
    const history = await Promise.all(
      charges.records.map((row) => chargeDto(tx, row, row.creditor_id === userId ? 'receivable' : 'payable'))
    );
    const expenses = await tx.expenses.findMany({
      select: { id: true, description: true, total_cents: true, installment_count: true, first_due_date: true },
      where: { owner_id: userId }
    });
    const recurrences = await tx.recurrences.findMany({
      select: {
        id: true,
        description: true,
        total_cents: true,
        frequency: true,
        day: true,
        month: true,
        timezone: true,
        start_date: true,
        end_date: true,
        state: true
      },
      where: { owner_id: userId }
    });
    const proofs = await tx.payment_proofs.findMany({
      select: { id: true, charge_id: true, state: true, mime: true, size: true, created_at: true, reviewed_at: true },
      where: { sender_user_id: userId }
    });
    const preferences = await tx.notification_preferences.findOne({
      select: { email_enabled: true, push_enabled: true, reminder_offsets: true },
      where: { user_id: userId }
    });
    const activities = await tx.activity_events.findMany({
      select: { type: true, aggregate_type: true, aggregate_id: true, created_at: true },
      where: { subject_user_id: userId }
    });
    return {
      filename: 'receivy-dados.json',
      json: JSON.stringify({
        version: 1,
        exportedAt: new Date(now * 1000).toISOString(),
        profile,
        people: people.records,
        contacts,
        paymentMethods: methods.records,
        charges: history,
        expenses: expenses.records,
        recurrences: recurrences.records,
        proofs: proofs.records,
        preferences: preferences ?? null,
        activities: activities.records
      })
    };
  });
}
