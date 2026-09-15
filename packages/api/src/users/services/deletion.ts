import { HttpBadRequestError, HttpUnauthorizedError } from '@ez4/gateway';
import { BillingState, UserStatus } from '@receivy/common';
import { ChargeRepository } from '../../charges/repositories/charge';
import { EventRepository } from '../../common/repositories/events';
import { EventableType } from '../../common/schemas/event';
import type { DbClient } from '../../database';
import { AvatarRepository } from '../repositories/avatar';
import { SessionRepository } from '../repositories/sessions';
import { lockAccountReferences } from './locking';

// EZ4 scalar nullable boundary: relation objects cannot express SQL NULL.
const sqlNull = null as unknown as undefined;

export async function eraseAccount(
  db: DbClient,
  userId: string,
  confirmation: string
): Promise<{ deleted: boolean; objectKeys: string[] }> {
  if (confirmation !== 'EXCLUIR') throw new HttpBadRequestError('Confirme digitando EXCLUIR.');
  return db.transaction(async (tx) => {
    // Built inside the transaction so a retried erasure never reports files twice.
    const objectKeys: string[] = [];
    await lockAccountReferences(tx, 'erase');
    const user = await tx.users.findOne({ select: { id: true, email: true, deleted_at: true }, where: { id: userId }, lock: true });
    if (!user) throw new HttpUnauthorizedError();
    if (user.deleted_at) return { deleted: true, objectKeys };
    objectKeys.push(AvatarRepository.key(userId));
    objectKeys.push(AvatarRepository.stagingKey(userId));
    const now = new Date().toISOString();
    await tx.session_families.updateMany({ where: { user_id: userId }, data: { revoked_at: now, device_name: sqlNull } });
    const families = await tx.session_families.findMany({ select: { id: true }, where: { user_id: userId } });
    if (families.records.length) await tx.refresh_tokens.deleteMany({ where: { family_id: { isIn: families.records.map((x) => x.id) } } });
    // Stop future generation before touching historical records. Existing amounts/state stay unchanged.
    const billings = await tx.billings.findMany({ select: { id: true }, where: { owner_id: userId }, lock: true });
    // No surviving link may still add participants to an erased owner's billings.
    await tx.billing_invites.updateMany({ where: { owner_id: userId }, data: { revoked_at: now } });
    for (const billing of billings.records) {
      await tx.billings.updateOne({
        where: { id: billing.id },
        data: {
          state: BillingState.Ended,
          description: 'Registro de conta excluída',
          payment_method: { id: sqlNull },
          reminders: sqlNull,
          updated_at: now
        }
      });
    }
    const charges = await tx.charges.findMany({
      select: { id: true },
      where: { OR: [{ creditor_id: userId }, { debtor_user_id: userId }, { proof_sender_user_id: userId }] },
      lock: true
    });
    await SessionRepository.disableDevices(tx, userId);
    for (const { id: chargeId } of [...charges.records].sort((a, b) => a.id.localeCompare(b.id))) {
      const charge = await tx.charges.findOne({ select: ChargeRepository.SELECT, where: { id: chargeId }, lock: true });
      if (!charge) continue;
      const creditorDeleted = charge.creditor_id === userId;
      const senderDeleted = charge.proof_sender_user_id === userId;
      // A file the erased person sent goes with them; the charge itself stays for the other side to read.
      if (senderDeleted && charge.proof_file) objectKeys.push(charge.proof_file.key);
      await tx.charges.updateOne({
        where: { id: chargeId },
        data: {
          ...(creditorDeleted
            ? { pix_key_snapshot: sqlNull, pix_key_type_snapshot: sqlNull, pix_label_snapshot: sqlNull, link_revoked_at: now }
            : {}),
          ...(senderDeleted
            ? {
                proof_state: sqlNull,
                proof_file: sqlNull,
                proof_kind: sqlNull,
                ...{ proof_sender_user_id: sqlNull },
                proof_actor_hash: sqlNull,
                proof_expires_at: sqlNull,
                proof_sent_at: sqlNull,
                proof_reviewed_at: sqlNull,
                proof_reason: sqlNull
              }
            : {}),
          updated_at: now
        }
      });
    }
    // The agenda of the erased account goes; every agenda that listed it keeps an archived entry so history still reads.
    await tx.billing_guests.deleteMany({ where: { OR: [{ owner_id: userId }, { user_id: userId }] } });
    await tx.contacts.deleteMany({ where: { owner_id: userId } });
    await tx.contacts.updateMany({ where: { user_id: userId }, data: { nickname: sqlNull, archived_at: now, updated_at: now } });
    for (const billing of billings.records)
      if (!(await tx.charges.count({ where: { billing_id: billing.id } }))) {
        await tx.billing_invites.deleteMany({ where: { billing_id: billing.id } });
        await tx.allocations.deleteMany({ where: { billing_id: billing.id } });
        await tx.billings.deleteOne({ where: { id: billing.id } });
      }
    await tx.payment_methods.deleteMany({ where: { owner_id: userId } });
    await tx.auth_identities.deleteMany({ where: { user_id: userId } });
    await tx.oauth_grants.deleteMany({ where: { user_id: userId } });
    if (user.email) await tx.login_codes.deleteMany({ where: { email: user.email } });
    // The log keeps its lines but forgets who acted; the account's own history goes with it.
    await tx.events.deleteMany({ where: { eventable_type: EventableType.Account, eventable_id: userId } });
    await tx.rawQuery('UPDATE events SET actor_user_id = NULL WHERE actor_user_id = :id::uuid', { id: userId });
    await tx.users.updateOne({
      where: { id: userId },
      data: {
        email: `${userId}@deleted.invalid`,
        verified_email: sqlNull,
        name: 'Conta excluída',
        phone: sqlNull,
        avatar_url: sqlNull,
        avatar_updated_at: sqlNull,
        status: UserStatus.Removed,
        timezone: 'UTC',
        deleted_at: now,
        updated_at: now
      }
    });
    await EventRepository.record(tx, { type: 'account.deleted', eventableType: EventableType.Account, eventableId: userId, at: now });
    // The caller sends these only after this transaction commits.
    return { deleted: true, objectKeys };
  });
}
